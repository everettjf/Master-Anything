/**
 * Knowledge tracing over the graph (thrust B).
 *
 * The P0 mastery model is a flat per-unit state machine: each unit's level moves
 * only when *that* unit is assessed. Real understanding isn't independent — units
 * sit in a prerequisite graph, and evidence at one should inform its neighbours.
 *
 * This module derives a probabilistic belief P(mastered) for *every* unit from a
 * sparse set of attempts, by:
 *   1. a Bayesian-Knowledge-Tracing-style posterior from each unit's own attempts
 *      (slip/guess tuned by how objective the verifier is), then
 *   2. propagating that evidence along prerequisite edges — mastering a unit is
 *      (discounted) evidence that the things it's built on are mastered too.
 *
 * From those beliefs it picks the next best exercise: the ready, not-yet-mastered
 * unit that unlocks the most downstream work. Pure, deterministic, offline — no
 * LLM, fully testable.
 */
import type { BloomLevel } from "./types.js";
import type { LearningUnit } from "./units.js";

export interface Observation {
  passed: boolean;
  verifier: "tests" | "graph" | "llm";
  targetLevel: BloomLevel;
}

export interface TraceParams {
  /** Prior P(mastered) for a unit with no evidence. */
  prior: number;
  /** P(learn) applied each attempt — the act of practising teaches. */
  transit: number;
  /** Objective verifiers (real tests, graph truth) barely slip or guess. */
  slipObjective: number;
  guessObjective: number;
  /** LLM grading is noisier. */
  slipSubjective: number;
  guessSubjective: number;
  /** How strongly mastering a unit implies its prerequisites are mastered. */
  implyDiscount: number;
  /** Belief at/above this counts as mastered. */
  masteredThreshold: number;
}

export const DEFAULT_PARAMS: TraceParams = {
  prior: 0.1,
  transit: 0.12,
  slipObjective: 0.05,
  guessObjective: 0.1,
  slipSubjective: 0.15,
  guessSubjective: 0.25,
  implyDiscount: 0.6,
  masteredThreshold: 0.85,
};

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const noisyOr = (ps: number[]) => 1 - ps.reduce((acc, p) => acc * (1 - clamp01(p)), 1);

function slipGuess(verifier: Observation["verifier"], p: TraceParams): [number, number] {
  return verifier === "llm" ? [p.slipSubjective, p.guessSubjective] : [p.slipObjective, p.guessObjective];
}

/** One BKT update: posterior given the observation, then a learning transition. */
export function bktUpdate(prior: number, obs: Observation, params: TraceParams = DEFAULT_PARAMS): number {
  const [slip, guess] = slipGuess(obs.verifier, params);
  const peKnown = obs.passed ? 1 - slip : slip;
  const peUnknown = obs.passed ? guess : 1 - guess;
  const p = clamp01(prior);
  const denom = p * peKnown + (1 - p) * peUnknown;
  const post = denom > 0 ? (p * peKnown) / denom : p;
  return clamp01(post + (1 - post) * params.transit);
}

/** Fold a unit's own attempts (chronological) into a direct belief. */
export function directBelief(observations: Observation[], params: TraceParams = DEFAULT_PARAMS): number {
  let p = params.prior;
  for (const obs of observations) p = bktUpdate(p, obs, params);
  return p;
}

export interface UnitBelief {
  unitId: string;
  /** Belief from this unit's own attempts only. */
  direct: number;
  /** Belief after propagating evidence across prerequisite edges. */
  belief: number;
  /** P(all prerequisites mastered) — readiness to practise this unit now. */
  readiness: number;
  mastered: boolean;
}

/**
 * Build a belief for every unit from per-unit observations + the prerequisite
 * graph. Propagation is an iterative noisy-OR diffusion: a unit's belief is
 * raised by (discounted) belief of any unit that depends on it.
 */
