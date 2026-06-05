/**
 * Cross-domain linking: connect doc sections to the code they describe.
 *
 * Run after mergeGraphs on a mixed repo. For each doc/PDF section we look for
 * mentions of *distinctive* code symbol names (PascalCase / camelCase / snake_case
 * / qualified) and add a `documents` edge (section -> code node). This turns two
 * islands into one graph, so the tutor can cite code + its docs together and
 * Analyze can answer "change X -> which docs are affected?".
 */
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "./types.js";

/** Only match names unlikely to collide with plain English to limit noise. */
function isDistinctive(name: string): boolean {
  if (name.length < 4) return false;
  const camelCase = /[a-z][A-Z]/.test(name); // addMany
  const pascalCase = /^[A-Z][a-z]{3,}/.test(name); // Calculator
  const snakeCase = name.includes("_"); // add_many
  return camelCase || pascalCase || snakeCase;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MAX_LINKS_PER_SECTION = 12;

export function linkCrossDomain(graph: KnowledgeGraph): { added: number } {
  // Index distinctive code symbol simple-names -> code node ids.
  const index = new Map<string, string[]>();
  for (const n of graph.nodes) {
    if (n.kind !== "function" && n.kind !== "class") continue;
    const simple = n.name.split(".").pop() ?? n.name;
    if (!isDistinctive(simple)) continue;
    const list = index.get(simple) ?? [];
    list.push(n.id);
    index.set(simple, list);
  }
  if (index.size === 0) return { added: 0 };

  // Precompile one matcher per distinctive name.
  const matchers = [...index.keys()].map((name) => ({
    name,
    re: new RegExp(`(?<![\\w.])${escapeRe(name)}(?![\\w])`),
  }));

  const existing = new Set(graph.edges.map((e) => `${e.from}->${e.to}:${e.type}`));
  const added: KnowledgeEdge[] = [];

  for (const sec of graph.nodes) {
    if (sec.kind !== "section") continue;
    const haystack = `${sec.name}\n${sec.text ?? sec.summary ?? ""}`;
    if (!haystack) continue;
    let count = 0;
    for (const { name, re } of matchers) {
      if (count >= MAX_LINKS_PER_SECTION) break;
      if (!re.test(haystack)) continue;
      for (const target of index.get(name)!) {
        const key = `${sec.id}->${target}:documents`;
        if (existing.has(key)) continue;
        existing.add(key);
        added.push({ from: sec.id, to: target, type: "documents", weight: 1 });
        count++;
      }
    }
  }

  graph.edges.push(...added);
  graph.stats.edges = graph.edges.length;
  return { added: added.length };
}

export function codeNodesById(graph: KnowledgeGraph): Map<string, KnowledgeNode> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}
