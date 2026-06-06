/**
 * CLI: generate a Karpathy-style wiki for a directory and write markdown files.
 * Usage: pnpm --filter @ma/core wiki <dir> [--out <dir>]
 *
 * Standalone (no server, no API key) — uses heuristic narration. Handles code
 * (Python/JS/TS) and docs (Markdown/HTML) in the same repo.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildDocsGraph } from "./adapters/docs.js";
import { linkCrossDomain } from "./crosslink.js";
import { enrichUnits } from "./enrich.js";
import { buildGraph } from "./graph.js";
import { mergeGraphs } from "./merge.js";
import type { KnowledgeGraph } from "./types.js";
import { buildUnits, orderUnits } from "./units.js";
import { generateWiki, wikiFiles } from "./wiki.js";

function parseArgs(argv: string[]) {
  const out = { dir: ".", outDir: undefined as string | undefined };
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") out.outDir = argv[++i];
    else pos.push(argv[i]!);
  }
  if (pos[0]) out.dir = pos[0];
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const root = resolve(args.dir);
  const outDir = resolve(args.outDir ?? join(root, ".master-anything", "wiki"));

  // Build a code graph and/or a docs graph depending on what's present.
  const graphs: KnowledgeGraph[] = [buildGraph(root)];
  const docs = buildDocsGraph(root);
  if (docs.nodes.length) graphs.push(docs);
  const graph = graphs.length === 1 ? graphs[0]! : mergeGraphs(graphs, root);
  linkCrossDomain(graph);

  const units = orderUnits(await enrichUnits(buildUnits(graph), graph)).units;
  const sourceOf = (u: (typeof units)[number]) => {
    const n = graph.nodes.find((x) => x.id === u.primary);
    if (!n) return "";
    if (n.text) return n.text;
    const lines = readFileSync(join(root, n.provenance.path), "utf8").split("\n");
    return lines.slice(n.provenance.startLine - 1, n.provenance.endLine).join("\n");
  };

  const wiki = await generateWiki({ units, sourceOf });
  mkdirSync(outDir, { recursive: true });
  const files = wikiFiles(wiki);
  for (const f of files) writeFileSync(join(outDir, f.path), f.content);
  console.error(`wrote ${files.length} wiki files to ${outDir}`);
}

main();
