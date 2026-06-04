/**
 * In-memory repo/graph store for the P0.0 walking skeleton.
 * Swapped for a real DB + persisted JSON artifacts in later slices.
 */
import { randomUUID } from "node:crypto";
import { buildGraph, type KnowledgeGraph } from "@ma/core";

export interface RepoRecord {
  id: string;
  root: string;
  graph: KnowledgeGraph;
  createdAt: string;
}

const repos = new Map<string, RepoRecord>();

export function addRepo(root: string): RepoRecord {
  const graph = buildGraph(root);
  const record: RepoRecord = {
    id: randomUUID(),
    root,
    graph,
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
