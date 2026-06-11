/**
 * Goal-anchored Quests (thrust C) — the reason to open the tool.
 *
 * A→B→C closes here. A learner states a goal ("fix the averaging bug", "work on
 * auth"); we anchor it to a target unit in the graph, compute the *exact* set of
 * units that must be mastered to confidently change it (the target plus its
 * transitive prerequisites), sequence them dependency-first, and drive progress
 * with the knowledge-tracing beliefs from thrust B. The quest culminates in a
 * real Apply/Create task on the target — the passing change is the ultimate,
 * objective verification.
 *
 * Pure orchestration over units (the graph) + beliefs; deterministic and offline.
 */
import { type Recommendation, type RecommendOptions, recommendNext, type UnitBelief } from "./tracing.js";
import { type LearningUnit, orderUnits } from "./units.js";

export interface Quest {
  id: string;
  goal: string;
  /** Unit(s) the goal is anchored to — the capstone(s). */
  targetUnitIds: string[];
  /** Targets + transitive prerequisites, ordered prerequisites-first. */
  requiredUnitIds: string[];
}

/**
 * The minimal sub-graph to master for a goal: the targets and everything they
 * (transitively) depend on, returned in dependency order (prerequisites first).
 */
export function requiredSubgraph(units: LearningUnit[], targetIds: string[]): string[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const closure = new Set<string>();
  const stack = [...targetIds];
  while (stack.length) {
    const id = stack.pop()!;
    if (closure.has(id) || !byId.has(id)) continue;
    closure.add(id);
    for (const p of byId.get(id)!.prerequisites) stack.push(p);
  }
  const subset = units.filter((u) => closure.has(u.id));
  return orderUnits(subset).units.map((u) => u.id);
}

/** Map retrieved symbol-node ids to the units that own them (dedup, order-preserving). */
export function unitsForNodes(units: LearningUnit[], nodeIds: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const nid of nodeIds) {
    const u = units.find((x) => x.primary === nid || x.members.includes(nid));
    if (u && !seen.has(u.id)) {
      seen.add(u.id);
      out.push(u.id);
    }
  }
  return out;
}

export interface QuestStep {
  unitId: string;
  title: string;
  belief: number;
  mastered: boolean;
  isTarget: boolean;
}

export interface QuestProgress {
  id: string;
  goal: string;
  targetUnitIds: string[];
  total: number;
  mastered: number;
  /** 0..100 over required units. */
  percent: number;
  /** All required units mastered (including the target capstone). */
  complete: boolean;
  /** All non-target prerequisites mastered — the capstone is unlocked. */
  capstoneReady: boolean;
  /** The next best step within the quest. */
  next?: Recommendation;
  steps: QuestStep[];
}

/** Live progress of a quest from the current belief state. */
export function questProgress(
  quest: Quest,
  units: LearningUnit[],
  beliefs: Map<string, UnitBelief>,
  opts: RecommendOptions = {},
): QuestProgress {
  const reqSet = new Set(quest.requiredUnitIds);
  const targetSet = new Set(quest.targetUnitIds);
  const byId = new Map(units.map((u) => [u.id, u]));
  const subset = units.filter((u) => reqSet.has(u.id));

  const steps: QuestStep[] = quest.requiredUnitIds.map((id) => {
    const b = beliefs.get(id);
    return {
      unitId: id,
      title: byId.get(id)?.title ?? id,
      belief: b?.belief ?? 0,
      mastered: b?.mastered ?? false,
      isTarget: targetSet.has(id),
    };
  });

  const total = steps.length;
  const masteredCount = steps.filter((s) => s.mastered).length;
  const capstoneReady = steps.filter((s) => !s.isTarget).every((s) => s.mastered);
  const complete = total > 0 && steps.every((s) => s.mastered);
  // Rank next steps *within* the quest so unlock counts reflect quest scope.
  const recs = recommendNext(subset, beliefs, opts);
  const next = recs.find((r) => r.kind === "learn") ?? recs[0];

  return {
    id: quest.id,
    goal: quest.goal,
    targetUnitIds: quest.targetUnitIds,
    total,
    mastered: masteredCount,
    percent: total ? Math.round((masteredCount / total) * 100) : 0,
    complete,
    capstoneReady,
    next,
    steps,
  };
}
