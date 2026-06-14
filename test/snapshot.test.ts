import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { snapshotFile, verifyAgainstSnapshot } from "@ma/verifier";
import { afterAll, describe, expect, it } from "vitest";
import { hasPython3 } from "./helpers/env.js";

const pyFixture = fileURLToPath(new URL("./fixtures/py-uncovered", import.meta.url));
const jsFixture = fileURLToPath(new URL("./fixtures/js-uncovered", import.meta.url));

const tmps: string[] = [];
function tmpRepo(file: string, content: string): { repoRoot: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), "ma-fw-"));
  tmps.push(dir);
  writeFileSync(join(dir, file), content);
  return { repoRoot: dir, file };
}
afterAll(() => {
  for (const d of tmps) rmSync(d, { recursive: true, force: true });
});

describe.skipIf(!hasPython3)("behavioral firewall — snapshot + verify (Python)", () => {
  it("snapshots every function in a file", async () => {
    const snap = await snapshotFile({ repoRoot: pyFixture, file: "mathx.py", language: "python" });
    expect(snap).not.toBeNull();
    const names = snap!.symbols.map((s) => s.symbol).sort();
    expect(names).toContain("clamp");
    expect(names).toContain("running_sum");
    expect(names).toContain("Stats.total");
  });

  it("passes a behavior-preserving refactor", async () => {
    const snap = (await snapshotFile({ repoRoot: pyFixture, file: "mathx.py", language: "python" }))!;
    // Rewrite clamp with different code but identical behavior.
    const original = readFileSync(`${pyFixture}/mathx.py`, "utf8");
    const refactored = original.replace(
      /def clamp\(x, lo, hi\):\n {4}if x < lo:\n {8}return lo\n {4}if x > hi:\n {8}return hi\n {4}return x/,
      "def clamp(x, lo, hi):\n    return max(lo, min(x, hi))",
    );
    expect(refactored).not.toBe(original); // sanity: the edit applied
    const diff = await verifyAgainstSnapshot({
      repoRoot: pyFixture,
      file: "mathx.py",
      language: "python",
      snapshot: snap,
      candidate: refactored,
    });
    expect(diff.ok).toBe(true);
    expect(diff.changed).toHaveLength(0);
    expect(diff.preserved).toBe(diff.totalCases);
  });

  it("catches a behavior change with an exact input + old→new diff", async () => {
    const snap = (await snapshotFile({ repoRoot: pyFixture, file: "mathx.py", language: "python" }))!;
    const original = readFileSync(`${pyFixture}/mathx.py`, "utf8");
    // Subtle bug: the upper clamp returns hi+1 instead of hi.
    const buggy = original.replace("if x > hi:\n        return hi", "if x > hi:\n        return hi + 1");
    const diff = await verifyAgainstSnapshot({
      repoRoot: pyFixture,
      file: "mathx.py",
      language: "python",
      snapshot: snap,
      candidate: buggy,
    });
    expect(diff.ok).toBe(false);
    expect(diff.changed.length).toBeGreaterThan(0);
    const hit = diff.changed.find((c) => c.symbol === "clamp");
    expect(hit).toBeTruthy();
    expect(hit!.expected).not.toBe(hit!.actual); // reports old vs new value
  });

  it("flags a removed function as missing", async () => {
    const snap = (await snapshotFile({ repoRoot: pyFixture, file: "mathx.py", language: "python" }))!;
    const original = readFileSync(`${pyFixture}/mathx.py`, "utf8");
    const removed = original.replace(/def running_sum\(nums\):[\s\S]*?return out\n/, "");
    const diff = await verifyAgainstSnapshot({
      repoRoot: pyFixture,
      file: "mathx.py",
      language: "python",
      snapshot: snap,
      candidate: removed,
    });
    expect(diff.missing).toContain("running_sum");
    expect(diff.ok).toBe(false);
  });
});

