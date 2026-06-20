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
 * Languages: Python (pytest), JavaScript (CommonJS, node:test), and TypeScript
 * (ESM + node type-stripping). Targets are module-level functions and methods
 * on zero-arg classes; inputs come from a primitive/collection battery; only
 * cases whose return value round-trips to a literal (so it can be asserted) and
 * is stable across two runs (filters nondeterminism / side effects) are kept.
 * Each case calls a *fresh* instance, matching how the generated test invokes
 * the target.
 */
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SupportedLanguage } from "./breakfix.js";
import { captureBoundaryIO, mergeCases } from "./capture.js";
import { materializeRepo } from "./runner.js";

export interface CharacterizeOptions {
  repoRoot: string;
  /** repo-relative path to the source file */
  file: string;
  /** function name, possibly "Class.method" */
  symbol: string;
  language: SupportedLanguage;
  timeoutMs?: number;
  /**
   * Optional repo-relative driver (example / entrypoint). When set, real
   * input→output pairs observed at the target's boundary while the driver runs
   * are merged into the synthetic battery — so functions taking complex
   * arguments the battery can't construct become verifiable from real usage.
   */
  entrypoint?: string;
  /** extra argv passed to the driver. */
  entryArgv?: string[];
  /**
   * Extra candidate argument-lists to try, in the harness's native literal form
   * (Python: a `repr`'d list like `"[{'a': 1}, 'x']"`; JS/TS: a JSON array like
   * `'[{"a":1},"x"]'`). Typically LLM-proposed for domain-specific coverage; they
   * run through the same round-trip + two-run-stable filter as the battery, so
   * bad guesses are simply dropped. Offline, this is just empty.
   */
  proposedInputs?: string[];
}

export interface Characterization {
  /** repo-relative path of the synthesized test file */
  testPath: string;
  /** contents of the synthesized characterization test */
  testContent: string;
  /** number of golden cases captured */
  cases: number;
}

/** One captured case: `args` is a literal arg-list, `val` a literal expected value. */
interface RawCase {
  args: string;
  val: string;
}
interface OracleResult {
  cases?: RawCase[];
  unsupported?: string;
}

const SENTINEL = "__MA_ORACLE__";
const MODULE_NAME = (file: string) => basename(file).replace(/\.[^.]+$/, "");

// --- process plumbing -------------------------------------------------------

function runProc(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv = {},
): Promise<OracleResult | null> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env } });
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

/** Run the oracle twice; keep only cases whose value is identical across runs. */
async function twoRunStable(runOnce: () => Promise<OracleResult | null>): Promise<RawCase[] | null> {
  const first = await runOnce();
  if (!first?.cases?.length) return null;
  const second = await runOnce();
  if (!second?.cases?.length) return null;
  const stable = new Map(second.cases.map((c) => [c.args, c.val]));
  const cases = first.cases.filter((c) => stable.get(c.args) === c.val);
  return cases.length >= 2 ? cases : null;
}

function testFileName(language: SupportedLanguage, symbol: string): string {
  const slug = symbol.replace(/[^A-Za-z0-9]+/g, "_");
  if (language === "python") return `test_ma_char_${slug}.py`;
  if (language === "typescript") return `ma_char_${slug}.test.ts`;
  return `ma_char_${slug}.test.js`;
}

function placeBeside(file: string, name: string): string {
  const dir = dirname(file);
  return dir === "." ? name : `${dir}/${name}`;
}

// --- Python -----------------------------------------------------------------

function pythonHarness(moduleDir: string, moduleName: string, qualname: string, proposed: string[]): string {
  return `import sys, json, importlib, inspect
sys.path.insert(0, ${JSON.stringify(moduleDir)})
try:
    mod = importlib.import_module(${JSON.stringify(moduleName)})
    parts = ${JSON.stringify(qualname)}.split(".")
    if len(parts) == 2:
        cls = getattr(mod, parts[0]); meth = parts[1]; fn = None
        probe = getattr(cls(), meth)
    else:
        cls = None; meth = None; fn = getattr(mod, parts[0])
        probe = fn
    params = [p for p in inspect.signature(probe).parameters.values()
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

PROPOSED = json.loads(${JSON.stringify(JSON.stringify(proposed))})
def proposed_args():
    out = []
    for s in PROPOSED:
        try:
            v = eval(s)
            if isinstance(v, list):
                out.append(v)
        except Exception:
            pass
    return out

cases = []
for args in candidates(n) + proposed_args():
    try:
        val = (getattr(cls(), meth) if meth is not None else fn)(*args)
    except Exception:
        continue
    try:
        if eval(repr(val)) != val:
            continue
    except Exception:
        continue
    cases.append({"args": repr(list(args)), "val": repr(val)})

print(${JSON.stringify(SENTINEL)} + json.dumps({"cases": cases}))
`;
}

