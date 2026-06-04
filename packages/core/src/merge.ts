/**
 * Merge graphs from multiple domain adapters into one knowledge graph.
 *
 * A real repo is rarely pure: code + a README + docs/ + the odd PDF. Node ids
 * are namespaced by kind+path, so adapters never collide and the merged graph
 * carries code units (functions/classes) and doc units (sections) together.
 */
import type { KnowledgeEdge, KnowledgeGraph, KnowledgeNode } from "./types.js";

export function mergeGraphs(graphs: KnowledgeGraph[], root: string): KnowledgeGraph {
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const languages: Record<string, number> = {};
  const fileHashes: Record<string, string> = {};
  let files = 0;
  let commit: string | undefined;

  for (const g of graphs) {
    commit ??= g.repo.commit;
    nodes.push(...g.nodes);
    edges.push(...g.edges);
    files += g.stats.files;
    for (const [k, v] of Object.entries(g.stats.languages)) languages[k] = (languages[k] ?? 0) + v;
    Object.assign(fileHashes, g.fileHashes ?? {});
  }

  return {
    version: 1,
    repo: { root, commit, builtAt: new Date().toISOString() },
    stats: { files, nodes: nodes.length, edges: edges.length, languages },
    fileHashes,
    nodes,
    edges,
  };
}
