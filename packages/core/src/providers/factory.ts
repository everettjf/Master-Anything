/**
 * Choose an LLM provider from the environment — opencode / openclaw-style DX:
 *
 *  1. Explicit:     MA_LLM_PROVIDER=groq  (+ optional MA_LLM_MODEL; else the
 *                   preset default; key from the preset's env var or MA_LLM_API_KEY).
 *  2. Shorthand:    MA_LLM_MODEL=anthropic/claude-3-5-sonnet-latest  (provider/model
 *                   in one string, when the first segment is a known preset).
 *  3. Any endpoint: MA_LLM_BASE_URL=… + MA_LLM_MODEL  (OpenAI-compatible).
 *  4. Auto-detect:  nothing set but a known key is present (e.g. ANTHROPIC_API_KEY)
 *                   → that provider with its default model. "Just works."
 *  5. Failover:     MA_LLM_FALLBACK=openai,groq  → try the primary, then each
 *                   fallback on error (openclaw-style model failover).
 *  6. Off:          none of the above → heuristic summaries.
 */
import type { LlmProvider } from "../enrich.js";
import { FailoverProvider } from "./failover.js";
import { PROVIDER_PRESETS, autodetectProvider, availableProviders } from "./presets.js";
import { VercelAiProvider } from "./vercel.js";

export interface ProviderInfo {
  provider?: LlmProvider;
  describe: string;
}

interface Built {
  provider: LlmProvider;
  label: string;
  model: string;
}

/** Build a single provider from a preset key (or "openai-compatible"). */
function buildPreset(
  key: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number | undefined,
  opts: { model?: string; apiKey?: string; baseURL?: string } = {},
): Built | undefined {
  if (key === "openai-compatible") {
    const baseURL = opts.baseURL ?? env.MA_LLM_BASE_URL;
    const model = opts.model ?? env.MA_LLM_MODEL;
    if (!baseURL || !model) return undefined;
    return {
      provider: new VercelAiProvider({ provider: "openai-compatible", model, apiKey: opts.apiKey ?? env.MA_LLM_API_KEY, baseURL, timeoutMs }),
      label: `openai-compatible · ${baseURL}`,
      model,
    };
  }
  const preset = PROVIDER_PRESETS[key];
  if (!preset) return undefined;
  const apiKey = opts.apiKey ?? env[preset.keyEnv];
  const model = opts.model ?? preset.defaultModel;
  const baseURL = opts.baseURL ?? preset.baseURL;
  const underlying = preset.native ?? "openai-compatible";
  if (underlying === "openai-compatible" && !baseURL) return undefined;
  return {
    provider: new VercelAiProvider({ provider: underlying, model, apiKey, baseURL, timeoutMs }),
    label: preset.label,
    model,
  };
}

export function resolveProvider(env: NodeJS.ProcessEnv = process.env): ProviderInfo {
  const timeoutMs = env.MA_LLM_TIMEOUT_MS ? Number(env.MA_LLM_TIMEOUT_MS) : undefined;
  let explicit = env.MA_LLM_PROVIDER?.toLowerCase();
  let shorthandModel: string | undefined;

  // provider/model shorthand (only when provider is not set explicitly and the
  // first segment names a known preset — keeps OpenRouter model ids intact).
  if (!explicit && env.MA_LLM_MODEL?.includes("/")) {
    const [head, ...rest] = env.MA_LLM_MODEL.split("/");
    if (head && PROVIDER_PRESETS[head]) {
      explicit = head;
      shorthandModel = rest.join("/");
    }
  }

  // Decide the primary provider key.
  let key = explicit;
  let autoDetected = false;
  if (!key && env.MA_LLM_BASE_URL) key = "openai-compatible";
  if (!key) {
    const detected = autodetectProvider(env);
    if (detected) {
      key = detected;
      autoDetected = true;
    }
  }
  if (!key) return { describe: "off — heuristic summaries (set MA_LLM_PROVIDER or a provider key)" };

  const primary = buildPreset(key, env, timeoutMs, {
    model: shorthandModel ?? env.MA_LLM_MODEL,
    apiKey: env.MA_LLM_API_KEY,
    baseURL: env.MA_LLM_BASE_URL,
  });
  if (!primary) return { describe: `off — ${key} is missing a key/base URL/model` };

  // Optional failover chain (each uses its own preset defaults + env key).
  const fallbacks = (env.MA_LLM_FALLBACK ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .map((k) => buildPreset(k, env, timeoutMs))
    .filter((b): b is Built => Boolean(b));

  const detSuffix = autoDetected ? ", auto-detected" : "";
  if (fallbacks.length === 0) {
    return { provider: primary.provider, describe: `vercel-ai (${primary.label}${detSuffix} · ${primary.model})` };
  }
  return {
    provider: new FailoverProvider([primary.provider, ...fallbacks.map((f) => f.provider)]),
    describe: `vercel-ai (${primary.label}${detSuffix} · ${primary.model}) +failover(${fallbacks.map((f) => f.label).join(", ")})`,
  };
}

/** Convenience: just the provider (or undefined). */
export function providerFromEnv(env: NodeJS.ProcessEnv = process.env): LlmProvider | undefined {
  return resolveProvider(env).provider;
}

/** Human summary of which provider credentials are present (diagnostics/UI). */
export function describeAvailableProviders(env: NodeJS.ProcessEnv = process.env): string {
  const list = availableProviders(env);
  return list.length ? list.map((p) => p.label).join(", ") : "none detected";
}
