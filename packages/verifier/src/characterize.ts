/**
 * Universal verification (thrust A): synthesize a *characterization test* using
 * the original implementation as the oracle.
 *
 * The verifiable-Apply loop normally needs a pre-existing test that happens to
 * cover one function — true for only a slice of real code. Here we instead run
 * the original function on a battery of inputs, capture its outputs as golden
 * values, and emit a generated test asserting those outputs. Blanking the
 * function then breaks that test, so *any* deterministic, literal-returning
 * function becomes verifiable — no human-written test required.
 *
 * Scope (v1): Python; module-level functions and methods on zero-arg classes;
 * inputs drawn from a primitive/collection battery; only cases whose return
 * value round-trips through `repr` (so it can be asserted as a literal) and is
 * stable across two runs (filters nondeterminism / side effects) are kept.
 */
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { SupportedLanguage } from "./breakfix.js";
import { materializeRepo } from "./runner.js";

export interface CharacterizeOptions {
  repoRoot: string;
  /** repo-relative path to the source file */
  file: string;
  /** function name, possibly "Class.method" */
  symbol: string;
  language: SupportedLanguage;
  timeoutMs?: number;
}

export interface Characterization {
  /** repo-relative path of the synthesized test file */
  testPath: string;
  /** contents of the synthesized characterization test */
  testContent: string;
  /** number of golden cases captured */
  cases: number;
}

interface OracleCase {
  args_py: string;
  val_py: string;
}
interface OracleResult {
  cases?: OracleCase[];
  unsupported?: string;
}

const SENTINEL = "__MA_ORACLE__";

/** The introspection harness: resolve the target, fuzz it, capture stable literal outputs. */
function pythonHarness(moduleDir: string, moduleName: string, qualname: string): string {
  return `import sys, json, importlib, inspect
sys.path.insert(0, ${JSON.stringify(moduleDir)})
try:
    mod = importlib.import_module(${JSON.stringify(moduleName)})
    parts = ${JSON.stringify(qualname)}.split(".")
    if len(parts) == 2:
        target = getattr(${"getattr(mod, parts[0])()"}, parts[1])
    else:
        target = getattr(mod, parts[0])
    params = [p for p in inspect.signature(target).parameters.values()
              if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD) and p.default is p.empty]
    n = len(params)
except Exception as e:
    print(${JSON.stringify(SENTINEL)} + json.dumps({"unsupported": type(e).__name__}))
    raise SystemExit

POOL = [0, 1, 2, -3, 10, 2.5, "", "ab", [], [1, 2, 3], [2, 4, 6]]
def candidates(n):
    if n == 0:
        return [[]]
    if n == 1:
        return [[v] for v in POOL]
    if n == 2:
        nums = [0, 1, 2, -3, 10, 2.5]
        base = [[a, b] for a in nums for b in nums][:12]
        base.append([[1, 2, 3], [4, 5, 6]])
        return base
    nums = [0, 1, 2, -3, 10]
    return [[a] * n for a in nums]

cases = []
for args in candidates(n):
    try:
        val = target(*args)
    except Exception:
        continue
    try:
        if eval(repr(val)) != val:
            continue
    except Exception:
        continue
    cases.append({"args_py": repr(list(args)), "val_py": repr(val)})

print(${JSON.stringify(SENTINEL)} + json.dumps({"cases": cases}))
`;
}

function runHarness(workDir: string, script: string, timeoutMs: number): Promise<OracleResult | null> {
  return new Promise((resolve) => {
    const child = spawn("python3", ["-c", script], {
      cwd: workDir,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    let out = "";
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("close", () => {
      clearTimeout(timer);
      const line = out
        .split("\n")
        .reverse()
        .find((l) => l.startsWith(SENTINEL));
      if (!line) return resolve(null);
      try {
        resolve(JSON.parse(line.slice(SENTINEL.length)) as OracleResult);
      } catch {
        resolve(null);
      }
    });
    child.on("error", () => {
      clearTimeout(timer);
      resolve(null);
    });
  });
}

function pyCall(qualname: string, moduleName: string): { importLine: string; call: string } {
  const parts = qualname.split(".");
  if (parts.length === 2) {
    return {
      importLine: `from ${moduleName} import ${parts[0]}`,
      call: `${parts[0]}().${parts[1]}`,
    };
  }
  return { importLine: `from ${moduleName} import ${parts[0]}`, call: parts[0]! };
}

function pyTest(qualname: string, moduleName: string, cases: OracleCase[]): string {
  const { importLine, call } = pyCall(qualname, moduleName);
  const asserts = cases.map((c) => `    assert ${call}(*${c.args_py}) == ${c.val_py}`).join("\n");
  return `# Auto-generated characterization test — oracle is the original implementation of ${qualname}.
# Generated by Master-Anything to make this function verifiable without a hand-written test.
${importLine}


def test_ma_characterization():
${asserts}
`;
}

/**
 * Build a characterization test for a function. Returns null when the function
 * can't be safely characterized (non-deterministic, needs complex args, returns
 * non-literal objects, or too few stable cases).
 */
export async function characterize(opts: CharacterizeOptions): Promise<Characterization | null> {
  if (opts.language !== "python") return null; // v1: Python only
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const moduleName = basename(opts.file).replace(/\.[^.]+$/, "");
  const work = await materializeRepo(opts.repoRoot);
  try {
    const moduleDir = join(work, dirname(opts.file));
    const script = pythonHarness(moduleDir, moduleName, opts.symbol);
    const first = await runHarness(work, script, timeoutMs);
    if (!first?.cases?.length) return null;
    // Determinism / side-effect filter: keep only cases stable across a second run.
    const second = await runHarness(work, script, timeoutMs);
    if (!second?.cases?.length) return null;
    const stable = new Map(second.cases.map((c) => [c.args_py, c.val_py]));
    const cases = first.cases.filter((c) => stable.get(c.args_py) === c.val_py);
    if (cases.length < 2) return null;

    const dir = dirname(opts.file);
    const fileName = `test_ma_char_${opts.symbol.replace(/[^A-Za-z0-9]+/g, "_")}.py`;
    const testPath = dir === "." ? fileName : `${dir}/${fileName}`;
    const testContent = pyTest(opts.symbol, moduleName, cases);
    return { testPath, testContent, cases: cases.length };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