describe("behavioral firewall — snapshot + verify (JavaScript)", () => {
  it("snapshots functions and methods, passes a refactor, catches a change", async () => {
    const snap = await snapshotFile({ repoRoot: jsFixture, file: "mathx.js", language: "javascript" });
    expect(snap).not.toBeNull();
    const names = snap!.symbols.map((s) => s.symbol);
    expect(names).toContain("clamp");
    expect(names).toContain("Stats.total");

    const original = readFileSync(`${jsFixture}/mathx.js`, "utf8");
    const refactored = original.replace(
      /function clamp\(x, lo, hi\) \{\n {2}if \(x < lo\) return lo;\n {2}if \(x > hi\) return hi;\n {2}return x;\n\}/,
      "function clamp(x, lo, hi) {\n  return Math.max(lo, Math.min(x, hi));\n}",
    );
    expect(refactored).not.toBe(original);
    const ok = await verifyAgainstSnapshot({
      repoRoot: jsFixture,
      file: "mathx.js",
      language: "javascript",
      snapshot: snap!,
      candidate: refactored,
    });
    expect(ok.ok).toBe(true);

    const buggy = original.replace("if (x > hi) return hi;", "if (x > hi) return hi + 1;");
    const bad = await verifyAgainstSnapshot({
      repoRoot: jsFixture,
      file: "mathx.js",
      language: "javascript",
      snapshot: snap!,
      candidate: buggy,
    });
    expect(bad.ok).toBe(false);
    expect(bad.changed.some((c) => c.symbol === "clamp")).toBe(true);
  });
});

describe("behavioral firewall — float tolerance", () => {
  it("tolerates float noise from an equivalent rewrite, but catches real changes (JS)", async () => {
    // scale(3) = 3 * 0.1 = 0.30000000000000004
    const { repoRoot, file } = tmpRepo(
      "floaty.js",
      "function scale(x) { return x * 0.1; }\nmodule.exports = { scale };\n",
    );
    const snap = await snapshotFile({ repoRoot, file, language: "javascript" });
    expect(snap).not.toBeNull();

    // x / 10 gives 0.3 (exactly) — a different bit pattern, same value → preserved.
    const equivalent = "function scale(x) { return x / 10; }\nmodule.exports = { scale };\n";
    const ok = await verifyAgainstSnapshot({
      repoRoot,
      file,
      language: "javascript",
      snapshot: snap!,
      candidate: equivalent,
    });
    expect(ok.ok).toBe(true);

    // x * 0.2 is a real behavior change → caught.
    const changed = "function scale(x) { return x * 0.2; }\nmodule.exports = { scale };\n";
    const bad = await verifyAgainstSnapshot({
      repoRoot,
      file,
      language: "javascript",
      snapshot: snap!,
      candidate: changed,
    });
    expect(bad.ok).toBe(false);
    expect(bad.changed.some((c) => c.symbol === "scale")).toBe(true);
  });

  it("still catches a +1 integer change (tolerance doesn't mask it) (JS)", async () => {
    const { repoRoot, file } = tmpRepo(
      "inc.js",
      "function f(x) { return x + 1; }\nmodule.exports = { f };\n",
    );
    const snap = await snapshotFile({ repoRoot, file, language: "javascript" });
    const bad = await verifyAgainstSnapshot({
      repoRoot,
      file,
      language: "javascript",
      snapshot: snap!,
      candidate: "function f(x) { return x + 2; }\nmodule.exports = { f };\n",
    });
    expect(bad.ok).toBe(false);
  });

  it.skipIf(!hasPython3)("tolerates float noise but catches real changes (Python)", async () => {
    const { repoRoot, file } = tmpRepo("floaty.py", "def scale(x):\n    return x * 0.1\n");
    const snap = await snapshotFile({ repoRoot, file, language: "python" });
    expect(snap).not.toBeNull();

    const ok = await verifyAgainstSnapshot({
      repoRoot,
      file,
      language: "python",
      snapshot: snap!,
      candidate: "def scale(x):\n    return x / 10\n",
    });
    expect(ok.ok).toBe(true);

    const bad = await verifyAgainstSnapshot({
      repoRoot,
      file,
      language: "python",
      snapshot: snap!,
      candidate: "def scale(x):\n    return x * 0.2\n",
    });
    expect(bad.ok).toBe(false);
  });
});
