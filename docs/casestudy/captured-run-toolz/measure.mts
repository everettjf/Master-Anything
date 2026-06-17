/**
 * Captured-run I/O case study — measure on a real OSS library (pytoolz/toolz).
 *
 * For toolz.dicttoolz, compares what the Behavioral Firewall / characterization
 * oracle can pin (a) with the synthetic fuzz battery alone, vs (b) with
 * captured-run I/O driven by the library's own docstring examples.
 *
 * Usage:
 *   git clone --depth 1 https://github.com/pytoolz/toolz /tmp/toolz
 *   node --import tsx docs/casestudy/captured-run-toolz/measure.mts [/path/to/toolz/toolz]
 *
 * The default toolz package dir is /tmp/toolz/toolz. We copy dicttoolz.py and
 * the bundled driver.py into a throwaway repo so the clone is never mutated.
 */
import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { captureBoundaryIO, characterize, snapshotFile } from "@ma/verifier";

const here = dirname(fileURLToPath(import.meta.url));
const toolzPkg = process.argv[2] ?? "/tmp/toolz/toolz";
const FILE = "dicttoolz.py";

// Assemble a throwaway repo: dicttoolz.py + our driver. (dicttoolz only imports
// the stdlib, so it loads fine as a standalone top-level module.)
const repo = mkdtempSync(join(tmpdir(), "ma-casestudy-"));
copyFileSync(join(toolzPkg, FILE), join(repo, FILE));
copyFileSync(join(here, "driver.py"), join(repo, "driver.py"));

const pad = (s: string, n: number) => s.padEnd(n);
const t0 = Date.now();

console.log(`\ntoolz.dicttoolz — captured-run I/O case study\nrepo: ${toolzPkg}\n`);

// 1. Firewall snapshot: battery-only vs with the driver -----------------------
const base = await snapshotFile({ repoRoot: repo, file: FILE, language: "python" });
const withEntry = await snapshotFile({
  repoRoot: repo,
  file: FILE,
  language: "python",
  entrypoint: "driver.py",
});

const baseSyms = new Map((base?.symbols ?? []).map((s) => [s.symbol, s.cases.length]));
const entrySyms = new Map((withEntry?.symbols ?? []).map((s) => [s.symbol, s.cases.length]));
const allSyms = [...new Set([...baseSyms.keys(), ...entrySyms.keys()])].sort();

console.log("FIREWALL — functions/cases pinned\n");
console.log(`  ${pad("function", 16)} ${pad("battery", 9)} ${pad("+ --entry", 10)}  gain`);
console.log(`  ${"-".repeat(45)}`);
let baseTotal = 0;
let entryTotal = 0;
for (const sym of allSyms) {
  const b = baseSyms.get(sym) ?? 0;
  const e = entrySyms.get(sym) ?? 0;
  baseTotal += b;
  entryTotal += e;
  const gain = e > b ? `  +${e - b}` : "";
  console.log(`  ${pad(sym, 16)} ${pad(String(b), 9)} ${pad(String(e), 10)}${gain}`);
}
console.log(`  ${"-".repeat(45)}`);
console.log(`  ${pad("TOTAL", 16)} ${pad(String(baseTotal), 9)} ${pad(String(entryTotal), 10)}\n`);
console.log(`  functions pinned: ${baseSyms.size} (battery) -> ${entrySyms.size} (+ --entry)\n`);

// 2. Captured-run boundary I/O (what the driver actually observed) ------------
const captured = await captureBoundaryIO({
  repoRoot: repo,
  file: FILE,
  language: "python",
  entrypoint: "driver.py",
});
console.log("CAPTURED boundary I/O (sample real inputs the fuzzer can't build)\n");
for (const s of captured.sort((a, b) => a.symbol.localeCompare(b.symbol))) {
  console.log(`  ${s.symbol}  (${s.cases.length})`);
  console.log(`      e.g. ${s.symbol}(*${s.cases[0]!.args}) -> ${s.cases[0]!.val}`);
}

// 3. Apply / characterization: null without a driver, verifiable with one -----
const targets = ["assoc", "dissoc", "assoc_in", "get_in", "merge"];
console.log("\nCHARACTERIZATION (Apply) — verifiable without / with the driver\n");
console.log(`  ${pad("function", 16)} ${pad("battery", 12)} ${pad("+ --entry", 12)}`);
console.log(`  ${"-".repeat(45)}`);
for (const symbol of targets) {
  const b = await characterize({ repoRoot: repo, file: FILE, symbol, language: "python" });
  const e = await characterize({
    repoRoot: repo,
    file: FILE,
    symbol,
    language: "python",
    entrypoint: "driver.py",
  });
  const fmt = (c: { cases: number } | null) => (c ? `${c.cases} cases ✓` : "unverifiable");
  console.log(`  ${pad(symbol, 16)} ${pad(fmt(b), 12)} ${pad(fmt(e), 12)}`);
}

console.log(`\ndone in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
rmSync(repo, { recursive: true, force: true });
