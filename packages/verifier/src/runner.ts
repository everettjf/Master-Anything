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

function lastMeaningfulLine(output: string): string {
  const lines = output
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return lines[lines.length - 1] ?? "";
}

export class LocalPytestRunner implements TestRunner {
  async run(repoRoot: string, opts: RunOptions = {}): Promise<TestResult> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const work = await mkdtemp(join(tmpdir(), "ma-verify-"));
    try {
      await cp(repoRoot, work, {
        recursive: true,
        filter: (src) => !src.split("/").some((seg) => SKIP_DIRS.has(seg)),
      });
      for (const edit of opts.edits ?? []) {
        await writeFile(join(work, edit.path), edit.content, "utf8");
      }
      return await this.spawnPytest(work, opts, timeoutMs);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }

  private spawnPytest(cwd: string, opts: RunOptions, timeoutMs: number): Promise<TestResult> {
    const args = ["-m", "pytest", "-q", "--no-header", ...(opts.targets ?? [])];
    const started = Date.now();
    return new Promise<TestResult>((resolve) => {
      const child = spawn("python3", args, { cwd, env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" } });
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
          summary: timedOut ? "timed out" : lastMeaningfulLine(out),
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
