import { fileURLToPath } from "node:url";
import { buildGraph } from "@ma/core";
import {
  blankJsFunction,
  blankPythonFunction,
  LocalNodeTestRunner,
  LocalPytestRunner,
  parseTestCounts,
  replaceLineRange,
  verifierForExtension,
} from "@ma/verifier";
import { describe, expect, it } from "vitest";
import { hasPytest } from "./helpers/env.js";

const ex = (name: string) => fileURLToPath(new URL(`../examples/${name}`, import.meta.url));

describe("test-count parsing", () => {
  it("parses pytest output", () => {
    expect(parseTestCounts("4 passed in 0.01s")).toEqual({ passed: 4, failed: 0, total: 4 });
    expect(parseTestCounts("2 failed, 2 passed in 0.03s")).toEqual({ passed: 2, failed: 2, total: 4 });
  });
  it("parses node --test output", () => {
    expect(parseTestCounts("# tests 4\n# pass 4\n# fail 0")).toEqual({ passed: 4, failed: 0, total: 4 });
  });
});

describe("break-and-fix transforms", () => {
  it("blanks a Python function body", () => {
    const src = "class C:\n    def add(self, a, b):\n        return a + b\n";
    const r = blankPythonFunction(src, 2, 3);
    expect(r.brokenFunction).toContain("raise NotImplementedError");
    expect(r.fileWithBlank).not.toContain("return a + b");
  });
  it("blanks a JavaScript function body", () => {
    const src = "function add(a, b) {\n  return a + b;\n}\n";
    const r = blankJsFunction(src, 1, 3);
    expect(r.brokenFunction).toContain('throw new Error("implement me")');
  });
  it("replaces a line range", () => {
    expect(replaceLineRange("a\nb\nc", 2, 2, "X")).toBe("a\nX\nc");
  });
  it("maps extensions to languages", () => {
    expect(verifierForExtension(".py")?.language).toBe("python");
    expect(verifierForExtension(".ts")?.language).toBe("typescript");
    expect(verifierForExtension(".js")?.language).toBe("javascript");
  });
});

describe("real test execution (integration)", () => {
  it.skipIf(!hasPytest)("runs the Python example's pytest suite green", async () => {
    const res = await new LocalPytestRunner().run(ex("py-calc"));
    expect(res.passed).toBe(true);
    expect(parseTestCounts(res.raw).total).toBeGreaterThanOrEqual(4);
  });

  it.skipIf(!hasPytest)("verifies a break-and-fix loop against real tests", async () => {
    const root = ex("py-calc");
    const g = buildGraph(root);
    const fn = g.nodes.find((n) => n.name === "Calculator.add_many")!;
    const src = `${root}/calc.py`;
    const { readFileSync } = await import("node:fs");
    const content = readFileSync(src, "utf8");
    const blank = blankPythonFunction(content, fn.provenance.startLine, fn.provenance.endLine);

    const runner = new LocalPytestRunner();
    const broken = await runner.run(root, { edits: [{ path: "calc.py", content: blank.fileWithBlank }] });
    expect(broken.passed).toBe(false); // blanked covered fn -> tests fail

    const fixed = replaceLineRange(
      content,
      fn.provenance.startLine,
      fn.provenance.endLine,
      "    def add_many(self, nums):\n        return sum(nums)",
    );
    const ok = await runner.run(root, { edits: [{ path: "calc.py", content: fixed }] });
    expect(ok.passed).toBe(true);
  });

  it("runs the JavaScript example via node --test", async () => {
    const res = await new LocalNodeTestRunner().run(ex("js-calc"));
    expect(res.passed).toBe(true);
  });
});
