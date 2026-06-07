import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { blankPythonFunction, characterize, LocalPytestRunner, parseTestCounts } from "@ma/verifier";
import { describe, expect, it } from "vitest";

const fixture = fileURLToPath(new URL("./fixtures/py-uncovered", import.meta.url));

describe("characterization oracle (universal verification)", () => {
  it("synthesizes a passing test for an untested module-level function", async () => {
    const c = await characterize({
      repoRoot: fixture,
      file: "mathx.py",
      symbol: "running_sum",
      language: "python",
    });
    expect(c).not.toBeNull();
    expect(c!.cases).toBeGreaterThanOrEqual(2);
    expect(c!.testContent).toContain("from mathx import running_sum");

    // The generated test passes against the original (oracle) implementation.
    const ok = await new LocalPytestRunner().run(fixture, {
      edits: [{ path: c!.testPath, content: c!.testContent }],
      targets: [c!.testPath],
    });
    expect(ok.passed).toBe(true);
  });

  it("makes a previously-unverifiable function verifiable (test fails when blanked)", async () => {
    const c = await characterize({
      repoRoot: fixture,
      file: "mathx.py",
      symbol: "clamp",
      language: "python",
    });
    expect(c).not.toBeNull();

    const src = readFileSync(`${fixture}/mathx.py`, "utf8");
    // clamp spans lines 6-11 in the fixture; locate by name to stay robust.
    const lines = src.split("\n");
    const start = lines.findIndex((l) => l.startsWith("def clamp(")) + 1;
    let end = start;
    for (let i = start; i < lines.length; i++) {
      if (lines[i]?.startsWith("def ") || lines[i]?.startsWith("class ")) break;
      if (lines[i]?.trim()) end = i + 1;
    }
    const blank = blankPythonFunction(src, start, end);

    const runner = new LocalPytestRunner();
    const broken = await runner.run(fixture, {
      edits: [
        { path: "mathx.py", content: blank.fileWithBlank },
        { path: c!.testPath, content: c!.testContent },
      ],
      targets: [c!.testPath],
    });
    expect(broken.passed).toBe(false); // blanking the oracle target breaks the synthesized test
  });

  it("characterizes a method on a zero-arg class", async () => {
    const c = await characterize({
      repoRoot: fixture,
      file: "mathx.py",
      symbol: "Stats.total",
      language: "python",
    });
    expect(c).not.toBeNull();
    expect(c!.testContent).toContain("Stats().total");
    const ok = await new LocalPytestRunner().run(fixture, {
      edits: [{ path: c!.testPath, content: c!.testContent }],
      targets: [c!.testPath],
    });
    expect(parseTestCounts(ok.raw).passed).toBeGreaterThanOrEqual(1);
  });
});
