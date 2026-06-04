/**
 * In-memory repo/graph/units store for the P0 MVP.
 * Swapped for a real DB + persisted JSON artifacts in later slices.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import {
  EmbeddingIndex,
  type KnowledgeGraph,
  type LearningPath,
  type LearningUnit,
  type RepoArtifact,
  buildDocsGraph,
  buildGraph,
  buildPdfGraph,
  buildUnits,
  embeddingProviderFromEnv,
  enrichUnits,
  orderUnits,
  parseArtifact,
  resolveProvider,
  serializeArtifact,
} from "@ma/core";

export type RepoKind = "code" | "docs" | "pdf";

const DOC_EXT = new Set([".md", ".markdown", ".mdx", ".txt", ".rst", ".html", ".htm"]);

const CODE_EXT = new Set([".py", ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs"]);

/** Auto-detect adapter: code if any code, else docs, else pdf. */
function detectKind(root: string): RepoKind {
  let docs = 0;
  let code = 0;
  let pdf = 0;
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
        if (ext === ".pdf") pdf++;
        else if (DOC_EXT.has(ext)) docs++;
        else if (CODE_EXT.has(ext)) code++;
      }
    }
  };
  walk(root, 0);
  if (code > 0) return "code";
  if (docs > 0) return "docs";
  if (pdf > 0) return "pdf";
  return "code";
}

async function buildGraphFor(kind: RepoKind, root: string): Promise<KnowledgeGraph> {
  if (kind === "pdf") return buildPdfGraph(root);
  if (kind === "docs") return buildDocsGraph(root);
  return buildGraph(root);
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
  fromArtifact: boolean; // loaded from a persisted artifact (pipeline skipped)
}

const repos = new Map<string, RepoRecord>();

const ARTIFACT_REL = ".master-anything/graph.json";
function artifactPath(root: string): string {
  return join(root, ARTIFACT_REL);
}

async function buildIndex(graph: KnowledgeGraph): Promise<EmbeddingIndex | undefined> {
  if (!embedder) return undefined;
  try {
    return await EmbeddingIndex.build(graph, embedder);
  } catch (err) {
    console.warn(`embedding index build failed, falling back to lexical: ${String(err)}`);
    return undefined;
  }
}

export interface AddRepoOptions {
  kind?: RepoKind;
  /** Ignore any persisted artifact and rebuild from source. */
  fresh?: boolean;
}

export async function addRepo(root: string, opts: AddRepoOptions = {}): Promise<RepoRecord> {
  const prev = opts.fresh ? undefined : readArtifact(root);

  // 1) Repo unchanged since the artifact (same commit) -> load, skip the pipeline.
  if (prev && prev.commit && prev.commit === gitCommit(root)) {
    const record: RepoRecord = {
      id: randomUUID(),
      root,
      kind: prev.kind as RepoKind,
      graph: prev.graph,
      path: { units: prev.units, cycles: prev.cycles },
      units: new Map(prev.units.map((u) => [u.id, u])),
      index: await buildIndex(prev.graph),
      createdAt: new Date().toISOString(),
      fromArtifact: true,
    };
    repos.set(record.id, record);
    return record;
  }

  // 2) (Re)build from source. Tree-sitter parsing is cheap; the expensive step
  // is LLM enrichment, so reuse summaries for files whose hash is unchanged
  // (incremental: only the affected subgraph is re-enriched).
  const kind = opts.kind ?? detectKind(root);
  const graph = await buildGraphFor(kind, root);
  const reuse = prev ? reusableSummaries(prev, graph) : undefined;
  if (reuse?.size) {
    console.log(`incremental: reusing ${reuse.size} summaries; re-enriching changed units only`);
  }
  const units = await enrichUnits(buildUnits(graph), graph, llm, { reuseSummaries: reuse });
  const path = orderUnits(units);
  const record: RepoRecord = {
    id: randomUUID(),
    root,
    kind,
    graph,
    path,
    units: new Map(units.map((u) => [u.id, u])),
    index: await buildIndex(graph),
    createdAt: new Date().toISOString(),
    fromArtifact: false,
  };
  repos.set(record.id, record);
  saveArtifact(record);
  return record;
}

/** Read the artifact regardless of commit (used as an incremental base). */
function readArtifact(root: string): RepoArtifact | undefined {
  const file = artifactPath(root);
  if (!existsSync(file)) return undefined;
  try {
    return parseArtifact(readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
}

/** Carry over summaries for units whose source file hash is unchanged. */
function reusableSummaries(prev: RepoArtifact, next: KnowledgeGraph): Map<string, string> {
  const prevHashes = prev.graph.fileHashes ?? {};
  const nextHashes = next.fileHashes ?? {};
  const unchanged = new Set(
    Object.keys(nextHashes).filter((p) => prevHashes[p] && prevHashes[p] === nextHashes[p]),
  );
  const prevNodeById = new Map(prev.graph.nodes.map((n) => [n.id, n]));
  const reuse = new Map<string, string>();
  for (const u of prev.units) {
    const node = prevNodeById.get(u.primary);
    if (u.summary && node && unchanged.has(node.provenance.path)) reuse.set(u.id, u.summary);
  }
  return reuse;
}

function gitCommit(root: string): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

export function saveArtifact(repo: RepoRecord): void {
  const artifact: RepoArtifact = {
    version: 1,
    kind: repo.kind,
    builtAt: repo.createdAt,
    commit: repo.graph.repo.commit,
    graph: repo.graph,
    units: repo.path.units,
    cycles: repo.path.cycles,
  };
  try {
    const file = artifactPath(repo.root);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, serializeArtifact(artifact));
  } catch (err) {
    console.warn(`could not write graph artifact: ${String(err)}`);
  }
}

export function getRepo(id: string): RepoRecord | undefined {
  return repos.get(id);
}

export function listRepos(): RepoRecord[] {
  return [...repos.values()];
}
