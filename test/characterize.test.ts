import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  blankJsFunction,
  blankPythonFunction,
  characterize,
  LocalNodeTestRunner,
  LocalPytestRunner,
  LocalTsTestRunner,
  parseTestCounts,
} from "@ma/verifier";
import { describe, expect, it } from "vitest";
import { hasPytest } from "./helpers/env.js";

const fixture = fileURLToPath(new URL("./fixtures/py-uncovered", import.meta.url));
const jsFixture = fileURLToPath(new URL("./fixtures/js-uncovered", import.meta.url));
const tsFixture = fileURLToPath(new URL("./fixtures/ts-uncovered", import.meta.url));

/** Find the 1-based [start,end] line span of a brace function/method named `name`. */
function jsSpan(src: string, name: string): [number, number] {
  const lines = src.split("\n");
  const start = lines.findIndex((l) => new RegExp(`(function )?${name}\\s*\\(`).test(l)) + 1;
  let depth = 0;
  let end = start;
  for (let i = start - 1; i < lines.length; i++) {
    for (const ch of lines[i]!) {
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
    }
    if (depth === 0 && lines[i]!.includes("}")) {
      end = i + 1;
      break;
    }
  }
  return [start, end];
}

describe("characterization oracle (universal verification)", () => {
  it.skipIf(!hasPytest)("synthesizes a passing test for an untested module-level function", async () => {
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

  it.skipIf(!hasPytest)(
    "makes a previously-unverifiable function verifiable (test fails when blanked)",
    async () => {
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
    },
  );

  it.skipIf(!hasPytest)("characterizes a method on a zero-arg class", async () => {
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

  it("characterizes an untested JavaScript function and breaks when blanked", async () => {
    const c = await characterize({
      repoRoot: jsFixture,
      file: "mathx.js",
      symbol: "runningSum",
      language: "javascript",
    });
    expect(c).not.toBeNull();
    expect(c!.testContent).toContain('require("./mathx")');

    const runner = new LocalNodeTestRunner();
    const ok = await runner.run(jsFixture, {
      edits: [{ path: c!.testPath, content: c!.testContent }],
      targets: [c!.testPath],
    });
    expect(ok.passed).toBe(true); // passes against the original oracle

    const src = readFileSync(`${jsFixture}/mathx.js`, "utf8");
    const [start, end] = jsSpan(src, "runningSum");
    const blank = blankJsFunction(src, start, end);
    const broken = await runner.run(jsFixture, {
      edits: [
        { path: "mathx.js", content: blank.fileWithBlank },
        { path: c!.testPath, content: c!.testContent },
      ],
      targets: [c!.testPath],
    });
    expect(broken.passed).toBe(false);
  });

  it("characterizes a JavaScript method on a zero-arg class", async () => {
    const c = await characterize({
      repoRoot: jsFixture,
      file: "mathx.js",
      symbol: "Stats.total",
      language: "javascript",
    });
    expect(c).not.toBeNull();
    expect(c!.testContent).toContain("new Stats().total");
    const ok = await new LocalNodeTestRunner().run(jsFixture, {
      edits: [{ path: c!.testPath, content: c!.testContent }],
      targets: [c!.testPath],
    });
    expect(parseTestCounts(ok.raw).passed).toBeGreaterThanOrEqual(1);
  });

  it("characterizes an untested TypeScript function (type-stripped run)", async () => {
    const c = await characterize({
      repoRoot: tsFixture,
      file: "mathx.ts",
      symbol: "clamp",
      language: "typescript",
    });
    expect(c).not.toBeNull();
    expect(c!.testContent).toContain('from "./mathx.ts"');
    const ok = await new LocalTsTestRunner().run(tsFixture, {
      edits: [{ path: c!.testPath, content: c!.testContent }],
      targets: [c!.testPath],
    });
    expect(ok.passed).toBe(true);
  });
});
