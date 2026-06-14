/**
 * Behavioral Firewall — snapshot a file's behavior, then verify a candidate edit
 * preserved it.
 *
 * The characterization oracle (see characterize.ts) captures the behavior of one
 * function for the Apply loop. Generalized, it becomes a *regression safety net
 * for AI edits to untested code*: snapshot every characterizable function in a
 * file (its golden input→output behavior), let an agent (or human) rewrite the
 * file, then replay the snapshot to prove behavior is preserved — and, when it
 * isn't, report the exact `(function, input)` that changed and old→new value.
 *
 * Languages: Python, JavaScript (CommonJS), TypeScript (ESM + type-stripping).
 * Pure, deterministic, offline. Functions are discovered by the harness itself
 * (language-native reflection), so no external parser is needed. Only
 * deterministic, literal-returning behavior is pinned (a value is kept only if
 * it round-trips to a literal and is stable across two runs), so the firewall
 * never raises a false alarm on nondeterminism.
 */
import { spawn } from "node:child_process";
import { rm, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SupportedLanguage } from "./breakfix.js";
import { materializeRepo } from "./runner.js";

export interface SymbolSnapshot {
  /** "fn" or "Class.method". */
  symbol: string;
  cases: { args: string; val: string }[];
}

export interface BehaviorSnapshot {
  file: string;
  language: SupportedLanguage;
  capturedAt: string;
  symbols: SymbolSnapshot[];
}

export interface CaseResult {
  symbol: string;
  args: string;
  expected: string;
  actual: string | null;
  status: "preserved" | "changed" | "errored";
}

export interface BehaviorDiff {
  /** No behavior changed, errored, or went missing. */
  ok: boolean;
  totalCases: number;
  preserved: number;
  changed: CaseResult[];
  errored: CaseResult[];
  /** Snapshot symbols absent or no longer callable in the candidate. */
  missing: string[];
}

export interface SnapshotOptions {
  repoRoot: string;
  /** repo-relative path to the file to snapshot. */
  file: string;
  language: SupportedLanguage;
  timeoutMs?: number;
}

const SENTINEL = "__MA_FIREWALL__";
const moduleName = (file: string) => basename(file).replace(/\.[^.]+$/, "");

