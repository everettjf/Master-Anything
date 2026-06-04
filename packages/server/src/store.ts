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
  buildUnits,
  embeddingProviderFromEnv,
  enrichUnits,
  orderUnits,
  parseArtifact,
  resolveProvider,
  serializeArtifact,
} from "@ma/core";

export type RepoKind = "code" | "docs";

const DOC_EXT = new Set([".md", ".markdown", ".mdx", ".txt", ".rst", ".html", ".htm"]);

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
  // 1) Try the persisted artifact (commit the graph once, skip the pipeline).
  if (!opts.fresh) {
    const cached = tryLoadArtifact(root);
    if (cached) {
      const record: RepoRecord = {
        id: randomUUID(),
        root,
        kind: cached.kind as RepoKind,
        graph: cached.graph,
        path: { units: cached.units, cycles: cached.cycles },
        units: new Map(cached.units.map((u) => [u.id, u])),
        index: await buildIndex(cached.graph),
        createdAt: new Date().toISOString(),
        fromArtifact: true,
      };
      repos.set(record.id, record);
      return record;
    }
  }

  // 2) Build from source.
  const kind = opts.kind ?? detectKind(root);
  const graph = kind === "docs" ? buildDocsGraph(root) : buildGraph(root);
  const units = await enrichUnits(buildUnits(graph), graph, llm);
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

function tryLoadArtifact(root: string): RepoArtifact | undefined {
  const file = artifactPath(root);
  if (!existsSync(file)) return undefined;
  try {
    const artifact = parseArtifact(readFileSync(file, "utf8"));
    // Invalidate if the repo moved to a new commit since the artifact was built.
    const live = gitCommit(root);
    if (live && artifact.commit && live !== artifact.commit) return undefined;
    return artifact;
  } catch {
    return undefined;
  }
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