export function inferBeliefs(
  units: LearningUnit[],
  observationsByUnit: Map<string, Observation[]>,
  params: TraceParams = DEFAULT_PARAMS,
): Map<string, UnitBelief> {
  const ids = new Set(units.map((u) => u.id));
  const direct = new Map<string, number>();
  for (const u of units) direct.set(u.id, directBelief(observationsByUnit.get(u.id) ?? [], params));

  // dependents[u] = units that list u as a prerequisite.
  const dependents = new Map<string, string[]>();
  for (const u of units) dependents.set(u.id, []);
  for (const u of units) {
    for (const p of u.prerequisites) {
      if (ids.has(p)) dependents.get(p)!.push(u.id);
    }
  }

  // Diffuse along prerequisite edges. A dependent only implies its prerequisites
  // to the extent its belief exceeds the base prior, so an un-attempted graph
  // stays at the prior instead of priors propagating into spurious belief.
  const excess = (p: number) => Math.max(0, (p - params.prior) / (1 - params.prior));
  let belief = new Map(direct);
  const passes = Math.min(units.length, 6);
  for (let i = 0; i < passes; i++) {
    const next = new Map<string, number>();
    for (const u of units) {
      const implied = dependents.get(u.id)!.map((d) => params.implyDiscount * excess(belief.get(d) ?? 0));
      next.set(u.id, noisyOr([direct.get(u.id)!, ...implied]));
    }
    belief = next;
  }

  const out = new Map<string, UnitBelief>();
  for (const u of units) {
    const prereqs = u.prerequisites.filter((p) => ids.has(p));
    const readiness = prereqs.length
      ? prereqs.reduce((acc, p) => acc * (belief.get(p) ?? 0), 1) ** (1 / prereqs.length)
      : 1;
    const b = belief.get(u.id)!;
    out.set(u.id, {
      unitId: u.id,
      direct: direct.get(u.id)!,
      belief: b,
      readiness,
      mastered: b >= params.masteredThreshold,
    });
  }
  return out;
}

export interface Recommendation {
  unitId: string;
  title: string;
  score: number;
  belief: number;
  readiness: number;
  /** Not-yet-mastered units this one is a prerequisite for. */
  unlocks: number;
  kind: "learn" | "review";
  reason: string;
}

export interface RecommendOptions {
  /** Unit ids due for spaced-repetition review (mastered but decaying). */
  due?: Set<string>;
  params?: TraceParams;
  limit?: number;
}

/**
 * Rank the next best things to practise. Learning value = how ready the unit is
 * × how much mastery is left to gain × how much downstream work it unblocks.
 * Due reviews of already-mastered units float to the top.
 */
export function recommendNext(
  units: LearningUnit[],
  beliefs: Map<string, UnitBelief>,
  opts: RecommendOptions = {},
): Recommendation[] {
  const params = opts.params ?? DEFAULT_PARAMS;
  const due = opts.due ?? new Set<string>();
  const byId = new Map(units.map((u) => [u.id, u]));
  const order = new Map(units.map((u, i) => [u.id, i])); // stable path-order tiebreak

  const dependents = new Map<string, string[]>();
  for (const u of units) dependents.set(u.id, []);
  for (const u of units) for (const p of u.prerequisites) if (byId.has(p)) dependents.get(p)!.push(u.id);

  const recs: Recommendation[] = [];
  for (const u of units) {
    const b = beliefs.get(u.id);
    if (!b) continue;
    const unlocks = dependents.get(u.id)!.filter((d) => !(beliefs.get(d)?.mastered ?? false)).length;
    const unlockValue = 1 + Math.log1p(unlocks);

    if (b.mastered) {
      if (!due.has(u.id)) continue; // mastered and not due — nothing to do
      recs.push({
        unitId: u.id,
        title: u.title,
        score: 100 + unlockValue, // reviews dominate
        belief: b.belief,
        readiness: b.readiness,
        unlocks,
        kind: "review",
        reason: "Due for review — keep it from fading",
      });
      continue;
    }

    const gap = 1 - b.belief;
    const score = b.readiness * gap * unlockValue;
    recs.push({
      unitId: u.id,
      title: u.title,
      score,
      belief: b.belief,
      readiness: b.readiness,
      unlocks,
      kind: "learn",
      reason: reasonFor(u, b, unlocks, byId, beliefs, params),
    });
  }

  recs.sort((a, b) => b.score - a.score || order.get(a.unitId)! - order.get(b.unitId)!);
  return opts.limit ? recs.slice(0, opts.limit) : recs;
}

function reasonFor(
  unit: LearningUnit,
  belief: UnitBelief,
  unlocks: number,
  byId: Map<string, LearningUnit>,
  beliefs: Map<string, UnitBelief>,
  params: TraceParams,
): string {
  const unlockNote = unlocks > 0 ? ` · unlocks ${unlocks} unit${unlocks > 1 ? "s" : ""}` : "";
  // Weakest prerequisite, if any, gating readiness.
  const weak = unit.prerequisites
    .map((p) => beliefs.get(p))
    .filter((b): b is UnitBelief => !!b && b.belief < params.masteredThreshold)
    .sort((a, b) => a.belief - b.belief)[0];

  if (belief.readiness >= 0.7) {
    if (unit.prerequisites.length === 0) return `Foundational — a good place to start${unlockNote}`;
    return `Prerequisites in place${unlockNote}`;
  }
  if (weak) {
    const title = byId.get(weak.unitId)?.title ?? "a prerequisite";
    return `Builds on “${title}” — shore that up first${unlockNote}`;
  }
  return `Next on the path${unlockNote}`;
}
