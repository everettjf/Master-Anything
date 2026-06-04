/**
 * In-memory repo/graph/units store for the P0 MVP.
 * Swapped for a real DB + persisted JSON artifacts in later slices.
 */
import { randomUUID } from "node:crypto";
import {
  buildGraph,
  buildUnits,
  enrichUnits,
  orderUnits,
  resolveProvider,
  type KnowledgeGraph,
  type LearningPath,
  type LearningUnit,
} from "@ma/core";

// Optional LLM enrichment backend. token.js multi-provider (MA_LLM_PROVIDER) or
// a generic OpenAI-compatible endpoint (MA_LLM_BASE_URL); absent -> heuristic.
const { provider: llm, describe: llmDescribe } = resolveProvider();
export { llm, llmDescribe };

export interface RepoRecord {
  id: string;
  root: string;
  graph: KnowledgeGraph;
  path: LearningPath;
  units: Map<string, LearningUnit>;
  createdAt: string;
}

const repos = new Map<string, RepoRecord>();

export async function addRepo(root: string): Promise<RepoRecord> {
  const graph = buildGraph(root);
  const units = await enrichUnits(buildUnits(graph), graph, llm);
  const path = orderUnits(units);
  const record: RepoRecord = {
    id: randomUUID(),
    root,
    graph,
    path,
    units: new Map(units.map((u) => [u.id, u])),
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
