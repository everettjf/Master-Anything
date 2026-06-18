import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  blankJsFunction,
  captureBoundaryIO,
  characterize,
  LocalNodeTestRunner,
  LocalPytestRunner,
  LocalTsTestRunner,
  snapshotFile,
  verifyAgainstSnapshot,
} from "@ma/verifier";
import { describe, expect, it } from "vitest";
import { hasPytest } from "./helpers/env.js";

const jsFixture = fileURLToPath(new URL("./fixtures/js-capture", import.meta.url));
const pyFixture = fileURLToPath(new URL("./fixtures/py-capture", import.meta.url));
const tsFixture = fileURLToPath(new URL("./fixtures/ts-capture", import.meta.url));

/** Find the 1-based [start,end] line span of a brace function named `name`. */
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

describe("captured-run I/O (grounded characterization)", () => {
  it("captures real boundary I/O from the repo's own entrypoint (JS)", async () => {
    const symbols = await captureBoundaryIO({
      repoRoot: jsFixture,
      file: "shipping.js",
      language: "javascript",
      entrypoint: "demo.js",
    });
    const byName = new Map(symbols.map((s) => [s.symbol, s]));
    // The driver calls totalPrice and Cart.lineCount with nested-object args.
    expect(byName.has("totalPrice")).toBe(true);
    expect(byName.has("Cart.lineCount")).toBe(true);
    const tp = byName.get("totalPrice")!;
    expect(tp.cases.length).toBeGreaterThanOrEqual(2);
    // Args are the real nested objects, not fuzzed primitives.
    expect(tp.cases[0]!.args).toContain('"items"');
  });

  it("makes a complex-argument function verifiable only via captured I/O (JS)", async () => {
    // The synthetic battery can't construct the nested-object argument, so
    // characterization with no driver finds nothing.
    const none = await characterize({
      repoRoot: jsFixture,
      file: "shipping.js",
      symbol: "totalPrice",
      language: "javascript",
    });
    expect(none).toBeNull();

    // With the example driver, real I/O is captured and the function becomes verifiable.
    const c = await characterize({
      repoRoot: jsFixture,
      file: "shipping.js",
      symbol: "totalPrice",
      language: "javascript",
      entrypoint: "demo.js",
    });
    expect(c).not.toBeNull();
    expect(c!.cases).toBeGreaterThanOrEqual(2);

    const runner = new LocalNodeTestRunner();
    // The generated test passes against the original (oracle) implementation.
    const ok = await runner.run(jsFixture, {
      edits: [{ path: c!.testPath, content: c!.testContent }],
      targets: [c!.testPath],
    });
    expect(ok.passed).toBe(true);

    // …and fails when the oracle target is blanked — proving it actually verifies.
    const src = readFileSync(`${jsFixture}/shipping.js`, "utf8");
    const [start, end] = jsSpan(src, "totalPrice");
    const blank = blankJsFunction(src, start, end);
    const broken = await runner.run(jsFixture, {
      edits: [
        { path: "shipping.js", content: blank.fileWithBlank },
        { path: c!.testPath, content: c!.testContent },
      ],
      targets: [c!.testPath],
    });
    expect(broken.passed).toBe(false);
  });

  it("snapshots a complex-argument function via captured I/O and catches a behavior change (JS)", async () => {
    const snap = await snapshotFile({
      repoRoot: jsFixture,
      file: "shipping.js",
      language: "javascript",
      entrypoint: "demo.js",
    });
    expect(snap).not.toBeNull();
    expect(snap!.symbols.map((s) => s.symbol)).toContain("totalPrice");

    const original = readFileSync(`${jsFixture}/shipping.js`, "utf8");

    // A behavior-preserving refactor verifies clean.
    const refactor = original.replace(
      "for (const item of order.items) subtotal += item.price * item.qty;",
      "for (const item of order.items) { subtotal = subtotal + item.qty * item.price; }",
    );
    expect(refactor).not.toBe(original);
    const okDiff = await verifyAgainstSnapshot({
      repoRoot: jsFixture,
      file: "shipping.js",
      language: "javascript",
      snapshot: snap!,
      candidate: refactor,
    });
    expect(okDiff.ok).toBe(true);

    // A real behavior change (forgetting the discount) is caught on the captured input.
    const broken = original.replace(
      "return Math.round(subtotal * (1 - order.discount) * 100) / 100;",
      "return Math.round(subtotal * 100) / 100;",
    );
    expect(broken).not.toBe(original);
    const badDiff = await verifyAgainstSnapshot({
      repoRoot: jsFixture,
      file: "shipping.js",
      language: "javascript",
      snapshot: snap!,
      candidate: broken,
    });
    expect(badDiff.ok).toBe(false);
    expect(badDiff.changed.some((c) => c.symbol === "totalPrice")).toBe(true);
  });

  it.skipIf(!hasPytest)(
    "makes a complex-argument function verifiable via captured I/O (Python)",
    async () => {
      const none = await characterize({
        repoRoot: pyFixture,
        file: "shipping.py",
        symbol: "total_price",
        language: "python",
      });
      expect(none).toBeNull();

      const c = await characterize({
        repoRoot: pyFixture,
        file: "shipping.py",
        symbol: "total_price",
        language: "python",
        entrypoint: "demo.py",
      });
      expect(c).not.toBeNull();
      expect(c!.testContent).toContain("from shipping import total_price");

      const ok = await new LocalPytestRunner().run(pyFixture, {
        edits: [{ path: c!.testPath, content: c!.testContent }],
        targets: [c!.testPath],
      });
      expect(ok.passed).toBe(true);
    },
  );

  it("records a mutating function's input as its pre-call state (JS)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ma-mut-"));
    try {
      writeFileSync(
        join(dir, "cart.js"),
        "function addItem(cart, item) { cart.items.push(item); return cart.items.length; }\n" +
          "module.exports = { addItem };\n",
      );
      writeFileSync(
        join(dir, "drive.js"),
        'const { addItem } = require("./cart");\n' +
          'addItem({ items: [] }, "a");\n' +
          'addItem({ items: ["x", "y"] }, "z");\n',
      );
      const caps = await captureBoundaryIO({
        repoRoot: dir,
        file: "cart.js",
        language: "javascript",
        entrypoint: "drive.js",
      });
      const s = caps.find((x) => x.symbol === "addItem");
      expect(s).toBeDefined();
      // The recorded args must be the pre-call cart ({items:[]}), not the mutated
      // one ({items:["a"]}) — otherwise replaying the input wouldn't reproduce the
      // return value.
      expect(s!.cases.map((c) => c.args)).toContain(JSON.stringify([{ items: [] }, "a"]));
      expect(s!.cases.map((c) => c.args)).toContain(JSON.stringify([{ items: ["x", "y"] }, "z"]));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("captures a read-only top-level TS export via the loader shim", async () => {
    const symbols = await captureBoundaryIO({
      repoRoot: tsFixture,
      file: "shipping.ts",
      language: "typescript",
      entrypoint: "demo.ts",
    });
    const names = symbols.map((s) => s.symbol);
    // totalPrice is a top-level ESM export (read-only — only reachable via the
    // loader shim); Cart.lineCount is a method (mutable prototype).
    expect(names).toContain("totalPrice");
    expect(names).toContain("Cart.lineCount");
  });

  it("makes a complex-argument TS function verifiable only via captured I/O", async () => {
    const none = await characterize({
      repoRoot: tsFixture,
      file: "shipping.ts",
      symbol: "totalPrice",
      language: "typescript",
    });
    expect(none).toBeNull();

    const c = await characterize({
      repoRoot: tsFixture,
      file: "shipping.ts",
      symbol: "totalPrice",
      language: "typescript",
      entrypoint: "demo.ts",
    });
    expect(c).not.toBeNull();
    expect(c!.testContent).toContain('from "./shipping.ts"');

    const ok = await new LocalTsTestRunner().run(tsFixture, {
      edits: [{ path: c!.testPath, content: c!.testContent }],
      targets: [c!.testPath],
    });
    expect(ok.passed).toBe(true);
  });
});
