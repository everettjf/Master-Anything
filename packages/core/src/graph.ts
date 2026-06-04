/**
 * Repo -> KnowledgeGraph builder (P0.0 walking skeleton).
 * Walks a directory, parses supported files, and emits structural nodes/edges.
 * Semantic enrichment (summary/role/domain) and learning-unit aggregation
 * come in P0.1; here those fields are left empty.
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { languageForExtension } from "./languages.js";
import { type ParsedSymbol, parseSource } from "./parser.js";
import {
  BloomLevel,
  type KnowledgeEdge,
  type KnowledgeGraph,
  type KnowledgeNode,
} from "./types.js";

const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "out",
  "__pycache__",
  ".venv",
  "venv",
  "vendor",
  ".next",
  "coverage",
  "artifacts",
]);

const MAX_FILE_BYTES = 1_000_000; // skip very large/generated files

export interface BuildOptions {
  /** Cap on files parsed, useful for large repos during early development. */
  maxFiles?: number;
}

function listSourceFiles(root: string, maxFiles: number): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    if (out.length >= maxFiles) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (out.length >= maxFiles) return;
      if (entry.startsWith(".") && entry !== ".") continue;
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (IGNORED_DIRS.has(entry)) continue;
        walk(full);
      } else if (st.isFile()) {
        if (st.size > MAX_FILE_BYTES) continue;
        if (languageForExtension(extname(entry))) out.push(full);
      }
    }
  };
  walk(root);
  return out;
}

function tryGitCommit(root: string): string | undefined {
  try {
    return execSync("git rev-parse HEAD", { cwd: root, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return undefined;
  }
}

function fileId(rel: string): string {
  return `file:${rel}`;
}

function symbolId(rel: string, sym: ParsedSymbol): string {
  const qualified = sym.container ? `${sym.container}.${sym.name}` : sym.name;
  return `${sym.kind}:${rel}#${qualified}:${sym.startLine}`;
}

export function buildGraph(root: string, opts: BuildOptions = {}): KnowledgeGraph {
  const maxFiles = opts.maxFiles ?? 5000;
  const commit = tryGitCommit(root);
  const files = listSourceFiles(root, maxFiles);

  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const languages: Record<string, number> = {};
  // name -> defining symbol node ids, for resolving call edges within the repo
  const nameIndex = new Map<string, string[]>();

  interface PendingCall {
    fromId: string;
    callee: string;
  }
  const pendingCalls: PendingCall[] = [];

  for (const abs of files) {
    const rel = relative(root, abs).split(sep).join("/");
    const lang = languageForExtension(extname(abs))!;
    languages[lang.id] = (languages[lang.id] ?? 0) + 1;

    let source: string;
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      continue;
    }

    let parsed;
    try {
      parsed = parseSource(source, lang);
    } catch {
      continue; // never let one bad file break the whole build
    }

    const fNodeId = fileId(rel);
    const lineCount = source.split("\n").length;
    nodes.push({
      id: fNodeId,
      kind: "file",
      name: rel,
      provenance: { path: rel, startLine: 1, endLine: lineCount, commit },
      prerequisites: [],
      bloomCeiling: BloomLevel.Understand,
    });

    for (const sym of parsed.symbols) {
      const id = symbolId(rel, sym);
      nodes.push({
        id,
        kind: sym.kind,
        name: sym.container ? `${sym.container}.${sym.name}` : sym.name,
        signature: sym.signature,
        provenance: { path: rel, startLine: sym.startLine, endLine: sym.endLine, commit },
        prerequisites: [],
        // functions can be practiced to Apply; classes to Analyze (structure)
        bloomCeiling: sym.kind === "function" ? BloomLevel.Apply : BloomLevel.Analyze,
      });
      edges.push({ from: fNodeId, to: id, type: "contains", weight: 1 });

      const list = nameIndex.get(sym.name) ?? [];
      list.push(id);
      nameIndex.set(sym.name, list);

      for (const callee of sym.calls) {
        pendingCalls.push({ fromId: id, callee });
      }
    }
  }

  // Resolve call edges against same-repo definitions (best effort, P0 §1 step 4).
  const seen = new Set<string>();
  for (const { fromId, callee } of pendingCalls) {
    const targets = nameIndex.get(callee);
    if (!targets) continue;
    for (const to of targets) {
      if (to === fromId) continue;
      const key = `${fromId}->${to}`;
      if (seen.has(key)) continue;
      seen.add(key);
      edges.push({ from: fromId, to, type: "calls", weight: 1 });
    }
  }

  return {
    version: 1,
    repo: { root, commit, builtAt: new Date().toISOString() },
    stats: {
      files: files.length,
      nodes: nodes.length,
      edges: edges.length,
      languages,
    },
    nodes,
    edges,
  };
}
