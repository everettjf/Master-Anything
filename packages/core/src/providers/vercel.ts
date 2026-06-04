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
 * Implements the thin `complete` interface; callers (enrich, tutor) own prompts.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { type LanguageModel, generateText } from "ai";
import type { CompleteOptions, LlmProvider } from "../enrich.js";

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

  async complete(opts: CompleteOptions): Promise<string> {
    const { text } = await generateText({
      model: this.model,
      system: opts.system,
      prompt: opts.prompt,
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxOutputTokens ?? 400,
      abortSignal: AbortSignal.timeout(this.cfg.timeoutMs ?? 30_000),
    });
    return text;
  }
}
