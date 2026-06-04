/**
 * Generic OpenAI-compatible LLM provider.
 *
 * One implementation covers every backend that speaks the OpenAI
 * `/chat/completions` shape:
 *   - OpenRouter        base: https://openrouter.ai/api/v1
 *   - LiteLLM proxy     base: http://localhost:4000        (run `litellm --config ...`)
 *   - Ollama            base: http://localhost:11434/v1
 *   - vLLM / LocalAI    base: http://localhost:8000/v1
 *   - OpenAI / Azure    base: https://api.openai.com/v1
 *
 * Uses plain fetch — no SDK dependency. Errors propagate so enrichUnits can
 * fall back to the heuristic summary.
 */
import type { EnrichInput, LlmProvider } from "../enrich.js";

export interface OpenAICompatibleConfig {
  baseUrl: string; // e.g. http://localhost:4000  (no trailing /chat/completions)
  model: string;
  apiKey?: string;
  timeoutMs?: number;
  /** Extra headers, e.g. OpenRouter's HTTP-Referer / X-Title. */
  headers?: Record<string, string>;
}

interface ChatResponse {
  choices?: { message?: { content?: string } }[];
}

export class OpenAICompatibleProvider implements LlmProvider {
  constructor(private readonly cfg: OpenAICompatibleConfig) {}

  async summarizeUnit(input: EnrichInput): Promise<string> {
    const { unit, memberSignatures } = input;
    const sigs = memberSignatures.slice(0, 12).join("\n") || "(no signatures)";
    const messages = [
      {
        role: "system",
        content:
          "You explain code to a learner. Reply with ONE concise sentence describing what the unit does. No preamble, no markdown.",
      },
      {
        role: "user",
        content: `Unit: ${unit.title} (${unit.kind})\nSignatures:\n${sigs}\n\nOne sentence:`,
      },
    ];

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs ?? 20_000);
    try {
      const res = await fetch(`${this.cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          ...(this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {}),
          ...this.cfg.headers,
        },
        body: JSON.stringify({
          model: this.cfg.model,
          messages,
          temperature: 0.2,
          max_tokens: 80,
        }),
      });
      if (!res.ok) {
        throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 160)}`);
      }
      const data = (await res.json()) as ChatResponse;
      const text = data.choices?.[0]?.message?.content?.trim();
      if (!text) throw new Error("LLM returned empty content");
      return text.split("\n")[0]!.trim();
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * Build a provider from environment variables, or return undefined to keep
 * the heuristic fallback. Backend-agnostic:
 *   MA_LLM_BASE_URL   required to enable (e.g. http://localhost:4000)
 *   MA_LLM_MODEL      required (e.g. gpt-4o-mini, anthropic/claude-3.5-sonnet)
 *   MA_LLM_API_KEY    optional (LiteLLM/Ollama may not need one)
 */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider | undefined {
  const baseUrl = env.MA_LLM_BASE_URL;
  const model = env.MA_LLM_MODEL;
  if (!baseUrl || !model) return undefined;
  return new OpenAICompatibleProvider({
    baseUrl,
    model,
    apiKey: env.MA_LLM_API_KEY,
    timeoutMs: env.MA_LLM_TIMEOUT_MS ? Number(env.MA_LLM_TIMEOUT_MS) : undefined,
  });
}
