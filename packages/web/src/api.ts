/** Thin client for the @ma/server API (proxied at /api in dev). */

export interface GraphStats {
  files: number;
  nodes: number;
  edges: number;
  languages: Record<string, number>;
}

export interface RepoSummary {
  id: string;
  root: string;
  stats: GraphStats;
  createdAt: string;
}

export interface GraphNode {
  id: string;
  kind: "file" | "class" | "function" | "unit";
  name: string;
  signature?: string;
  provenance: { path: string; startLine: number; endLine: number };
  bloomCeiling: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: "contains" | "imports" | "depends-on" | "calls";
  weight: number;
}

export interface KnowledgeGraph {
  stats: GraphStats;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SourceSlice {
  path: string;
  startLine: number;
  endLine: number;
  code: string;
}

const BASE = "/api";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function connectRepo(path: string): Promise<RepoSummary> {
  const res = await fetch(`${BASE}/repos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
  return jsonOrThrow<RepoSummary>(res);
}

export async function fetchGraph(id: string): Promise<KnowledgeGraph> {
  return jsonOrThrow<KnowledgeGraph>(await fetch(`${BASE}/repos/${id}/graph`));
}

export async function fetchSource(id: string, nodeId: string): Promise<SourceSlice> {
  return jsonOrThrow<SourceSlice>(
    await fetch(`${BASE}/repos/${id}/source?node=${encodeURIComponent(nodeId)}`),
  );
}
