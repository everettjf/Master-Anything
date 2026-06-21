/**
 * Real-repo Apply-certification case study — measure on three OSS libraries.
 *
 * For each repo, ingests it (graph -> units -> learning path) and runs the Apply
 * loop with two control agents: oracle (reference impl, must pass all gradable
 * units) and lazy (the blank, must pass none). Perfect discrimination proves the
 * grade is objective. No API key needed.
 *
 * Usage (clone the repos first; slugify needs its one runtime dep importable):
 *   git clone --depth 1 https://github.com/jpvanhal/inflection      /tmp/e2e/inflection
 *   git clone --depth 1 https://github.com/un33k/python-slugify     /tmp/e2e/python-slugify
 *   git clone --depth 1 https://github.com/python-humanize/humanize /tmp/e2e/humanize
 *   python3 -m pip install text-unidecode
 *   node --import tsx docs/casestudy/real-repo-apply-certification/measure.mts
 *
 * The clones are never mutated — ingestion's artifact and every test run happen
 * in throwaway copies.
 */
import { existsSync } from "node:fs";
// @ma/server isn't published with an exports map; import its source directly.
import { certifyAgent, lazySolver, oracleSolver } from "../../../packages/server/src/certify.js";
import { addRepo } from "../../../packages/server/src/store.js";

const REPOS = [
  { name: "inflection", dir: "/tmp/e2e/inflection", limit: undefined },
  { name: "python-slugify", dir: "/tmp/e2e/python-slugify", limit: undefined },
  { name: "humanize", dir: "/tmp/e2e/humanize", limit: 40 },
] as const;

const pad = (s: string, n: number) => s.padEnd(n);
console.log("\nApply-loop certification on real OSS repos\n");
console.log(`${pad("repo", 16)}${pad("gradable", 10)}${pad("verifiedBy", 18)}${pad("oracle", 14)}lazy`);
console.log("-".repeat(64));

for (const { name, dir, limit } of REPOS) {
  if (!existsSync(dir)) {
    console.log(`${pad(name, 16)}(not cloned — see usage)`);
    continue;
  }
  const repo = await addRepo(dir, { fresh: true });
  const oracle = await certifyAgent(repo, oracleSolver, { agent: "oracle", limit });
  const lazy = await certifyAgent(repo, lazySolver, { agent: "lazy", limit });
  const g = oracle.results.filter((r) => r.gradable);
  const by =
    g.length === 0 ? "—" : g.every((r) => r.verifiedBy === g[0]!.verifiedBy) ? g[0]!.verifiedBy : "mixed";
  const ok = oracle.passed === oracle.gradable && oracle.gradable > 0 && lazy.passed === 0;
  console.log(
    `${pad(name, 16)}${pad(String(oracle.gradable), 10)}${pad(by, 18)}` +
      `${pad(`${oracle.passed}/${oracle.gradable}`, 14)}${lazy.passed}/${lazy.gradable}  ${ok ? "✓" : "✗"}`,
  );
}
console.log("\n✓ = oracle passes all gradable units AND lazy passes none (objective discrimination)\n");
