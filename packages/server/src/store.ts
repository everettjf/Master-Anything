/**
 * In-memory repo/graph/units store for the P0 MVP.
 * Swapped for a real DB + persisted JSON artifacts in later slices.
 */
import { randomUUID } from "node:crypto";
import {
  buildGraph,
  EmbeddingIndex,
  buildUnits,
  embeddingProviderFromEnv,
  enrichUnits,
  orderUnits,
  resolveProvider,
  type KnowledgeGraph,
  type LearningPath,
  type LearningUnit,
} from "@ma/core";

// Optional LLM enrichment + tutor backend (MA_LLM_*); absent -> heuristic.
const { provider: llm, describe: llmDescribe } = resolveProvider();
// Optional embedding backend for semantic retrieval (MA_EMBED_*); absent -> lexical.
const { provider: embedder, describe: embedDescribe } = embeddingProviderFromEnv();
export { llm, llmDescribe, embedDescribe };

export interface RepoRecord {
  id: string;
  root: string;
  graph: KnowledgeGraph;
  path: LearningPath;
  units: Map<string, LearningUnit>;
  index?: EmbeddingIndex; // semantic retrieval index, when embeddings configured
  createdAt: string;
}

const repos = new Map<string, RepoRecord>();

export async function addRepo(root: string): Promise<RepoRecord> {
  const graph = buildGraph(root);
  const units = await enrichUnits(buildUnits(graph), graph, llm);
  const path = orderUnits(units);
  // Build a semantic index if an embedding backend is configured (best-effort).
  let index: EmbeddingIndex | undefined;
  if (embedder) {
    try {
      index = await EmbeddingIndex.build(graph, embedder);
    } catch (err) {
      console.warn(`embedding index build failed, falling back to lexical: ${String(err)}`);
    }
  }
  const record: RepoRecord = {
    id: randomUUID(),
    root,
    graph,
    path,
    units: new Map(units.map((u) => [u.id, u])),
    index,
    createdAt: new Date().toISOString(),
  };
  repos.set(record.id, record);
  return record;
}

export function getRepo(id: string): RepoRecord | undefined {
  return repos.get(id);
}

export function listRepos(): RepoRecord[] {
  return [...repos.values()];
}
