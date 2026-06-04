/**
 * Choose an LLM provider from environment, or undefined to keep the heuristic
 * fallback. All backends go through the Vercel AI SDK (see ./vercel.ts).
 *
 *   A) Named provider:
 *        MA_LLM_PROVIDER=anthropic  MA_LLM_MODEL=claude-3-5-sonnet-latest
 *        (reads ANTHROPIC_API_KEY / OPENAI_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY;
 *         MA_LLM_API_KEY overrides)
 *
 *   B) Any OpenAI-compatible endpoint (OpenRouter / LiteLLM proxy / Ollama):
 *        MA_LLM_BASE_URL=http://localhost:4000  MA_LLM_MODEL=my-model
 *        (implicitly uses provider "openai-compatible")
 */
import type { LlmProvider } from "../enrich.js";
import { VercelAiProvider } from "./vercel.js";

export interface ProviderInfo {
  provider?: LlmProvider;
  describe: string;
}

export function resolveProvider(env: NodeJS.ProcessEnv = process.env): ProviderInfo {
  const model = env.MA_LLM_MODEL;
  const timeoutMs = env.MA_LLM_TIMEOUT_MS ? Number(env.MA_LLM_TIMEOUT_MS) : undefined;
  const apiKey = env.MA_LLM_API_KEY;

  // A) explicit provider
  if (env.MA_LLM_PROVIDER && model) {
    return {
      provider: new VercelAiProvider({
        provider: env.MA_LLM_PROVIDER,
        model,
        apiKey,
        baseURL: env.MA_LLM_BASE_URL,
        timeoutMs,
      }),
      describe: `vercel-ai (${env.MA_LLM_PROVIDER} · ${model})`,
    };
  }

  // B) base URL only -> openai-compatible
  if (env.MA_LLM_BASE_URL && model) {
    return {
      provider: new VercelAiProvider({
        provider: "openai-compatible",
        model,
        apiKey,
        baseURL: env.MA_LLM_BASE_URL,
        timeoutMs,
      }),
      describe: `vercel-ai (openai-compatible · ${env.MA_LLM_BASE_URL} · ${model})`,
    };
  }

  return { describe: "off — heuristic summaries" };
}

/** Convenience: just the provider (or undefined). */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider | undefined {
  return resolveProvider(env).provider;
}
