import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  BloomLevel,
  bandName,
  buildDocsGraph,
  buildGraph,
  buildImpactQuestion,
  buildUnits,
  computeLayers,
  dependentsOf,
  emptyState,
  generateWiki,
  gradeImpact,
  gradeOpenCreate,
  isDue,
  linkCrossDomain,
  mergeGraphs,
  orderUnits,
  recordAttempt,
  retrieve,
  tokenize,
  wikiFiles,
} from "@ma/core";
import { describe, expect, it } from "vitest";

const ex = (name: string) => fileURLToPath(new URL(`../examples/${name}`, import.meta.url));

describe("graph + units + path", () => {
  const graph = buildGraph(ex("py-calc"));
  const units = buildUnits(graph);

  it("extracts the Calculator class and functions with call edges", () => {
    const names = graph.nodes.map((n) => n.name);
    expect(names).toContain("Calculator");
    expect(graph.edges.some((e) => e.type === "calls")).toBe(true);
  });

  it("orders prerequisites first (Calculator before average)", () => {
    const ordered = orderUnits(units).units.map((u) => u.title);
    expect(ordered).toContain("Calculator");
    expect(ordered).toContain("average");
    expect(ordered.indexOf("Calculator")).toBeLessThan(ordered.indexOf("average"));
  });
});

describe("architectural layers", () => {
  const units = buildUnits(buildGraph(ex("py-calc")));
  it("ranks foundational units at depth 0", () => {
    const { depth, maxDepth } = computeLayers(units);
    const calc = units.find((u) => u.title === "Calculator")!;
    const avg = units.find((u) => u.title === "average")!;
    expect(depth.get(calc.id)).toBe(0);
    expect(depth.get(avg.id)).toBeGreaterThan(0);
    expect(bandName(0, maxDepth)).toBe("Foundation");
  });
});

describe("analyze (graph-verified impact)", () => {
  const units = buildUnits(buildGraph(ex("py-calc")));
  const calc = units.find((u) => u.title === "Calculator")!;

  it("computes dependents from the dependency graph", () => {
    const deps = dependentsOf(units);
    const titles = [...(deps.get(calc.id) ?? [])].map((id) => units.find((u) => u.id === id)?.title);
    expect(titles).toContain("average");
  });

  it("grades an impact question against ground truth", () => {
    const q = buildImpactQuestion(units, calc.id);
    const correct = q.options.filter((o) => o.correct).map((o) => o.unitId);
    expect(correct.length).toBeGreaterThan(0);
    expect(gradeImpact(q, correct).passed).toBe(true);
    expect(gradeImpact(q, []).passed).toBe(false);
  });
});

describe("mastery engine", () => {
  it("promotes on a passing attempt", () => {
    const s = recordAttempt(emptyState("u", "x"), {
      assessmentId: "a",
      targetLevel: BloomLevel.Apply,
      passed: true,
      verifier: "tests",
      at: new Date().toISOString(),
    });
    expect(s.level).toBe(BloomLevel.Apply);
  });

  it("demotes when a review of a mastered level fails (forgetting)", () => {
    const mastered = { ...emptyState("u", "x"), level: BloomLevel.Analyze };
    const s = recordAttempt(mastered, {
      assessmentId: "a",
      targetLevel: BloomLevel.Analyze,
      passed: false,
      verifier: "graph",
      at: new Date().toISOString(),
    });
    expect(s.level).toBe(BloomLevel.Apply); // 4 -> 3
  });

  it("flags due reviews by schedule", () => {
    const past = { ...emptyState("u", "x"), level: 3, nextReviewAt: new Date(Date.now() - 1000).toISOString() };
    const future = { ...emptyState("u", "x"), level: 3, nextReviewAt: new Date(Date.now() + 1e6).toISOString() };
    expect(isDue(past)).toBe(true);
    expect(isDue(future)).toBe(false);
    expect(isDue(emptyState("u", "x"))).toBe(false);
  });
});

describe("create grading", () => {
  it("passes only with no regression and a new test", () => {
    expect(gradeOpenCreate({ passed: 4, total: 4 }, { passed: 5, failed: 0, total: 5 }).passed).toBe(true);
    expect(gradeOpenCreate({ passed: 4, total: 4 }, { passed: 4, failed: 0, total: 4 }).passed).toBe(false);
    expect(gradeOpenCreate({ passed: 4, total: 4 }, { passed: 4, failed: 1, total: 5 }).passed).toBe(false);
  });
});

describe("retrieval", () => {
  it("tokenizes identifiers", () => {
    const t = tokenize("addMany add_many Calculator");
    expect(t).toContain("add");
    expect(t).toContain("many");
    expect(t).toContain("calculator");
  });
  it("ranks relevant nodes", () => {
    const g = buildGraph(ex("py-calc"));
    const hits = retrieve(g, "average of numbers", 5).map((h) => h.node.name);
    expect(hits.some((n) => n.includes("average"))).toBe(true);
  });
});

describe("cross-domain linking (mixed repo)", () => {
  it("links doc sections to the code they describe", () => {
    const root = ex("mixed-app");
    const g = mergeGraphs([buildGraph(root), buildDocsGraph(root)], root);
    const { added } = linkCrossDomain(g);
    expect(added).toBeGreaterThan(0);
    expect(g.edges.some((e) => e.type === "documents")).toBe(true);
  });
});

describe("wiki generation", () => {
  it("produces an index and one page per unit with sources", async () => {
    const root = ex("py-calc");
    const g = buildGraph(root);
    const units = orderUnits(buildUnits(g)).units;
    const sourceOf = (u: (typeof units)[number]) => {
      const n = g.nodes.find((x) => x.id === u.primary)!;
      return readFileSync(`${root}/${n.provenance.path}`, "utf8")
        .split("\n")
        .slice(n.provenance.startLine - 1, n.provenance.endLine)
        .join("\n");
    };
    const wiki = await generateWiki({ units, sourceOf });
    expect(wiki.index).toContain("# Project Wiki");
    expect(wiki.pages.length).toBe(units.length);
    expect(wikiFiles(wiki).length).toBe(units.length + 1);
    expect(wiki.pages[0]!.markdown).toContain("back to index");
  });
});
