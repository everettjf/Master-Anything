/**
 * PDF docs adapter: extract text per page and model each page as a section.
 *
 * PDFs have no reliable heading structure, so the page is the unit. Reading
 * order gives depends-on edges; the same path / mastery / tutor / Understand /
 * Analyze flows then apply. Async because PDF parsing is async (unpdf/pdf.js).
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { extractText, getDocumentProxy } from "unpdf";
import { BloomLevel, type KnowledgeEdge, type KnowledgeGraph, type KnowledgeNode } from "../types.js";

const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", "artifacts"]);

function firstLine(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > 80 ? `${t.slice(0, 77)}...` : t || "(untitled)";
}

function listPdfs(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.startsWith(".")) continue;
      const full = join(dir, entry);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (!IGNORED_DIRS.has(entry)) walk(full);
      } else if (extname(entry).toLowerCase() === ".pdf") {
        out.push(full);
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

export async function buildPdfGraph(root: string): Promise<KnowledgeGraph> {
  const commit = tryGitCommit(root);
  const files = listPdfs(root);
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];

  for (const abs of files) {
    const rel = relative(root, abs).split(sep).join("/");
    let pages: string[];
    let totalPages = 0;
    try {
      const pdf = await getDocumentProxy(new Uint8Array(readFileSync(abs)));
      const res = await extractText(pdf, { mergePages: false });
      totalPages = res.totalPages;
      pages = (res.text as string[]).map((t) => t.replace(/\s+\n/g, "\n").trim());
    } catch {
      continue; // skip unreadable PDFs
    }

    const docId = `document:${rel}`;
    nodes.push({
      id: docId,
      kind: "document",
      name: rel,
      provenance: { path: rel, startLine: 1, endLine: totalPages, commit },
      prerequisites: [],
      bloomCeiling: BloomLevel.Understand,
    });

    let prev: string | undefined;
    pages.forEach((pageText, i) => {
      const page = i + 1;
      const id = `section:${rel}#page-${page}:${page}`;
      const title = firstLine(pageText) || `Page ${page}`;
      nodes.push({
        id,
        kind: "section",
        name: `p${page}: ${title}`,
        summary: firstLine(pageText.split("\n").slice(1).join(" ")) || title,
        text: pageText,
        provenance: { path: rel, startLine: page, endLine: page, commit },
        prerequisites: [],
        bloomCeiling: BloomLevel.Analyze,
      });
      edges.push({ from: docId, to: id, type: "contains", weight: 1 });
      if (prev) edges.push({ from: id, to: prev, type: "depends-on", weight: 1 });
      prev = id;
    });
  }

  return {
    version: 1,
    repo: { root, commit, builtAt: new Date().toISOString() },
    stats: { files: files.length, nodes: nodes.length, edges: edges.length, languages: { pdf: files.length } },
    nodes,
    edges,
  };
}
