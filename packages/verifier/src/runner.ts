/**
 * Pluggable test runner (docs/P0-CODE-MVP.md §5.2).
 *
 * P0 ships a LocalPytestRunner (subprocess). The interface lets a Docker /
 * sandboxed runner slot in later without touching callers. NOTE: the local
 * runner executes code on the host with no isolation beyond a timeout — fine
 * for a self-hosted dev MVP where you run your own repos, not for untrusted
 * multi-tenant use.
 */
import { spawn } from "node:child_process";
import { cp, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FileEdit {
  /** repo-relative path */
  path: string;
  /** full replacement contents */
  content: string;
}

export interface TestResult {
  passed: boolean;
  exitCode: number | null;
  summary: string; // last meaningful line of output
  durationMs: number;
  timedOut: boolean;
  raw: string;
}

export interface RunOptions {
  edits?: FileEdit[];
  targets?: string[]; // pytest node ids / paths; default: whole suite
  timeoutMs?: number;
}

export interface TestRunner {
  run(repoRoot: string, opts?: RunOptions): Promise<TestResult>;
}

const SKIP_DIRS = new Set([".git", "node_modules", "__pycache__", ".venv", "venv", ".pytest_cache"]);

export function lastMeaningfulLine(output: string): string {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

/** Pick a human summary: pytest's "N passed" line, node --test's pass/fail counts, else last line. */
export function summarize(output: string): string {
  const lines = output.split("\n").map((l) => l.trim());
  // pytest: "4 passed in 0.01s" / "2 failed, 2 passed in 0.03s"
  const pytest = lines.find((l) => /\d+ (passed|failed|error)/.test(l));
  if (pytest) return pytest;
  // node --test: "# pass 4" + "# fail 0"
  const pass = lines.find((l) => l.startsWith("# pass"));
  const fail = lines.find((l) => l.startsWith("# fail"));
  if (pass || fail) return [pass, fail].filter(Boolean).join(", ");
  return lastMeaningfulLine(output);
}

export interface TestCounts {
  passed: number;
  failed: number;
  total: number;
}

/** Parse pass/fail/total counts from pytest or node --test output. */
export function parseTestCounts(output: string): TestCounts {
  const num = (re: RegExp) => {
    const m = output.match(re);
    return m ? Number(m[1]) : 0;
  };
  // node --test
  if (/^#\s*tests\s+\d+/m.test(output)) {
    const passed = num(/^#\s*pass\s+(\d+)/m);
    const failed = num(/^#\s*fail\s+(\d+)/m);
    const total = num(/^#\s*tests\s+(\d+)/m) || passed + failed;
    return { passed, failed, total };
  }
  // pytest
  const passed = num(/(\d+) passed/);
  const failed = num(/(\d+) failed/) + num(/(\d+) error/);
  return { passed, failed, total: passed + failed };
}

/** Copy a repo to an isolated temp dir and apply edits. Caller must clean up. */
export async function materializeRepo(repoRoot: string, edits: FileEdit[] = []): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), "ma-verify-"));
  await cp(repoRoot, work, {
    recursive: true,
    filter: (src) => !src.split("/").some((seg) => SKIP_DIRS.has(seg)),
  });
  for (const edit of edits) {
    await writeFile(join(work, edit.path), edit.content, "utf8");
  }
  return work;
}

/** Runs a fixed test command in a materialized copy of the repo. */
export class LocalProcessRunner implements TestRunner {
  constructor(
    private readonly cmd: string,
    private readonly baseArgs: string[],
    private readonly env: NodeJS.ProcessEnv = {},
  ) {}

  async run(repoRoot: string, opts: RunOptions = {}): Promise<TestResult> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const work = await materializeRepo(repoRoot, opts.edits ?? []);
    try {
      return await this.spawn(work, opts, timeoutMs);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  private spawn(cwd: string, opts: RunOptions, timeoutMs: number): Promise<TestResult> {
    const args = [...this.baseArgs, ...(opts.targets ?? [])];
    const started = Date.now();
    return new Promise<TestResult>((resolve) => {
      const child = spawn(this.cmd, args, { cwd, env: { ...process.env, ...this.env } });
      let out = "";
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        child.kill("SIGKILL");
      }, timeoutMs);

      child.stdout.on("data", (d) => (out += d));
      child.stderr.on("data", (d) => (out += d));
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({
          passed: !timedOut && code === 0,
          exitCode: code,
          summary: timedOut ? "timed out" : summarize(out),
          durationMs: Date.now() - started,
          timedOut,
          raw: out.slice(-4000),
        });
      });
      child.on("error", (err) => {
        clearTimeout(timer);
        resolve({
          passed: false,
          exitCode: null,
          summary: `runner error: ${err.message}`,
          durationMs: Date.now() - started,
          timedOut,
          raw: String(err),
        });
      });
    });
  }
}

/** Python: `python -m pytest`. */
export class LocalPytestRunner extends LocalProcessRunner {
  constructor() {
    super("python3", ["-m", "pytest", "-q", "--no-header"], { PYTHONDONTWRITEBYTECODE: "1" });
  }
}

/** JavaScript: Node's built-in test runner (zero-dependency). */
export class LocalNodeTestRunner extends LocalProcessRunner {
  constructor() {
    super("node", ["--test"]);
  }
}

/** TypeScript: Node's test runner with built-in type stripping (no extra deps). */
export class LocalTsTestRunner extends LocalProcessRunner {
  constructor() {
    super("node", ["--test", "--experimental-strip-types"]);
  }
}
