/**
 * In-memory repo/graph/units store for the P0 MVP.
 * Swapped for a real DB + persisted JSON artifacts in later slices.
 */
import { randomUUID } from "node:crypto";
import { readdirSync } from "node:fs";
import { extname } from "node:path";
import {
  EmbeddingIndex,
  buildDocsGraph,
  buildGraph,
  buildUnits,
  embeddingProviderFromEnv,
  enrichUnits,
  orderUnits,
  resolveProvider,
  type KnowledgeGraph,
  type LearningPath,
  type LearningUnit,
} from "@ma/core";

export type RepoKind = "code" | "docs";

const DOC_EXT = new Set([".md", ".markdown", ".mdx", ".txt", ".rst"]);

const CODE_EXT = new Set([".py", ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs"]);

/** Auto-detect adapter: docs if there's documentation and no code, else code. */
function detectKind(root: string): RepoKind {
  let docs = 0;
  let code = 0;
  const walk = (dir: string, depth: number) => {
    if (depth > 3) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const d of entries) {
      if (d.name.startsWith(".") || d.name === "node_modules") continue;
      if (d.isDirectory()) walk(`${dir}/${d.name}`, depth + 1);
      else {
        const ext = extname(d.name).toLowerCase();
        if (DOC_EXT.has(ext)) docs++;
        else if (CODE_EXT.has(ext)) code++;
      }
    }
  };
  walk(root, 0);
  return code === 0 && docs > 0 ? "docs" : "code";
}

// Optional LLM enrichment + tutor backend (MA_LLM_*); absent -> heuristic.
const { provider: llm, describe: llmDescribe } = resolveProvider();
// Optional embedding backend for semantic retrieval (MA_EMBED_*); absent -> lexical.
const { provider: embedder, describe: embedDescribe } = embeddingProviderFromEnv();
export { llm, llmDescribe, embedDescribe };

export interface RepoRecord {
  id: string;
  root: string;
  kind: RepoKind;
  graph: KnowledgeGraph;
  path: LearningPath;
  units: Map<string, LearningUnit>;
  index?: EmbeddingIndex; // semantic retrieval index, when embeddings configured
  createdAt: string;
}

const repos = new Map<string, RepoRecord>();

export async function addRepo(root: string, kindHint?: RepoKind): Promise<RepoRecord> {
  const kind = kindHint ?? detectKind(root);
  const graph = kind === "docs" ? buildDocsGraph(root) : buildGraph(root);
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
    kind,
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
