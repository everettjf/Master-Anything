/**
 * Learning-unit aggregation + dependency-ordered learning path (P0.1).
 *
 * A learning unit is the smallest thing we ask a learner to master: a coherent
 * concept (a class with its methods, or a top-level function), not a single
 * AST symbol. See docs/P0-CODE-MVP.md §1 step 6-7.
 */
import { BloomLevel, type KnowledgeGraph, type KnowledgeNode, type Provenance } from "./types.js";

export interface LearningUnit {
  id: string;
  title: string;
  kind: "function" | "class" | "section";
  primary: string; // primary node id
  members: string[]; // node ids belonging to this unit
  provenance: Provenance;
  summary?: string; // filled by enrichment (P0.1 heuristic / later LLM)
  prerequisites: string[]; // unit ids that should be learned first
  bloomCeiling: BloomLevel;
}

export interface LearningPath {
  units: LearningUnit[]; // in recommended learning order (prerequisites first)
  cycles: number; // dependency cycles broken during ordering (diagnostic)
}

/** A unit is keyed by its primary symbol node id. */
function isMethodOf(node: KnowledgeNode, className: string): boolean {
  return node.name.startsWith(`${className}.`);
}

export function buildUnits(graph: KnowledgeGraph): LearningUnit[] {
  const symbols = graph.nodes.filter((n) => n.kind === "function" || n.kind === "class");
  const classes = symbols.filter((n) => n.kind === "class");
  const classNames = new Set(classes.map((c) => c.name));

  const units: LearningUnit[] = [];
  const nodeToUnit = new Map<string, string>();

  // One unit per class, absorbing its methods.
  for (const cls of classes) {
    const members = [cls.id];
    for (const sym of symbols) {
      if (sym.kind === "function" && isMethodOf(sym, cls.name)) members.push(sym.id);
    }
    units.push({
      id: cls.id,
      title: cls.name,
      kind: "class",
      primary: cls.id,
      members,
      provenance: cls.provenance,
      prerequisites: [],
      bloomCeiling: BloomLevel.Analyze,
    });
    for (const m of members) nodeToUnit.set(m, cls.id);
  }

  // One unit per remaining top-level function (skip methods, nested, anonymous).
  for (const fn of symbols) {
    if (fn.kind !== "function") continue;
    if (nodeToUnit.has(fn.id)) continue; // already a class method
    if (fn.name.includes("(anonymous)")) continue;
    // skip nested functions: name like "outer.inner" where "outer" is not a class
    const dot = fn.name.indexOf(".");
    if (dot >= 0 && !classNames.has(fn.name.slice(0, dot))) continue;
    units.push({
      id: fn.id,
      title: fn.name,
      kind: "function",
      primary: fn.id,
      members: [fn.id],
      provenance: fn.provenance,
      prerequisites: [],
      bloomCeiling: BloomLevel.Apply,
    });
    nodeToUnit.set(fn.id, fn.id);
  }

  // One unit per document section (docs domain).
  for (const sec of graph.nodes) {
    if (sec.kind !== "section") continue;
    units.push({
      id: sec.id,
      title: sec.name,
      kind: "section",
      primary: sec.id,
      members: [sec.id],
      provenance: sec.provenance,
      summary: sec.summary,
      prerequisites: [],
      bloomCeiling: BloomLevel.Analyze, // Understand + Analyze; no executable Apply
    });
    nodeToUnit.set(sec.id, sec.id);
  }

  // Derive prerequisites from dependency edges: calls (code) or depends-on (docs).
  const prereqs = new Map<string, Set<string>>();
  for (const u of units) prereqs.set(u.id, new Set());
  for (const e of graph.edges) {
    if (e.type !== "calls" && e.type !== "depends-on") continue;
    const from = nodeToUnit.get(e.from);
    const to = nodeToUnit.get(e.to);
    if (!from || !to || from === to) continue;
    prereqs.get(from)!.add(to);
  }
  for (const u of units) u.prerequisites = [...prereqs.get(u.id)!];

  return units;
}

/** Topologically order units so prerequisites come first; breaks cycles. */
export function orderUnits(units: LearningUnit[]): LearningPath {
  const byId = new Map(units.map((u) => [u.id, u]));
  const indeg = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // prereq -> units needing it
  for (const u of units) {
    indeg.set(u.id, 0);
    dependents.set(u.id, []);
  }
  for (const u of units) {
    for (const p of u.prerequisites) {
      if (!byId.has(p)) continue;
      indeg.set(u.id, (indeg.get(u.id) ?? 0) + 1);
      dependents.get(p)!.push(u.id);
    }
  }

  const ordered: LearningUnit[] = [];
  const queue = units.filter((u) => (indeg.get(u.id) ?? 0) === 0).map((u) => u.id);
  const done = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (done.has(id)) continue;
    done.add(id);
    ordered.push(byId.get(id)!);
    for (const dep of dependents.get(id)!) {
      indeg.set(dep, (indeg.get(dep) ?? 1) - 1);
      if ((indeg.get(dep) ?? 0) <= 0) queue.push(dep);
    }
  }

  // Append any units left in cycles (deterministic by id).
  let cycles = 0;
  for (const u of units) {
    if (!done.has(u.id)) {
      ordered.push(u);
      cycles++;
    }
  }
  return { units: ordered, cycles };
}
