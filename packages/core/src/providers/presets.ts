/**
 * Provider presets — many vendors out of the box, like opencode/models.dev.
 *
 * Native presets use a dedicated @ai-sdk provider; the rest are OpenAI-compatible
 * (just a base URL), so adding a vendor is one row here — no new dependency.
 * Each preset declares the env var that holds its key and a sensible default
 * model, so `export GROQ_API_KEY=…` is enough to get going (auto-detected).
 */
export interface ProviderPreset {
  label: string;
  /** Use a dedicated AI-SDK provider; otherwise routed via openai-compatible. */
  native?: "openai" | "anthropic" | "google";
  baseURL?: string; // for OpenAI-compatible vendors
  keyEnv: string; // env var holding the API key
  defaultModel: string; // used when MA_LLM_MODEL is unset
  defaultEmbedModel?: string;
}

export const PROVIDER_PRESETS: Record<string, ProviderPreset> = {
  anthropic: {
    label: "Anthropic",
    native: "anthropic",
    keyEnv: "ANTHROPIC_API_KEY",
    defaultModel: "claude-3-5-sonnet-latest",
  },
  openai: {
    label: "OpenAI",
    native: "openai",
    keyEnv: "OPENAI_API_KEY",
    defaultModel: "gpt-4o-mini",
    defaultEmbedModel: "text-embedding-3-small",
  },
  google: {
    label: "Google Gemini",
    native: "google",
    keyEnv: "GOOGLE_GENERATIVE_AI_API_KEY",
    defaultModel: "gemini-1.5-pro",
  },
  openrouter: {
    label: "OpenRouter",
    baseURL: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    defaultModel: "anthropic/claude-3.5-sonnet",
  },
  groq: {
    label: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    keyEnv: "GROQ_API_KEY",
    defaultModel: "llama-3.3-70b-versatile",
  },
  deepseek: {
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    keyEnv: "DEEPSEEK_API_KEY",
    defaultModel: "deepseek-chat",
  },
  mistral: {
    label: "Mistral",
    baseURL: "https://api.mistral.ai/v1",
    keyEnv: "MISTRAL_API_KEY",
    defaultModel: "mistral-large-latest",
  },
  xai: {
    label: "xAI Grok",
    baseURL: "https://api.x.ai/v1",
    keyEnv: "XAI_API_KEY",
    defaultModel: "grok-2-latest",
  },
  together: {
    label: "Together",
    baseURL: "https://api.together.xyz/v1",
    keyEnv: "TOGETHER_API_KEY",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
  },
  fireworks: {
    label: "Fireworks",
    baseURL: "https://api.fireworks.ai/inference/v1",
    keyEnv: "FIREWORKS_API_KEY",
    defaultModel: "accounts/fireworks/models/llama-v3p3-70b-instruct",
  },
  ollama: {
    label: "Ollama (local)",
    baseURL: "http://localhost:11434/v1",
    keyEnv: "OLLAMA_API_KEY", // usually unset; Ollama needs no key
    defaultModel: "llama3.1",
  },
};

/** Order in which a credential-only setup is auto-detected (best general first). */
export const AUTODETECT_ORDER = [
  "anthropic",
  "openai",
  "google",
  "openrouter",
  "groq",
  "deepseek",
  "mistral",
  "xai",
  "together",
  "fireworks",
];

/** Provider whose API key is present in env, in priority order (or undefined). */
export function autodetectProvider(env: NodeJS.ProcessEnv): string | undefined {
  return AUTODETECT_ORDER.find((key) => {
    const preset = PROVIDER_PRESETS[key];
    return preset && env[preset.keyEnv];
  });
}

/** Which presets currently have a usable credential (for diagnostics/UI). */
export function availableProviders(env: NodeJS.ProcessEnv): { key: string; label: string }[] {
  return Object.entries(PROVIDER_PRESETS)
    .filter(([, p]) => env[p.keyEnv])
    .map(([key, p]) => ({ key, label: p.label }));
}
