import {
  BloomLevel,
  inferBeliefs,
  type LearningUnit,
  type Observation,
  type Quest,
  questProgress,
  requiredSubgraph,
  unitsForNodes,
} from "@ma/core";
import { describe, expect, it } from "vitest";

// Diamond: D needs B and C; B and C both need A. Plus an unrelated unit Z.
function diamond(): LearningUnit[] {
  const mk = (id: string, prerequisites: string[], members: string[] = [id]): LearningUnit => ({
    id,
    title: id,
    kind: "function",
    primary: id,
    members,
    provenance: { path: `${id}.py`, startLine: 1, endLine: 2 },
    prerequisites,
    bloomCeiling: BloomLevel.Apply,
  });
  return [
    mk("A", []),
    mk("B", ["A"]),
    mk("C", ["A"]),
    mk("D", ["B", "C"], ["D", "node:D#impl"]),
    mk("Z", []),
  ];
}

const pass = (): Observation => ({ passed: true, verifier: "tests", targetLevel: BloomLevel.Apply });
const mastered = (ids: string[]) => new Map(ids.map((id) => [id, [pass(), pass(), pass()]]));

describe("requiredSubgraph", () => {
  it("collects target + transitive prerequisites, dependency-ordered, excluding unrelated units", () => {
    const req = requiredSubgraph(diamond(), ["D"]);
    expect(new Set(req)).toEqual(new Set(["A", "B", "C", "D"]));
    expect(req).not.toContain("Z"); // unrelated unit is not part of the quest
    // A (foundational) comes before its dependents; D (target) comes last.
    expect(req.indexOf("A")).toBeLessThan(req.indexOf("B"));
    expect(req.indexOf("A")).toBeLessThan(req.indexOf("C"));
    expect(req.indexOf("D")).toBe(req.length - 1);
  });
});

describe("unitsForNodes", () => {
  it("maps symbol-node ids to their owning units", () => {
    expect(unitsForNodes(diamond(), ["node:D#impl"])).toEqual(["D"]);
    expect(unitsForNodes(diamond(), ["A", "A"])).toEqual(["A"]); // dedup
  });
});

describe("questProgress", () => {
  const units = diamond();
  const quest: Quest = {
    id: "q1",
    goal: "ship D",
    targetUnitIds: ["D"],
    requiredUnitIds: requiredSubgraph(units, ["D"]),
  };

  it("starts at 0% and points at the foundational step", () => {
    const p = questProgress(quest, units, inferBeliefs(units, new Map()));
    expect(p.total).toBe(4);
    expect(p.percent).toBe(0);
    expect(p.complete).toBe(false);
    expect(p.capstoneReady).toBe(false);
    expect(p.next?.unitId).toBe("A");
    expect(p.steps.find((s) => s.unitId === "D")!.isTarget).toBe(true);
  });

  it("unlocks the capstone once non-target prerequisites are mastered", () => {
    const p = questProgress(quest, units, inferBeliefs(units, mastered(["A", "B", "C"])));
    expect(p.capstoneReady).toBe(true);
    expect(p.complete).toBe(false); // target D not done yet
    expect(p.next?.unitId).toBe("D"); // capstone is the next step
    expect(p.percent).toBe(75);
  });

  it("completes when the whole sub-graph is mastered", () => {
    const p = questProgress(quest, units, inferBeliefs(units, mastered(["A", "B", "C", "D"])));
    expect(p.complete).toBe(true);
    expect(p.percent).toBe(100);
  });
});
