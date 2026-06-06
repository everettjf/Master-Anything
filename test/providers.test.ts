import { autodetectProvider, availableProviders, resolveProvider } from "@ma/core";
import { describe, expect, it } from "vitest";

describe("provider presets + resolution", () => {
  it("is off with no config", () => {
    expect(resolveProvider({}).provider).toBeUndefined();
  });

  it("uses an explicit preset with its default model", () => {
    const r = resolveProvider({ MA_LLM_PROVIDER: "groq", GROQ_API_KEY: "k" });
    expect(r.provider).toBeDefined();
    expect(r.describe).toContain("Groq");
    expect(r.describe).toContain("llama-3.3-70b-versatile"); // preset default
  });

  it("respects an explicit model override", () => {
    const r = resolveProvider({ MA_LLM_PROVIDER: "openai", OPENAI_API_KEY: "k", MA_LLM_MODEL: "gpt-4o" });
    expect(r.describe).toContain("gpt-4o");
  });

  it("auto-detects a provider from a known key", () => {
    const r = resolveProvider({ ANTHROPIC_API_KEY: "k" });
    expect(r.provider).toBeDefined();
    expect(r.describe).toContain("Anthropic");
    expect(r.describe).toContain("auto-detected");
  });

  it("prefers Anthropic over OpenAI when both keys exist", () => {
    expect(autodetectProvider({ OPENAI_API_KEY: "a", ANTHROPIC_API_KEY: "b" })).toBe("anthropic");
  });

  it("still supports a raw OpenAI-compatible endpoint", () => {
    const r = resolveProvider({ MA_LLM_BASE_URL: "http://localhost:4000", MA_LLM_MODEL: "m" });
    expect(r.provider).toBeDefined();
    expect(r.describe).toContain("openai-compatible");
  });

  it("reports off for an OpenAI-compatible endpoint missing a model", () => {
    expect(resolveProvider({ MA_LLM_BASE_URL: "http://x" }).provider).toBeUndefined();
  });

  it("lists available providers from env keys", () => {
    const list = availableProviders({ GROQ_API_KEY: "k", OPENAI_API_KEY: "k" }).map((p) => p.key);
    expect(list).toContain("groq");
    expect(list).toContain("openai");
  });
});

import { FailoverProvider } from "@ma/core";

describe("provider/model shorthand + failover", () => {
  it("parses provider/model shorthand", () => {
    const r = resolveProvider({ MA_LLM_MODEL: "anthropic/claude-3-5-sonnet-latest", ANTHROPIC_API_KEY: "k" });
    expect(r.describe).toContain("Anthropic");
    expect(r.describe).toContain("claude-3-5-sonnet-latest");
  });

  it("keeps OpenRouter slashed model ids when provider is explicit", () => {
    const r = resolveProvider({ MA_LLM_PROVIDER: "openrouter", OPENROUTER_API_KEY: "k", MA_LLM_MODEL: "anthropic/claude-3.5-sonnet" });
    expect(r.describe).toContain("OpenRouter");
    expect(r.describe).toContain("anthropic/claude-3.5-sonnet");
  });

  it("builds a failover chain", () => {
    const r = resolveProvider({ MA_LLM_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "k", MA_LLM_FALLBACK: "groq,openai", GROQ_API_KEY: "g", OPENAI_API_KEY: "o" });
    expect(r.describe).toContain("failover");
    expect(r.describe).toContain("Groq");
  });

  it("FailoverProvider tries the next provider on error", async () => {
    const boom = { complete: async () => { throw new Error("down"); } };
    const ok = { complete: async () => "second" };
    const fo = new FailoverProvider([boom, ok]);
    expect(await fo.complete({ prompt: "x" })).toBe("second");
  });
});
