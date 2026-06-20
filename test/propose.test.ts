import { jsonToPyLiteral, type LlmProvider, proposeInputs } from "@ma/core";
import { describe, expect, it } from "vitest";

/** A fake provider that returns a fixed completion. */
const fake = (text: string): LlmProvider => ({ complete: async () => text });

describe("LLM-proposed inputs", () => {
  it("renders JSON values as Python literals", () => {
    expect(jsonToPyLiteral(null)).toBe("None");
    expect(jsonToPyLiteral(true)).toBe("True");
    expect(jsonToPyLiteral(3)).toBe("3");
    expect(jsonToPyLiteral("ab")).toBe('"ab"');
    expect(jsonToPyLiteral([1, "x"])).toBe('[1, "x"]');
    expect(jsonToPyLiteral({ items: [1], discount: 0.1 })).toBe('{"items": [1], "discount": 0.1}');
  });

  it("parses a JSON array of arg-lists into native JS literals", async () => {
    const provider = fake('[[{"a":1},"x"], [2, 3]]');
    const out = await proposeInputs({ provider, language: "javascript", symbol: "f", source: "fn" });
    expect(out).toEqual(['[{"a":1},"x"]', "[2,3]"]);
  });

  it("converts arg-lists to Python literal form", async () => {
    const provider = fake('[[{"a": 1}, true], [null]]');
    const out = await proposeInputs({ provider, language: "python", symbol: "f", source: "fn" });
    expect(out).toEqual(['[{"a": 1}, True]', "[None]"]);
  });

  it("tolerates prose around the JSON and caps the count", async () => {
    const provider = fake("Sure! Here you go:\n[[1],[2],[3],[4]]\nHope that helps.");
    const out = await proposeInputs({ provider, language: "javascript", symbol: "f", source: "fn", max: 2 });
    expect(out).toEqual(["[1]", "[2]"]);
  });

  it("degrades to [] on unusable model output (no throw)", async () => {
    expect(
      await proposeInputs({
        provider: fake("no json here"),
        language: "javascript",
        symbol: "f",
        source: "s",
      }),
    ).toEqual([]);
    // Non-array entries are skipped.
    const mixed = fake('[[1], "nope", 5, [2]]');
    expect(
      await proposeInputs({ provider: mixed, language: "javascript", symbol: "f", source: "s" }),
    ).toEqual(["[1]", "[2]"]);
  });
});
