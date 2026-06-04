/**
 * Dockerized pytest runner (docs/P0-CODE-MVP.md §5.2: strong isolation).
 *
 * Runs the materialized repo inside a locked-down container: no network by
 * default, capped memory/cpu/pids. Requires a Docker daemon and an image that
 * already has pytest installed (network is off, so no in-container pip).
 *
 * NOTE: not exercised in environments without a Docker daemon — makeRunner()
 * probes availability and falls back to the local runner.
 */
import { execFile, spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { promisify } from "node:util";
import {
  type RunOptions,
  type TestResult,
  type TestRunner,
  materializeRepo,
  summarize,
} from "./runner.js";

const execFileP = promisify(execFile);

export interface DockerOptions {
  image?: string; // must contain pytest; default python:3.11 (ships pip, has pytest? no — see README)
  network?: string; // default "none"
  memory?: string; // default "512m"
  cpus?: string; // default "1"
}

export async function dockerAvailable(): Promise<boolean> {
  try {
    await execFileP("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export class DockerPytestRunner implements TestRunner {
  constructor(private readonly opts: DockerOptions = {}) {}

  async run(repoRoot: string, opts: RunOptions = {}): Promise<TestResult> {
    const timeoutMs = opts.timeoutMs ?? 30_000;
    const image = this.opts.image ?? process.env.MA_SANDBOX_IMAGE ?? "python:3.11";
    const work = await materializeRepo(repoRoot, opts.edits ?? []);
    const args = [
      "run",
      "--rm",
      `--network=${this.opts.network ?? process.env.MA_SANDBOX_NETWORK ?? "none"}`,
      `--memory=${this.opts.memory ?? "512m"}`,
      `--cpus=${this.opts.cpus ?? "1"}`,
      "--pids-limit=256",
      "--cap-drop=ALL",
      "-v",
      `${work}:/work`,
      "-w",
      "/work",
      image,
      "python",
      "-m",
      "pytest",
      "-q",
      "--no-header",
      ...(opts.targets ?? []),
    ];
    const started = Date.now();
    try {
      return await new Promise<TestResult>((resolve) => {
        const child = spawn("docker", args);
        let out = "";
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          child.kill("SIGKILL");
        }, timeoutMs + 10_000); // allow for container startup
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
            summary: `docker error: ${err.message}`,
            durationMs: Date.now() - started,
            timedOut,
            raw: String(err),
          });
        });
      });
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
}
