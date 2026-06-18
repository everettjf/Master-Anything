/**
 * Captured-run I/O case study — measure on a real OSS library (object-path, JS).
 *
 * object-path's functions read/write deep object properties. The synthetic fuzz
 * battery can pin *something* for them — but only on primitive inputs, where the
 * functions echo a default or return false. Those "behaviors" don't exercise
 * path traversal, so they give false confidence: a rewrite that breaks the real
 * logic would still pass. Captured-run I/O pins the behaviors that matter.
 *
 * Usage:
 *   git clone --depth 1 https://github.com/mariocasciaro/object-path /tmp/object-path
 *   node --import tsx docs/casestudy/captured-run-objectpath/measure.mts [/path/to/object-path]
 */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureBoundaryIO, snapshotFile } from "@ma/verifier";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = process.argv[2] ?? "/tmp/object-path";
const FILE = "index.js";

const repo = mkdtempSync(join(tmpdir(), "ma-objectpath-"));
copyFileSync(join(pkg, FILE), join(repo, FILE));
copyFileSync(join(here, "driver.js"), join(repo, "driver.js"));

const pad = (s: string, n: number) => s.padEnd(n);
/** A case is "grounded" if any argument is a structured value (object/array). */
const grounded = (args: string) => /[[{].*[[{]/.test(args) || /\{/.test(args);
const t0 = Date.now();

console.log(`\nobject-path — captured-run I/O case study\nrepo: ${pkg}\n`);

const base = await snapshotFile({ repoRoot: repo, file: FILE, language: "javascript" });
const withEntry = await snapshotFile({
  repoRoot: repo,
  file: FILE,
  language: "javascript",
  entrypoint: "driver.js",
});

const baseSyms = new Map((base?.symbols ?? []).map((s) => [s.symbol, s.cases]));
const entrySyms = new Map((withEntry?.symbols ?? []).map((s) => [s.symbol, s.cases]));
const allSyms = [...new Set([...baseSyms.keys(), ...entrySyms.keys()])].sort();

console.log("FIREWALL — behaviors pinned (and how many exercise a real object)\n");
console.log(`  ${pad("function", 12)} ${pad("battery", 22)} ${pad("+ --entry", 22)}`);
console.log(`  ${"-".repeat(58)}`);
for (const sym of allSyms) {
  const b = baseSyms.get(sym) ?? [];
  const e = entrySyms.get(sym) ?? [];
  const bg = b.filter((c) => grounded(c.args)).length;
  const eg = e.filter((c) => grounded(c.args)).length;
  console.log(
    `  ${pad(sym, 12)} ${pad(`${b.length} (${bg} grounded)`, 22)} ${pad(`${e.length} (${eg} grounded)`, 22)}`,
  );
}
const sum = (m: Map<string, { args: string }[]>, f: (c: { args: string }) => boolean) =>
  [...m.values()].reduce((n, cs) => n + cs.filter(f).length, 0);
console.log(`  ${"-".repeat(58)}`);
console.log(
  `  ${pad("TOTAL", 12)} ${pad(`${sum(baseSyms, () => true)} (${sum(baseSyms, (c) => grounded(c.args))} grounded)`, 22)} ` +
    `${pad(`${sum(entrySyms, () => true)} (${sum(entrySyms, (c) => grounded(c.args))} grounded)`, 22)}`,
);

const caps = await captureBoundaryIO({
  repoRoot: repo,
  file: FILE,
  language: "javascript",
  entrypoint: "driver.js",
});
console.log("\nCAPTURED boundary I/O (real path traversal the fuzzer can't reach)\n");
for (const s of caps.sort((a, b) => a.symbol.localeCompare(b.symbol))) {
  const g = s.cases.find((c) => grounded(c.args)) ?? s.cases[0]!;
  console.log(`  ${s.symbol}(*${g.args}) -> ${g.val}`);
}

console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
rmSync(repo, { recursive: true, force: true });
