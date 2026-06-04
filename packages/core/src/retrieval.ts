/**
 * GraphRAG retrieval (lexical + 1-hop graph expansion).
 *
 * No embeddings in P0 — score nodes by token overlap against name/summary/
 * signature, then pull in graph neighbors for context. Deterministic and cheap;
 * an embedding retriever can slot in behind the same shape later.
 */
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "./types.js";

export interface RetrievedNode {
  node: KnowledgeNode;
  score: number;
}

/** Split identifiers into lowercase tokens: camelCase, snake_case, dotted, paths. */
export function tokenize(text: string): string[] {
  return (
    text
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 1)
  );
}

function nodeText(n: KnowledgeNode): string {
  return [n.name, n.summary ?? "", n.signature ?? "", n.role ?? "", n.domain ?? ""].join(" ");
}

export function retrieve(graph: KnowledgeGraph, query: string, k = 8): RetrievedNode[] {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0) return [];
  const scored: RetrievedNode[] = [];
  const qLower = query.toLowerCase();

  for (const node of graph.nodes) {
    if (node.kind === "file") continue; // prefer symbols; files come in via expansion
    const tokens = tokenize(nodeText(node));
    let overlap = 0;
    for (const t of tokens) if (qTokens.has(t)) overlap++;
    // boost exact name mention
    const nameHit = qLower.includes(node.name.toLowerCase().split(".").pop() ?? "") ? 2 : 0;
    const score = overlap + nameHit;
    if (score > 0) scored.push({ node, score });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

export function neighbors(graph: KnowledgeGraph, nodeId: string): KnowledgeNode[] {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const out = new Set<string>();
  for (const e of graph.edges) {
    if (e.from === nodeId) out.add(e.to);
    else if (e.to === nodeId) out.add(e.from);
  }
  return [...out].map((id) => byId.get(id)).filter((n): n is KnowledgeNode => Boolean(n));
}

export interface ContextItem {
  id: string;
  name: string;
  ref: string; // path:line
  signature?: string;
  summary?: string;
}

/** Build a grounding context for the LLM: top hits + their direct neighbors. */
export function buildContext(graph: KnowledgeGraph, query: string, k = 6): ContextItem[] {
  const hits = retrieve(graph, query, k);
  const picked = new Map<string, KnowledgeNode>();
  for (const { node } of hits) {
    picked.set(node.id, node);
    for (const nb of neighbors(graph, node.id)) {
      if (nb.kind !== "file") picked.set(nb.id, nb);
    }
  }
  return [...picked.values()].slice(0, k * 3).map((n) => ({
    id: n.id,
    name: n.name,
    ref: `${n.provenance.path}:${n.provenance.startLine}`,
    signature: n.signature,
    summary: n.summary,
  }));
}

export type { KnowledgeEdge };
