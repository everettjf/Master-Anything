/**
 * The AI-certification loop end-to-end on a real (green-suite) repo fixture.
 *
 * The crown-jewel claim — "blank a function, verify a reimplementation against the
 * project's REAL test suite" — exercised through the public orchestrator with two
 * control agents:
 *   - oracle (submits the reference impl) must pass EVERY gradable unit
 *   - lazy   (leaves the blank)           must pass NONE
 * Perfect discrimination is the proof the grade is objective, not vibes.
 *
 * Env (MA_DB / MA_DATA_DIR) is set before the store is imported, so the SQLite
 * file lands in a throwaway dir; the server modules are imported dynamically for
 * the same reason.
 */
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hasPytest } from "./helpers/env.js";

const dataDir = mkdtempSync(join(tmpdir(), "ma-certify-data-"));
process.env.MA_DATA_DIR = dataDir;
process.env.MA_DB = join(dataDir, "test.db");

const tmps = [dataDir];
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

describe("AI-certification loop (objective Apply verification)", () => {
  // Loosely typed: the server modules are imported dynamically (after env setup).
  let certify: any;
  let repo: any;

  beforeAll(async () => {
    // Copy the fixture so addRepo's on-disk artifact doesn't touch examples/.
    const repoDir = mkdtempSync(join(tmpdir(), "ma-certify-repo-"));
    tmps.push(repoDir);
    cpSync(fileURLToPath(new URL("../examples/py-calc", import.meta.url)), repoDir, { recursive: true });
    const store = await import("../packages/server/src/store.js");
    certify = await import("../packages/server/src/certify.js");
    repo = await store.addRepo(repoDir, { fresh: true });
  });

  it.skipIf(!hasPytest)("oracle passes every gradable unit; lazy passes none", async () => {
    const oracle = await certify.certifyAgent(repo, certify.oracleSolver, { agent: "oracle" });
    const lazy = await certify.certifyAgent(repo, certify.lazySolver, { agent: "lazy" });

    expect(oracle.gradable).toBeGreaterThan(0); // the suite actually covers something
    expect(oracle.passed).toBe(oracle.gradable); // correct code is never failed
    expect(oracle.passRate).toBe(1);
    expect(lazy.passed).toBe(0); // a blank is never falsely passed
  });

  it.skipIf(!hasPytest)("excludes the repo's own test functions from learning units", () => {
    // py-calc ships test_calc.py; its test_* functions must not be Apply units
    // (reimplementing a test is circular — the test is its own oracle).
    const titles = repo.path.units.map((u: { title: string }) => u.title);
    expect(titles.some((t: string) => t.startsWith("test_"))).toBe(false);
    expect(titles).toContain("Calculator"); // real code still present
  });
});