interface Parsed {
  symbols?: SymbolSnapshot[];
  results?: CaseResult[];
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

// --- harness fragments shared across snapshot/verify -------------------------

const PY_BATTERY = `POOL = [0, 1, 2, -3, 10, 2.5, "", "ab", [], [1, 2, 3], [2, 4, 6]]
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
    nums = [0, 1, 2, -3, 10, 5, 12, -1, 7]
    out = [nums[i:i + n] for i in range(len(nums) - n + 1)]
    out += [[a] * n for a in [0, 1, -3, 10]]
    return out`;

const JS_BATTERY = `const POOL = [0, 1, 2, -3, 10, 2.5, "", "ab", [], [1, 2, 3], [2, 4, 6]];
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
  const nums = [0, 1, 2, -3, 10, 5, 12, -1, 7];
  const out = [];
  for (let i = 0; i + n <= nums.length; i++) out.push(nums.slice(i, i + n));
  for (const a of [0, 1, -3, 10]) out.push(Array(n).fill(a));
  return out;
}`;

// --- Python harnesses --------------------------------------------------------

function pySnapshotHarness(moduleDir: string, mod: string): string {
  return `import sys, json, importlib, inspect
sys.path.insert(0, ${JSON.stringify(moduleDir)})
SENT = ${JSON.stringify(SENTINEL)}
${PY_BATTERY}
def cases_for(factory, n):
    out = []
    for args in candidates(n):
        try:
            val = factory()(*args)
        except Exception:
            continue
        try:
            if eval(repr(val)) != val:
                continue
        except Exception:
            continue
        out.append({"args": repr(list(args)), "val": repr(val)})
    return out
def arity(callable_obj):
    params = [p for p in inspect.signature(callable_obj).parameters.values()
              if p.kind in (p.POSITIONAL_ONLY, p.POSITIONAL_OR_KEYWORD) and p.default is p.empty]
    return len(params)
try:
    mod = importlib.import_module(${JSON.stringify(mod)})
except Exception as e:
    print(SENT + json.dumps({"error": type(e).__name__ + ": " + str(e)})); raise SystemExit
symbols = []
for name, obj in list(vars(mod).items()):
    if name.startswith("_"):
        continue
    if inspect.isfunction(obj) and getattr(obj, "__module__", None) == mod.__name__:
        try:
            n = arity(obj)
        except (ValueError, TypeError):
            continue
        c = cases_for((lambda o=obj: o), n)
        if c:
            symbols.append({"symbol": name, "cases": c})
    elif inspect.isclass(obj) and getattr(obj, "__module__", None) == mod.__name__:
        try:
            obj()
        except Exception:
            continue
        for mname, m in inspect.getmembers(obj, inspect.isfunction):
            if mname.startswith("_"):
                continue
            try:
                n = arity(getattr(obj(), mname))
            except Exception:
                continue
            c = cases_for((lambda cls=obj, mn=mname: getattr(cls(), mn)), n)
            if c:
                symbols.append({"symbol": "%s.%s" % (name, mname), "cases": c})
print(SENT + json.dumps({"symbols": symbols}))
`;
}

function pyVerifyHarness(moduleDir: string, mod: string, data: SymbolSnapshot[]): string {
  return `import sys, json, importlib
sys.path.insert(0, ${JSON.stringify(moduleDir)})
SENT = ${JSON.stringify(SENTINEL)}
data = json.loads(${JSON.stringify(JSON.stringify(data))})
try:
    mod = importlib.import_module(${JSON.stringify(mod)})
except Exception as e:
    print(SENT + json.dumps({"error": str(e)})); raise SystemExit
def resolve(symbol):
    parts = symbol.split(".")
    if len(parts) == 2:
        cls = getattr(mod, parts[0]); mn = parts[1]
        getattr(cls(), mn)  # probe
        return lambda: getattr(cls(), mn)
    fn = getattr(mod, parts[0])
    if not callable(fn):
        raise TypeError("not callable")
    return lambda: fn
def num_eq(raw, expected):
    # Tolerate float noise from a rewrite (reordered ops); int changes (>=1) and
    # real float changes still differ well above tolerance. bool stays exact.
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return repr(raw) == expected
    try:
        e = float(expected)
    except (ValueError, TypeError):
        return repr(raw) == expected
    return abs(raw - e) <= 1e-9 * max(1.0, abs(raw), abs(e))
results = []
for s in data:
    try:
        factory = resolve(s["symbol"])
    except Exception:
        results.append({"symbol": s["symbol"], "args": "", "expected": "", "actual": None, "status": "missing"})
        continue
    for c in s["cases"]:
        try:
            raw = factory()(*eval(c["args"]))
            actual = repr(raw)
            status = "preserved" if num_eq(raw, c["val"]) else "changed"
            results.append({"symbol": s["symbol"], "args": c["args"], "expected": c["val"], "actual": actual, "status": status})
        except Exception:
            results.append({"symbol": s["symbol"], "args": c["args"], "expected": c["val"], "actual": None, "status": "errored"})
print(SENT + json.dumps({"results": results}))
`;
}

// --- Node (JS/TS) harnesses --------------------------------------------------

function nodeSnapshotBody(): string {
  return `const SENT = ${JSON.stringify(SENTINEL)};
${JS_BATTERY}
function literal(v) {
  if (v === undefined || typeof v === "function") return undefined;
  let j;
  try { j = JSON.stringify(v); } catch { return undefined; }
  if (j === undefined) return undefined;
  try { if (!isDeepStrictEqual(JSON.parse(j), v)) return undefined; } catch { return undefined; }
  return j;
}
function casesFor(factory, n) {
  const out = [];
  for (const args of candidates(n)) {
    let v;
    try { v = factory()(...args); } catch { continue; }
    const j = literal(v);
    if (j === undefined) continue;
    out.push({ args: JSON.stringify(args), val: j });
  }
  return out;
}
const isClass = (f) => /^class[\\s{]/.test(Function.prototype.toString.call(f));
const symbols = [];
for (const [name, obj] of Object.entries(mod)) {
  if (typeof obj !== "function") continue;
  if (isClass(obj)) {
    try { new obj(); } catch { continue; }
    const proto = obj.prototype;
    for (const m of Object.getOwnPropertyNames(proto)) {
      if (m === "constructor") continue;
      const fn = proto[m];
      if (typeof fn !== "function") continue;
      const c = casesFor(() => { const i = new obj(); return i[m].bind(i); }, fn.length);
      if (c.length) symbols.push({ symbol: name + "." + m, cases: c });
    }
  } else {
    const c = casesFor(() => obj, obj.length);
    if (c.length) symbols.push({ symbol: name, cases: c });
  }
}
console.log(SENT + JSON.stringify({ symbols }));
`;
}

function nodeVerifyBody(data: SymbolSnapshot[]): string {
  return `const SENT = ${JSON.stringify(SENTINEL)};
const data = ${JSON.stringify(data)};
function numEq(raw, expected) {
  // Tolerate float noise from a rewrite; integer / real changes still differ.
  if (typeof raw === "number" && Number.isFinite(raw) && expected.trim() !== "") {
    const e = Number(expected);
    if (Number.isFinite(e)) return Math.abs(raw - e) <= 1e-9 * Math.max(1, Math.abs(raw), Math.abs(e));
  }
  return JSON.stringify(raw) === expected;
}
function resolve(symbol) {
  const p = symbol.split(".");
  if (p.length === 2) {
    const cls = mod[p[0]];
    if (typeof cls !== "function") throw new Error("missing");
    new cls()[p[1]];
    return () => { const i = new cls(); return i[p[1]].bind(i); };
  }
  const fn = mod[p[0]];
  if (typeof fn !== "function") throw new Error("missing");
  return () => fn;
}
const results = [];
for (const s of data) {
  let factory;
  try { factory = resolve(s.symbol); }
  catch { results.push({ symbol: s.symbol, args: "", expected: "", actual: null, status: "missing" }); continue; }
  for (const c of s.cases) {
    try {
      const raw = factory()(...JSON.parse(c.args));
      const actual = JSON.stringify(raw);
      const status = numEq(raw, c.val) ? "preserved" : "changed";
      results.push({ symbol: s.symbol, args: c.args, expected: c.val, actual: actual ?? "undefined", status });
    } catch {
      results.push({ symbol: s.symbol, args: c.args, expected: c.val, actual: null, status: "errored" });
    }
  }
}
console.log(SENT + JSON.stringify({ results }));
`;
}

const jsPrologue = (abs: string) =>
  `const { isDeepStrictEqual } = require("node:util");\nconst mod = require(${JSON.stringify(abs)});\n`;
const tsPrologue = (url: string) =>
  `import { isDeepStrictEqual } from "node:util";\nconst mod = await import(${JSON.stringify(url)});\n`;

// --- public API --------------------------------------------------------------

/** Capture the deterministic, literal-returning behavior of every function in a file. */
export async function snapshotFile(opts: SnapshotOptions): Promise<BehaviorSnapshot | null> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const work = await materializeRepo(opts.repoRoot);
  try {
    const moduleAbs = join(work, opts.file);
    const moduleDir = join(work, dirname(opts.file));
    const mod = moduleName(opts.file);

    const run = (): Promise<Parsed | null> => {
      if (opts.language === "python") {
        return runProc("python3", ["-c", pySnapshotHarness(moduleDir, mod)], work, timeoutMs, {
          PYTHONDONTWRITEBYTECODE: "1",
        });
      }
      if (opts.language === "javascript") {
        const h = join(work, "_ma_fw_snap.cjs");
        return writeFile(h, jsPrologue(moduleAbs) + nodeSnapshotBody(), "utf8").then(() =>
          runProc("node", [h], work, timeoutMs),
        );
      }
      const h = join(work, "_ma_fw_snap.mjs");
      return writeFile(h, tsPrologue(pathToFileURL(moduleAbs).href) + nodeSnapshotBody(), "utf8").then(() =>
        runProc("node", ["--experimental-strip-types", h], work, timeoutMs),
      );
    };

    const first = await run();
    if (!first?.symbols?.length) return null;
    const second = await run();
    if (!second?.symbols?.length) return null;

    // Keep only cases stable across both runs (drop nondeterminism per symbol).
    const stable = new Map<string, Map<string, string>>();
    for (const s of second.symbols) stable.set(s.symbol, new Map(s.cases.map((c) => [c.args, c.val])));
    const symbols: SymbolSnapshot[] = [];
    for (const s of first.symbols) {
      const ref = stable.get(s.symbol);
      if (!ref) continue;
      const cases = s.cases.filter((c) => ref.get(c.args) === c.val);
      if (cases.length) symbols.push({ symbol: s.symbol, cases });
    }
    if (!symbols.length) return null;
    return { file: opts.file, language: opts.language, capturedAt: new Date().toISOString(), symbols };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

export interface VerifyOptions extends SnapshotOptions {
  snapshot: BehaviorSnapshot;
  /** Candidate file content to test against the snapshot (the "after" version). */
  candidate: string;
}

/** Replay a snapshot against a candidate edit and report the behavioral diff. */
export async function verifyAgainstSnapshot(opts: VerifyOptions): Promise<BehaviorDiff> {
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const work = await materializeRepo(opts.repoRoot, [{ path: opts.file, content: opts.candidate }]);
  try {
    const moduleAbs = join(work, opts.file);
    const moduleDir = join(work, dirname(opts.file));
    const mod = moduleName(opts.file);
    const data = opts.snapshot.symbols;

    let parsed: Parsed | null;
    if (opts.language === "python") {
      parsed = await runProc("python3", ["-c", pyVerifyHarness(moduleDir, mod, data)], work, timeoutMs, {
        PYTHONDONTWRITEBYTECODE: "1",
      });
    } else if (opts.language === "javascript") {
      const h = join(work, "_ma_fw_verify.cjs");
      await writeFile(h, jsPrologue(moduleAbs) + nodeVerifyBody(data), "utf8");
      parsed = await runProc("node", [h], work, timeoutMs);
    } else {
      const h = join(work, "_ma_fw_verify.mjs");
      await writeFile(h, tsPrologue(pathToFileURL(moduleAbs).href) + nodeVerifyBody(data), "utf8");
      parsed = await runProc("node", ["--experimental-strip-types", h], work, timeoutMs);
    }

    return summarize(parsed?.results ?? [], data);
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function summarize(results: CaseResult[], data: SymbolSnapshot[]): BehaviorDiff {
  const missing = new Set<string>();
  const changed: CaseResult[] = [];
  const errored: CaseResult[] = [];
  let preserved = 0;
  let totalCases = 0;
  for (const r of results) {
    if ((r.status as string) === "missing") {
      missing.add(r.symbol);
      continue;
    }
    totalCases++;
    if (r.status === "preserved") preserved++;
    else if (r.status === "changed") changed.push(r);
    else errored.push(r);
  }
  // A candidate that fails to load yields no results — treat every symbol as missing.
  if (results.length === 0 && data.length > 0) for (const s of data) missing.add(s.symbol);
  return {
    ok: changed.length === 0 && errored.length === 0 && missing.size === 0,
    totalCases,
    preserved,
    changed,
    errored,
    missing: [...missing],
  };
}
