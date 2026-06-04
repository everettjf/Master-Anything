/**
 * CLI: build a knowledge graph from a directory and print/save it.
 * Usage: pnpm --filter @ma/core graph <dir> [--out graph.json] [--max N]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildGraph } from "./graph.js";

function parseArgs(argv: string[]) {
  const args = { dir: ".", out: undefined as string | undefined, max: undefined as number | undefined };
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--out") args.out = argv[++i];
    else if (a === "--max") args.max = Number(argv[++i]);
    else positional.push(a);
  }
  if (positional[0]) args.dir = positional[0];
  return args;
}

const args = parseArgs(process.argv.slice(2));
const root = resolve(args.dir);

const start = Date.now();
const graph = buildGraph(root, { maxFiles: args.max });
const ms = Date.now() - start;

const counts = graph.nodes.reduce<Record<string, number>>((acc, n) => {
  acc[n.kind] = (acc[n.kind] ?? 0) + 1;
  return acc;
}, {});

console.error(
  `built graph for ${root} in ${ms}ms — ` +
    `files=${graph.stats.files} nodes=${graph.stats.nodes} edges=${graph.stats.edges}`,
);
console.error(`  by kind: ${JSON.stringify(counts)}`);
console.error(`  languages: ${JSON.stringify(graph.stats.languages)}`);

if (args.out) {
  const outPath = resolve(args.out);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(graph, null, 2));
  console.error(`  wrote ${outPath}`);
} else {
  process.stdout.write(JSON.stringify(graph, null, 2) + "\n");
}
