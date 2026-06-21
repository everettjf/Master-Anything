/**
 * CLI: certify an agent against a real repo's Apply loop.
 *
 * Ingests a repo (graph -> units -> learning path), then for every implementable
 * unit blanks the target function and verifies a solver's reimplementation with
 * real tests / the characterization oracle — the same objective check that grades
 * a human's Apply attempt.
 *
 * Usage:
 *   tsx src/certify-cli.ts <repo-dir> [--solver oracle|lazy|llm] [--limit N] [--json]
 *
 * Solvers:
 *   oracle  submit the reference implementation  (perfect baseline; should pass all)
 *   lazy    leave the blank stub untouched       (zero baseline; should pass none)
 *   llm     the configured model (requires a provider key; offline -> error)
 *
 * `oracle` and `lazy` need no API key, so this doubles as an end-to-end
 * self-test of the verification engine on real code: a correct engine passes
 * every gradable unit for `oracle` and none for `lazy`.
 */
import {
  type AgentSolver,
  type CertificationReport,
  certifyAgent,
  lazySolver,
  llmSolver,
  oracleSolver,
} from "./certify.js";
import { addRepo } from "./store.js";

interface Args {
  root?: string;
  solver: "oracle" | "lazy" | "llm";
  limit?: number;
  json: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { solver: "oracle", json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--solver") args.solver = argv[++i] as Args["solver"];
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--json") args.json = true;
    else if (!a.startsWith("-") && !args.root) args.root = a;
  }
  return args;
}

function solverFor(name: Args["solver"]): AgentSolver {
  if (name === "oracle") return oracleSolver;
  if (name === "lazy") return lazySolver;
  const llm = llmSolver();
  if (!llm) {
    console.error("--solver llm requires a configured provider (no API key found).");
    process.exit(2);
  }
  return llm;
}

function printHuman(report: CertificationReport): void {
  const gradable = report.results.filter((r) => r.gradable);
  const bySuite = gradable.filter((r) => r.verifiedBy === "suite").length;
  const byChar = gradable.filter((r) => r.verifiedBy === "characterization").length;
  console.log(`\nagent          : ${report.agent}`);
  console.log(`units attempted: ${report.totalUnits}`);
  console.log(`gradable       : ${report.gradable}  (suite=${bySuite} characterization=${byChar})`);
  console.log(
    `passed         : ${report.passed}/${report.gradable}  (${(report.passRate * 100).toFixed(0)}%)`,
  );
  const fails = gradable.filter((r) => !r.passed);
  if (fails.length) {
    console.log("\nfailures:");
    for (const r of fails) console.log(`  ✗ ${r.unitId}  (${r.verifiedBy})  ${r.title}`);
  }
  if (report.weakest.length) {
    console.log("\nweakest units (belief):");
    for (const w of report.weakest) console.log(`  ${(w.belief * 100).toFixed(0)}%  ${w.title}`);
  }
}

const args = parseArgs(process.argv.slice(2));
if (!args.root) {
  console.error("usage: certify-cli <repo-dir> [--solver oracle|lazy|llm] [--limit N] [--json]");
  process.exit(2);
}

const t0 = Date.now();
const repo = await addRepo(args.root, { fresh: true });
console.error(
  `ingested ${args.root} in ${Date.now() - t0}ms — ` +
    `units=${repo.path.units.length} nodes=${repo.graph.nodes.length} cycles=${repo.path.cycles}`,
);

const report = await certifyAgent(repo, solverFor(args.solver), {
  agent: args.solver,
  limit: args.limit,
});

if (args.json) console.log(JSON.stringify(report, null, 2));
else printHuman(report);
