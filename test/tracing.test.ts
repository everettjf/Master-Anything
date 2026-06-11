import {
  BloomLevel,
  bktUpdate,
  DEFAULT_PARAMS,
  directBelief,
  inferBeliefs,
  type LearningUnit,
  type Observation,
  recommendNext,
} from "@ma/core";
import { describe, expect, it } from "vitest";

// A→B→C chain: A foundational, B needs A, C needs B.
function chain(): LearningUnit[] {
  const mk = (id: string, prerequisites: string[]): LearningUnit => ({
    id,
    title: id,
    kind: "function",
    primary: id,
    members: [id],
    provenance: { path: `${id}.py`, startLine: 1, endLine: 2 },
    prerequisites,
    bloomCeiling: BloomLevel.Apply,
  });
  return [mk("A", []), mk("B", ["A"]), mk("C", ["B"])];
}

const pass = (verifier: Observation["verifier"] = "tests"): Observation => ({
  passed: true,
  verifier,
  targetLevel: BloomLevel.Apply,
});
const fail = (verifier: Observation["verifier"] = "tests"): Observation => ({
  passed: false,
  verifier,
  targetLevel: BloomLevel.Apply,
});

describe("BKT update", () => {
  it("raises belief on a pass and lowers it on a fail", () => {
    const up = bktUpdate(DEFAULT_PARAMS.prior, pass());
    const down = bktUpdate(0.6, fail());
    expect(up).toBeGreaterThan(DEFAULT_PARAMS.prior);
    expect(down).toBeLessThan(0.6);
  });

  it("trusts objective verifiers more than the LLM", () => {
    const objective = bktUpdate(0.3, pass("tests"));
    const subjective = bktUpdate(0.3, pass("llm"));
    expect(objective).toBeGreaterThan(subjective);
  });

  it("converges toward mastery under repeated passes", () => {
    expect(directBelief([pass(), pass(), pass()])).toBeGreaterThan(0.85);
  });
});

describe("graph propagation", () => {
  it("mastering a dependent lifts belief in its prerequisites", () => {
    const units = chain();
    const obs = new Map<string, Observation[]>([["C", [pass(), pass(), pass()]]]);
    const beliefs = inferBeliefs(units, obs);
    // C mastered directly; A and B get lifted by implication above their prior.
    expect(beliefs.get("C")!.belief).toBeGreaterThan(0.85);
    expect(beliefs.get("B")!.belief).toBeGreaterThan(DEFAULT_PARAMS.prior);
    expect(beliefs.get("A")!.belief).toBeGreaterThan(DEFAULT_PARAMS.prior);
    // Implication weakens with distance: closer prerequisite (B) ≥ farther (A).
    expect(beliefs.get("B")!.belief).toBeGreaterThanOrEqual(beliefs.get("A")!.belief);
  });

  it("readiness reflects whether prerequisites are mastered", () => {
    const units = chain();
    const beliefs = inferBeliefs(units, new Map([["A", [pass(), pass(), pass()]]]));
    expect(beliefs.get("A")!.readiness).toBe(1); // no prereqs
    expect(beliefs.get("B")!.readiness).toBeGreaterThan(0.8); // A mastered
    expect(beliefs.get("C")!.readiness).toBeLessThan(0.5); // B still unknown
  });
});

describe("recommendNext", () => {
  it("starts a fresh learner at the foundational unit", () => {
    const units = chain();
    const beliefs = inferBeliefs(units, new Map());
    const recs = recommendNext(units, beliefs);
    expect(recs[0]!.unitId).toBe("A");
    expect(recs[0]!.reason).toMatch(/Foundational/);
    expect(recs[0]!.unlocks).toBeGreaterThan(0);
  });

  it("advances the frontier as prerequisites are mastered", () => {
    const units = chain();
    const beliefs = inferBeliefs(units, new Map([["A", [pass(), pass(), pass()]]]));
    const recs = recommendNext(units, beliefs, { limit: 1 });
    expect(recs[0]!.unitId).toBe("B"); // A done -> B is next, ready
  });

  it("drops mastered units unless they're due for review", () => {
    const units = chain();
    const obs = new Map<string, Observation[]>([
      ["A", [pass(), pass(), pass()]],
      ["B", [pass(), pass(), pass()]],
      ["C", [pass(), pass(), pass()]],
    ]);
    const beliefs = inferBeliefs(units, obs);
    expect(recommendNext(units, beliefs).length).toBe(0); // all mastered, none due

    const withReview = recommendNext(units, beliefs, { due: new Set(["A"]) });
    expect(withReview).toHaveLength(1);
    expect(withReview[0]!.kind).toBe("review");
    expect(withReview[0]!.unitId).toBe("A");
  });
});
