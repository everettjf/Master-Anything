/**
 * Docs domain adapter (P1): Markdown/text -> knowledge graph.
 *
 * Proves the engine is domain-agnostic — sections become learning units, and
 * the same path / mastery / tutor / Understand / Analyze flows apply. No code
 * concepts here; only documents, sections, and their relationships.
 *
 *   document --contains--> section
 *   section  --depends-on--> previous sibling (reading order)
 *   section  --refers-to--> linked section ([text](other.md#anchor))
 */
import { execSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { BloomLevel, type KnowledgeEdge, type KnowledgeGraph, type KnowledgeNode } from "../types.js";

const DOC_EXT = new Set([".md", ".markdown", ".mdx", ".txt", ".rst", ".html", ".htm"]);
const HTML_EXT = new Set([".html", ".htm"]);
const IGNORED_DIRS = new Set([".git", "node_modules", "dist", "build", ".venv", "venv", "artifacts"]);

interface Section {
  title: string;
  level: number;
  startLine: number;
  endLine: number;
  anchor: string;
  body: string;
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

/** Split a markdown file into sections by ATX headings. */
function parseSections(source: string): Section[] {
  const lines = source.split("\n");
  const heads: { title: string; level: number; line: number }[] = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (inFence) return;
    const m = /^(#{1,6})\s+(.*)$/.exec(line);
    if (m) heads.push({ title: m[2]!.trim(), level: m[1]!.length, line: i + 1 });
  });
  if (heads.length === 0) return [];

  return heads.map((h, idx) => {
    const endLine = idx + 1 < heads.length ? heads[idx + 1]!.line - 1 : lines.length;
    const body = lines.slice(h.line, endLine).join("\n").trim();
    return { title: h.title, level: h.level, startLine: h.line, endLine, anchor: slug(h.title), body };
  });
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split an HTML document into sections by <h1>..<h6> headings (line-based). */
function parseHtmlSections(source: string): Section[] {
  const lines = source.split("\n");
  const heads: { title: string; level: number; line: number; anchor: string }[] = [];
  const headRe = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/i;
  lines.forEach((line, i) => {
    const m = headRe.exec(line);
    if (!m) return;
    const level = Number(m[1]);
    const idAttr = /\bid\s*=\s*["']([^"']+)["']/i.exec(m[2]!)?.[1];
    const title = stripTags(m[3]!);
    heads.push({ title, level, line: i + 1, anchor: idAttr ?? slug(title) });
  });
  if (heads.length === 0) return [];
  return heads.map((h, idx) => {
    const endLine = idx + 1 < heads.length ? heads[idx + 1]!.line - 1 : lines.length;
    const body = stripTags(lines.slice(h.line, endLine).join("\n"));
    return { title: h.title, level: h.level, startLine: h.line, endLine, anchor: h.anchor, body };
  });
}

function sectionsFor(path: string, source: string): Section[] {
  return HTML_EXT.has(extname(path).toLowerCase()) ? parseHtmlSections(source) : parseSections(source);
}

function firstSentence(body: string): string {
  const text = body
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#>*`_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  const dot = text.indexOf(". ");
  const s = dot > 0 ? text.slice(0, dot + 1) : text;
  return s.length > 200 ? `${s.slice(0, 197)}...` : s;
}

function listDocs(root: string): string[] {
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
      } else if (DOC_EXT.has(extname(entry).toLowerCase())) {
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

export function buildDocsGraph(root: string): KnowledgeGraph {
  const commit = tryGitCommit(root);
  const files = listDocs(root);
  const nodes: KnowledgeNode[] = [];
  const edges: KnowledgeEdge[] = [];
  const languages: Record<string, number> = {};
  // (file, anchor) -> section node id, for resolving cross-references
  const anchorIndex = new Map<string, string>();

  for (const abs of files) {
    const rel = relative(root, abs).split(sep).join("/");
    const lang = HTML_EXT.has(extname(abs).toLowerCase()) ? "html" : "markdown";
    languages[lang] = (languages[lang] ?? 0) + 1;
    let source: string;
    try {
      source = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const docId = `document:${rel}`;
    nodes.push({
      id: docId,
      kind: "document",
      name: rel,
      provenance: { path: rel, startLine: 1, endLine: source.split("\n").length, commit },
      prerequisites: [],
      bloomCeiling: BloomLevel.Understand,
    });

    const sections = sectionsFor(rel, source);
    let prevByLevel: Record<number, string> = {};
    sections.forEach((sec) => {
      const id = `section:${rel}#${sec.anchor}:${sec.startLine}`;
      nodes.push({
        id,
        kind: "section",
        name: sec.title,
        summary: firstSentence(sec.body),
        text: sec.body,
        provenance: { path: rel, startLine: sec.startLine, endLine: sec.endLine, commit },
        prerequisites: [],
        bloomCeiling: BloomLevel.Analyze,
      });
      anchorIndex.set(`${rel}#${sec.anchor}`, id);
      edges.push({ from: docId, to: id, type: "contains", weight: 1 });

      // reading-order dependency: this section builds on the previous sibling
      const prevSibling = prevByLevel[sec.level];
      if (prevSibling) edges.push({ from: id, to: prevSibling, type: "depends-on", weight: 1 });
      prevByLevel[sec.level] = id;
      // deeper levels reset when we go shallower
      for (const lvl of Object.keys(prevByLevel)) {
        if (Number(lvl) > sec.level) delete prevByLevel[Number(lvl)];
      }
    });
  }

  // Resolve cross-reference links into refers-to edges (markdown + HTML href).
  const linkRe = /\[[^\]]+\]\(([^)]+)\)|href\s*=\s*["']([^"']+)["']/gi;
  for (const node of nodes) {
    if (node.kind !== "section") continue;
    const abs = join(root, node.provenance.path);
    let body: string;
    try {
      body = readFileSync(abs, "utf8")
        .split("\n")
        .slice(node.provenance.startLine - 1, node.provenance.endLine)
        .join("\n");
    } catch {
      continue;
    }
    for (const m of body.matchAll(linkRe)) {
      const href = m[1] ?? m[2];
      if (!href) continue;
      const target = resolveLink(href, node.provenance.path, anchorIndex);
      if (target && target !== node.id) edges.push({ from: node.id, to: target, type: "refers-to", weight: 1 });
    }
  }

  return {
    version: 1,
    repo: { root, commit, builtAt: new Date().toISOString() },
    stats: { files: files.length, nodes: nodes.length, edges: edges.length, languages },
    nodes,
    edges,
  };
}

function resolveLink(
  href: string,
  fromPath: string,
  anchorIndex: Map<string, string>,
): string | undefined {
  if (href.startsWith("http")) return undefined;
  const [pathPart, anchor] = href.split("#");
  const targetPath = pathPart ? normalizeRel(fromPath, pathPart) : fromPath;
  if (anchor) return anchorIndex.get(`${targetPath}#${anchor}`);
  // link to a file with no anchor -> its first section
  for (const [key, id] of anchorIndex) if (key.startsWith(`${targetPath}#`)) return id;
  return undefined;
}

function normalizeRel(fromPath: string, rel: string): string {
  const baseParts = fromPath.split("/").slice(0, -1);
  for (const part of rel.split("/")) {
    if (part === "." || part === "") continue;
    if (part === "..") baseParts.pop();
    else baseParts.push(part);
  }
  return baseParts.join("/");
}
