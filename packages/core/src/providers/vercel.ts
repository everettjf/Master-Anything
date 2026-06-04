/**
 * LLM provider backed by the Vercel AI SDK (`ai`).
 *
 * One implementation, many backends — selected by MA_LLM_PROVIDER:
 *   openai            (@ai-sdk/openai,    OPENAI_API_KEY)
 *   anthropic         (@ai-sdk/anthropic, ANTHROPIC_API_KEY)
 *   google            (@ai-sdk/google,    GOOGLE_GENERATIVE_AI_API_KEY)
 *   openai-compatible (@ai-sdk/openai-compatible + MA_LLM_BASE_URL) —
 *                     covers OpenRouter, a LiteLLM proxy, Ollama, vLLM, LocalAI…
 *
 * Wrapped behind our LlmProvider interface so enrichUnits falls back to the
 * heuristic summary if a call fails.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type LanguageModel, generateText } from "ai";
import type { EnrichInput, LlmProvider } from "../enrich.js";

export interface VercelAiConfig {
  provider: string;
  model: string;
  apiKey?: string;
  baseURL?: string; // required for provider "openai-compatible"
  timeoutMs?: number;
}

function buildModel(cfg: VercelAiConfig): LanguageModel {
  const key = cfg.apiKey ? { apiKey: cfg.apiKey } : {};
  switch (cfg.provider) {
    case "openai":
      return createOpenAI(key)(cfg.model);
    case "anthropic":
      return createAnthropic(key)(cfg.model);
    case "google":
      return createGoogleGenerativeAI(key)(cfg.model);
    case "openai-compatible": {
      if (!cfg.baseURL) throw new Error("provider 'openai-compatible' requires MA_LLM_BASE_URL");
      return createOpenAICompatible({ name: "ma", baseURL: cfg.baseURL, ...key })(cfg.model);
    }
    default:
      throw new Error(`unknown MA_LLM_PROVIDER: ${cfg.provider}`);
  }
}

export class VercelAiProvider implements LlmProvider {
  private readonly model: LanguageModel;

  constructor(private readonly cfg: VercelAiConfig) {
    this.model = buildModel(cfg);
  }

  async summarizeUnit(input: EnrichInput): Promise<string> {
    const { unit, memberSignatures } = input;
    const sigs = memberSignatures.slice(0, 12).join("\n") || "(no signatures)";

    const { text } = await generateText({
      model: this.model,
      system:
        "You explain code to a learner. Reply with ONE concise sentence describing what the unit does. No preamble, no markdown.",
      prompt: `Unit: ${unit.title} (${unit.kind})\nSignatures:\n${sigs}\n\nOne sentence:`,
      temperature: 0.2,
      maxOutputTokens: 80,
      abortSignal: AbortSignal.timeout(this.cfg.timeoutMs ?? 20_000),
    });

    const summary = text.trim().split("\n")[0]!.trim();
    if (!summary) throw new Error("LLM returned empty content");
    return summary;
  }
}
