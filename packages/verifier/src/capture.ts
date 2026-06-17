/**
 * Captured-run I/O (thrust A, deepening) — harvest *real* input→output pairs at
 * function boundaries by running the repo's own entrypoint/example.
 *
 * The synthetic battery in characterize.ts / snapshot.ts fuzzes primitives and
 * collections. That works for arithmetic-shaped functions but can't construct
 * the rich arguments real code takes (a config dict, a nested order, a domain
 * object), so those functions stay unverifiable. Here we instead *instrument*
 * the target module — wrap every public function/method to record the arguments
 * and return value of each call — then execute a driver the repo already ships
 * (an example script, a CLI entrypoint). The captured pairs are grounded in how
 * the code is actually used, not guessed.
 *
 * The output is the same `{ args, val }` literal-string shape the battery
 * produces, so captured cases merge straight into both the characterization
 * oracle (making complex-arg functions verifiable) and the Behavioral Firewall
 * (pinning real-world behavior). Only deterministic, literal-round-tripping
 * pairs survive (args and return must both serialize and reload equal; a pair
 * seen twice with different results is dropped), and the driver is run twice and
 * intersected — matching the rest of the engine's nondeterminism filtering.
 *
 * Languages: Python and JavaScript capture both functions and methods;
 * TypeScript (ESM) captures methods (its namespace exports are read-only, so
 * top-level functions can't be wrapped in-process). Pure, offline, zero-dep.
 */
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SupportedLanguage } from "./breakfix.js";
import { materializeRepo } from "./runner.js";
import type { SymbolSnapshot } from "./snapshot.js";

export interface CaptureOptions {
  repoRoot: string;
  /** repo-relative path of the module to instrument. */
  file: string;
  language: SupportedLanguage;
  /** repo-relative path of the driver to run (an example / entrypoint script). */
  entrypoint: string;
  /** extra argv passed to the driver (sys.argv / process.argv tail). */
  entryArgv?: string[];
  timeoutMs?: number;
}

const SENTINEL = "__MA_CAPTURE__";
const moduleName = (file: string) => basename(file).replace(/\.[^.]+$/, "");

interface Parsed {
  symbols?: SymbolSnapshot[];
  error?: string;
}