/** A scalar number literal (int/float/exponent), not a bool/string/list — eligible for float tolerance. */
const NUMERIC_LITERAL = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const isNumeric = (val: string) => NUMERIC_LITERAL.test(val.trim());

function pyTest(qualname: string, moduleName: string, cases: RawCase[]): string {
  const parts = qualname.split(".");
  const root = parts[0]!;
  const call = parts.length === 2 ? `${root}().${parts[1]}` : root;
  const anyNumeric = cases.some((c) => isNumeric(c.val));
  // Numeric returns are compared with pytest.approx so a correct reimplementation
  // isn't failed by float noise; non-numeric returns use exact equality.
  const asserts = cases
    .map((c) =>
      isNumeric(c.val)
        ? `    assert ${call}(*${c.args}) == pytest.approx(${c.val})`
        : `    assert ${call}(*${c.args}) == ${c.val}`,
    )
    .join("\n");
  const pytestImport = anyNumeric ? "import pytest\n" : "";
  return `# Auto-generated characterization test — oracle is the original implementation of ${qualname}.
# Generated by Master-Anything to make this function verifiable without a hand-written test.
${pytestImport}from ${moduleName} import ${root}


def test_ma_characterization():
${asserts}
`;
}

// --- JavaScript / TypeScript (Node) -----------------------------------------

/** Shared capture loop; `resolveTarget` is the language-specific prologue building `mod`. */
function nodeHarnessBody(qualname: string, proposed: string[]): string {
  return `const SENT = ${JSON.stringify(SENTINEL)};
let n, cls, meth, fn;
try {
  const parts = ${JSON.stringify(qualname)}.split(".");
  if (parts.length === 2) {
    cls = mod[parts[0]]; meth = parts[1];
    const probe = new cls()[meth];
    if (typeof probe !== "function") throw new Error("not a method");
    n = probe.length;
  } else {
    fn = mod[parts[0]];
    if (typeof fn !== "function") throw new Error("not a function");
    n = fn.length;
  }
} catch (e) { console.log(SENT + JSON.stringify({ unsupported: String((e && e.message) || e) })); process.exit(0); }

const POOL = [0, 1, 2, -3, 10, 2.5, "", "ab", [], [1, 2, 3], [2, 4, 6]];
function candidates(n) {
  if (n === 0) return [[]];
  if (n === 1) return POOL.map((v) => [v]);
  if (n === 2) {
    const nums = [0, 1, 2, -3, 10, 2.5];
    const base = [];
    for (const a of nums) for (const b of nums) base.push([a, b]);
    base.length = Math.min(base.length, 12);
    base.push([[1, 2, 3], [4, 5, 6]]);
    return base;
  }
  const nums = [0, 1, 2, -3, 10];
  return nums.map((a) => Array(n).fill(a));
}

const PROPOSED = ${JSON.stringify(proposed)};
function proposedArgs() {
  const out = [];
  for (const s of PROPOSED) {
    try { const a = JSON.parse(s); if (Array.isArray(a)) out.push(a); } catch {}
  }
  return out;
}

const cases = [];
for (const args of [...candidates(n), ...proposedArgs()]) {
  let val;
  try { val = (meth != null ? new cls()[meth](...args) : fn(...args)); } catch { continue; }
  if (val === undefined || typeof val === "function") continue;
  let j;
  try { j = JSON.stringify(val); } catch { continue; }
  if (j === undefined) continue;
  try { if (!isDeepStrictEqual(JSON.parse(j), val)) continue; } catch { continue; }
  cases.push({ args: JSON.stringify(args), val: j });
}
console.log(SENT + JSON.stringify({ cases }));
`;
}

function jsHarness(moduleAbsPath: string, qualname: string, proposed: string[]): string {
  return `const { isDeepStrictEqual } = require("node:util");
const mod = require(${JSON.stringify(moduleAbsPath)});
${nodeHarnessBody(qualname, proposed)}`;
}

