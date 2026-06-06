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
  bandName,
  buildUnits,
  computeLayers,
  embeddingProviderFromEnv,
  enrichUnits,
  linkCrossDomain,
  mergeGraphs,
  moduleOf,
  orderUnits,
  parseArtifact,
  resolveProvider,
  serializeArtifact,
} from "@ma/core";
import { getRepoArtifact, putRepoArtifact } from "./db.js";

// "mixed" = more than one domain present (e.g. code + a README/docs).
export type RepoKind = "code" | "docs" | "pdf" | "mixed";

const DOC_EXT = new Set([".md", ".markdown", ".mdx", ".txt", ".rst", ".html", ".htm"]);

const CODE_EXT = new Set([".py", ".js", ".ts", ".tsx", ".jsx", ".mjs", ".cjs"]);

interface Domains {
  code: boolean;
  docs: boolean;
  pdf: boolean;
}

/** Scan which domains are present in a repo (a real repo is often several). */
function scanDomains(root: string): Domains {
  const d: Domains = { code: false, docs: false, pdf: false };
  const walk = (dir: string, depth: number) => {
    if (depth > 6) return;
    let entries: import("node:fs").Dirent[];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith(".") || e.name === "node_modules") continue;
      if (e.isDirectory()) walk(`${dir}/${e.name}`, depth + 1);
      else {
        const ext = extname(e.name).toLowerCase();
        if (ext === ".pdf") d.pdf = true;
        else if (DOC_EXT.has(ext)) d.docs = true;
        else if (CODE_EXT.has(ext)) d.code = true;
      }
    }
  };
  walk(root, 0);
  return d;
}

function kindOf(d: Domains): RepoKind {
  const n = Number(d.code) + Number(d.docs) + Number(d.pdf);
  if (n > 1) return "mixed";
  if (d.code) return "code";
  if (d.docs) return "docs";
  if (d.pdf) return "pdf";
  return "code";
}

/**
 * Build a unified graph across every domain present in the repo. A code repo
 * with a README gets both code units and doc-section units; an explicit kind
 * hint restricts to that single domain.
 */
/** Assign architectural layers to units and tag graph nodes for coloring. */
function annotateLayers(graph: KnowledgeGraph, units: LearningUnit[]): void {
  const { depth, maxDepth } = computeLayers(units);
  const nodeToLayer = new Map<string, number>();
  for (const u of units) {
    const d = depth.get(u.id) ?? 0;
    u.layer = d;
    u.band = bandName(d, maxDepth);
    u.module = moduleOf(u.provenance.path);
    for (const m of u.members) nodeToLayer.set(m, d);
  }
  for (const n of graph.nodes) {
    const d = nodeToLayer.get(n.id);
    if (d !== undefined) n.layer = d;
  }
}

async function buildGraphFor(root: string, hint?: RepoKind): Promise<{ graph: KnowledgeGraph; kind: RepoKind }> {
  const present =
    hint && hint !== "mixed"
      ? { code: hint === "code", docs: hint === "docs", pdf: hint === "pdf" }
      : scanDomains(root);

  const graphs: KnowledgeGraph[] = [];
  if (present.code) graphs.push(buildGraph(root));
  if (present.docs) graphs.push(buildDocsGraph(root));
  if (present.pdf) graphs.push(await buildPdfGraph(root));
  if (graphs.length === 0) graphs.push(buildGraph(root)); // empty repo -> empty code graph

  const graph = graphs.length === 1 ? graphs[0]! : mergeGraphs(graphs, root);
  // Connect doc sections to the code they describe (mixed repos only).
  if (present.code && (present.docs || present.pdf)) {
    const { added } = linkCrossDomain(graph);
    if (added) console.log(`cross-domain: linked ${added} doc->code reference edge(s)`);
  }
  return { graph, kind: kindOf(present) };
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
  const { graph, kind } = await buildGraphFor(root, opts.kind);
  const reuse = prev ? reusableSummaries(prev, graph) : undefined;
  if (reuse?.size) {
    console.log(`incremental: reusing ${reuse.size} summaries; re-enriching changed units only`);
  }
  const units = await enrichUnits(buildUnits(graph), graph, llm, { reuseSummaries: reuse });
  annotateLayers(graph, units);
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

/**
 * Read the artifact regardless of commit (used as an incremental base).
 * Prefers the shareable on-disk artifact (committed with the repo), falling
 * back to the SQLite copy.
 */
function readArtifact(root: string): RepoArtifact | undefined {
  const file = artifactPath(root);
  if (existsSync(file)) {
    try {
      return parseArtifact(readFileSync(file, "utf8"));
    } catch {
      /* fall through to DB */
    }
  }
  const fromDb = getRepoArtifact(root);
  if (fromDb) {
    try {
      return parseArtifact(fromDb);
    } catch {
      /* ignore */
    }
  }
  return undefined;
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
  const json = serializeArtifact(artifact);
  // Durable, queryable copy in SQLite (replaces in-memory persistence)...
  try {
    putRepoArtifact(repo.root, repo.kind, artifact.commit, json);
  } catch (err) {
    console.warn(`could not persist artifact to db: ${String(err)}`);
  }
  // ...plus the shareable on-disk artifact teammates can commit.
  try {
    const file = artifactPath(repo.root);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, json);
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