function runProc(
  cmd: string,
  args: string[],
  cwd: string,
  timeoutMs: number,
  env: NodeJS.ProcessEnv = {},
): Promise<Parsed | null> {
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
        resolve(JSON.parse(line.slice(SENTINEL.length)) as Parsed);
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

// --- Python harness ----------------------------------------------------------

function pyCaptureHarness(
  moduleDir: string,
  repoRoot: string,
  mod: string,
  entryAbs: string,
  argv: string[],
): string {
  return `import sys, json, importlib, inspect, runpy
sys.path.insert(0, ${JSON.stringify(moduleDir)})
sys.path.insert(0, ${JSON.stringify(repoRoot)})
SENT = ${JSON.stringify(SENTINEL)}
records = {}  # symbol -> { args_repr: val_repr | None(poisoned) }
def lit(v):
    try:
        return repr(v) if eval(repr(v)) == v else None
    except Exception:
        return None
def record(symbol, args, val):
    a = lit(list(args))
    if a is None:
        return
    v = lit(val)
    if v is None:
        return
    slot = records.setdefault(symbol, {})
    if a in slot:
        if slot[a] is not None and slot[a] != v:
            slot[a] = None  # nondeterministic -> drop this (symbol, args)
    else:
        slot[a] = v
def wrap_fn(symbol, orig):
    def w(*args, **kwargs):
        val = orig(*args, **kwargs)
        if not kwargs:
            try: record(symbol, args, val)
            except Exception: pass
        return val
    return w
def wrap_method(symbol, orig):
    def w(self, *args, **kwargs):
        val = orig(self, *args, **kwargs)
        if not kwargs:
            try: record(symbol, args, val)
            except Exception: pass
        return val
    return w
try:
    mod = importlib.import_module(${JSON.stringify(mod)})
except Exception as e:
    print(SENT + json.dumps({"error": type(e).__name__ + ": " + str(e)})); raise SystemExit
for name, obj in list(vars(mod).items()):
    if name.startswith("_"):
        continue
    if inspect.isfunction(obj) and getattr(obj, "__module__", None) == mod.__name__:
        setattr(mod, name, wrap_fn(name, obj))
    elif inspect.isclass(obj) and getattr(obj, "__module__", None) == mod.__name__:
        for mname, m in inspect.getmembers(obj, inspect.isfunction):
            if mname.startswith("_"):
                continue
            if getattr(m, "__module__", None) != mod.__name__:
                continue
            setattr(obj, mname, wrap_method("%s.%s" % (name, mname), m))
sys.argv = [${JSON.stringify(entryAbs)}] + json.loads(${JSON.stringify(JSON.stringify(argv))})
try:
    runpy.run_path(${JSON.stringify(entryAbs)}, run_name="__main__")
except SystemExit:
    pass
except Exception:
    pass
symbols = []
for symbol, slot in records.items():
    cases = [{"args": a, "val": v} for a, v in slot.items() if v is not None]
    if cases:
        symbols.append({"symbol": symbol, "cases": cases})
print(SENT + json.dumps({"symbols": symbols}))
`;
}

// --- Node (JS/TS) harness ----------------------------------------------------

function nodeCaptureBody(entryStmt: string, argv: string[]): string {
  return `const SENT = ${JSON.stringify(SENTINEL)};
process.argv = [process.argv[0], process.argv[1], ...${JSON.stringify(argv)}];
const records = {};  // symbol -> Map(argsJson -> valJson | null)
function lit(v) {
  if (v === undefined || typeof v === "function") return undefined;
  let j;
  try { j = JSON.stringify(v); } catch { return undefined; }
  if (j === undefined) return undefined;
  try { if (!isDeepStrictEqual(JSON.parse(j), v)) return undefined; } catch { return undefined; }
  return j;
}
function record(symbol, args, val) {
  const a = lit(args);
  if (a === undefined) return;
  const v = lit(val);
  if (v === undefined) return;
  let slot = records[symbol];
  if (!slot) { slot = records[symbol] = new Map(); }
  if (slot.has(a)) { if (slot.get(a) !== null && slot.get(a) !== v) slot.set(a, null); }
  else slot.set(a, v);
}
const isClass = (f) => /^class[\\s{]/.test(Function.prototype.toString.call(f));
for (const [name, obj] of Object.entries(mod)) {
  if (typeof obj !== "function") continue;
  if (isClass(obj)) {
    const proto = obj.prototype;
    for (const m of Object.getOwnPropertyNames(proto)) {
      if (m === "constructor") continue;
      const orig = proto[m];
      if (typeof orig !== "function") continue;
      try {
        proto[m] = function (...args) {
          const val = orig.apply(this, args);
          try { record(name + "." + m, args, val); } catch {}
          return val;
        };
      } catch {}
    }
  } else {
    const orig = obj;
    try {
      mod[name] = function (...args) {
        const val = orig(...args);
        try { record(name, args, val); } catch {}
        return val;
      };
    } catch {}
  }
}
${entryStmt}
const symbols = [];
for (const [symbol, slot] of Object.entries(records)) {
  const cases = [];
  for (const [a, v] of slot) if (v !== null) cases.push({ args: a, val: v });
  if (cases.length) symbols.push({ symbol, cases });
}
console.log(SENT + JSON.stringify({ symbols }));
`;
}

const jsPrologue = (abs: string) =>
  `const { isDeepStrictEqual } = require("node:util");\nconst mod = require(${JSON.stringify(abs)});\n`;
const tsPrologue = (url: string) =>
  `import { isDeepStrictEqual } from "node:util";\nconst mod = await import(${JSON.stringify(url)});\n`;

// --- intersection of two runs ------------------------------------------------

/** Keep only (symbol, args) pairs present in both runs with identical values. */
function intersect(a: SymbolSnapshot[], b: SymbolSnapshot[]): SymbolSnapshot[] {
  const ref = new Map<string, Map<string, string>>();
  for (const s of b) ref.set(s.symbol, new Map(s.cases.map((c) => [c.args, c.val])));
  const out: SymbolSnapshot[] = [];
  for (const s of a) {
    const other = ref.get(s.symbol);
    if (!other) continue;
    const cases = s.cases.filter((c) => other.get(c.args) === c.val);
    if (cases.length) out.push({ symbol: s.symbol, cases });
  }
  return out;
}

// --- public API --------------------------------------------------------------

/**
 * Run the repo's entrypoint with the target module instrumented and return the
 * real input→output pairs observed at each public function/method boundary.
 * Never throws — returns `[]` when the driver fails to load, runs nothing
 * relevant, or yields no deterministic, literal-round-tripping calls.
 */
export async function captureBoundaryIO(opts: CaptureOptions): Promise<SymbolSnapshot[]> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const argv = opts.entryArgv ?? [];

  const runOnce = async (): Promise<SymbolSnapshot[]> => {
    const work = await materializeRepo(opts.repoRoot);
    try {
      const moduleAbs = join(work, opts.file);
      const moduleDir = join(work, dirname(opts.file));
      const entryAbs = join(work, opts.entrypoint);
      const mod = moduleName(opts.file);

      let parsed: Parsed | null;
      if (opts.language === "python") {
        parsed = await runProc(
          "python3",
          ["-c", pyCaptureHarness(moduleDir, work, mod, entryAbs, argv)],
          work,
          timeoutMs,
          { PYTHONDONTWRITEBYTECODE: "1" },
        );
      } else if (opts.language === "javascript") {
        const h = join(work, "_ma_capture.cjs");
        const body = nodeCaptureBody(`require(${JSON.stringify(entryAbs)});`, argv);
        await writeFile(h, jsPrologue(moduleAbs) + body, "utf8");
        parsed = await runProc("node", [h], work, timeoutMs);
      } else {
        const h = join(work, "_ma_capture.mjs");
        const body = nodeCaptureBody(`await import(${JSON.stringify(pathToFileURL(entryAbs).href)});`, argv);
        await writeFile(h, tsPrologue(pathToFileURL(moduleAbs).href) + body, "utf8");
        parsed = await runProc("node", ["--experimental-strip-types", h], work, timeoutMs);
      }
      return parsed?.symbols ?? [];
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  };

  const first = await runOnce();
  if (!first.length) return [];
  const second = await runOnce();
  if (!second.length) return [];
  return intersect(first, second);
}

/**
 * Merge two case lists, deduping by `args` (the first list wins on conflict).
 * Used to fold captured-run cases into the synthetic battery's cases.
 */
export function mergeCases<C extends { args: string; val: string }>(primary: C[], extra: C[]): C[] {
  const seen = new Set(primary.map((c) => c.args));
  const out = [...primary];
  for (const c of extra) {
    if (!seen.has(c.args)) {
      seen.add(c.args);
      out.push(c);
    }
  }
  return out;
}