function tsHarness(moduleUrl: string, qualname: string, proposed: string[]): string {
  return `import { isDeepStrictEqual } from "node:util";
const mod = await import(${JSON.stringify(moduleUrl)});
${nodeHarnessBody(qualname, proposed)}`;
}

function nodeTest(
  language: "javascript" | "typescript",
  file: string,
  qualname: string,
  cases: RawCase[],
): string {
  const parts = qualname.split(".");
  const root = parts[0]!;
  const call = parts.length === 2 ? `new ${root}().${parts[1]}` : root;
  // Numeric returns use a tolerance check (float noise); others use deepStrictEqual.
  const asserts = cases
    .map((c) =>
      isNumeric(c.val)
        ? `  assert.ok(Math.abs(${call}(...${c.args}) - ${c.val}) <= 1e-9 * Math.max(1, Math.abs(${c.val})), ${JSON.stringify(`${qualname}(...${c.args})`)});`
        : `  assert.deepStrictEqual(${call}(...${c.args}), ${c.val});`,
    )
    .join("\n");
  const importLine =
    language === "typescript"
      ? `import { ${root} } from "./${basename(file)}";`
      : `const { ${root} } = require("./${MODULE_NAME(file)}");`;
  const header =
    language === "typescript"
      ? `import test from "node:test";\nimport assert from "node:assert";`
      : `const test = require("node:test");\nconst assert = require("node:assert");`;
  return `// Auto-generated characterization test — oracle is the original implementation of ${qualname}.
// Generated by Master-Anything to make this function verifiable without a hand-written test.
${header}
${importLine}

test("ma_characterization", () => {
${asserts}
});
`;
}

// --- entry point ------------------------------------------------------------

/**
 * Build a characterization test for a function. Returns null when the function
 * can't be safely characterized (non-deterministic, needs complex args, returns
 * non-literal objects, or too few stable cases).
 */
export async function characterize(opts: CharacterizeOptions): Promise<Characterization | null> {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const work = await materializeRepo(opts.repoRoot);
  try {
    const moduleAbs = join(work, opts.file);
    let runOnce: () => Promise<OracleResult | null>;
    let emit: (cases: RawCase[]) => string;

    const proposed = opts.proposedInputs ?? [];
    if (opts.language === "python") {
      const script = pythonHarness(
        join(work, dirname(opts.file)),
        MODULE_NAME(opts.file),
        opts.symbol,
        proposed,
      );
      runOnce = () => runProc("python3", ["-c", script], work, timeoutMs, { PYTHONDONTWRITEBYTECODE: "1" });
      emit = (cases) => pyTest(opts.symbol, MODULE_NAME(opts.file), cases);
    } else if (opts.language === "javascript") {
      const harness = join(work, "_ma_oracle.cjs");
      await writeFile(harness, jsHarness(moduleAbs, opts.symbol, proposed), "utf8");
      runOnce = () => runProc("node", [harness], work, timeoutMs);
      emit = (cases) => nodeTest("javascript", opts.file, opts.symbol, cases);
    } else {
      const harness = join(work, "_ma_oracle.mjs");
      await writeFile(harness, tsHarness(pathToFileURL(moduleAbs).href, opts.symbol, proposed), "utf8");
      runOnce = () => runProc("node", ["--experimental-strip-types", harness], work, timeoutMs);
      emit = (cases) => nodeTest("typescript", opts.file, opts.symbol, cases);
    }

    const synthetic = (await twoRunStable(runOnce)) ?? [];

    // Captured-run I/O: grounded cases from the repo's own entrypoint. These can
    // make a function verifiable even when the synthetic battery found nothing
    // (e.g. it takes a dict / domain object the battery can't construct).
    let captured: RawCase[] = [];
    if (opts.entrypoint) {
      const symbols = await captureBoundaryIO({
        repoRoot: opts.repoRoot,
        file: opts.file,
        language: opts.language,
        entrypoint: opts.entrypoint,
        entryArgv: opts.entryArgv,
        timeoutMs,
      });
      captured = symbols.find((s) => s.symbol === opts.symbol)?.cases ?? [];
    }

    const cases = mergeCases(synthetic, captured);
    if (cases.length < 2) return null;
    return {
      testPath: placeBeside(opts.file, testFileName(opts.language, opts.symbol)),
      testContent: emit(cases),
      cases: cases.length,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
