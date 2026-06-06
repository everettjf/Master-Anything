import { useEffect, useState } from "react";
import { fetchConfig, type MaConfig, setConfig } from "./api.js";

const PRESETS = [
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
  "ollama",
  "openai-compatible",
];

export function ModelSettings({ onClose }: { onClose: () => void }) {
  const [cfg, setCfg] = useState<MaConfig | null>(null);
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [fallback, setFallback] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchConfig()
      .then(setCfg)
      .catch((e) => setError(String(e)));
  }, []);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await setConfig({
        provider: provider || undefined,
        model: model || undefined,
        baseUrl: baseUrl || undefined,
        fallback: fallback || undefined,
      });
      setCfg(next);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-wrap" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <button className="close" onClick={onClose}>
          ×
        </button>
        <h3>Model settings</h3>

        <div className="cfg-now">
          <div>
            <span className="k">LLM</span> {cfg?.llm ?? "…"}
          </div>
          <div>
            <span className="k">Embeddings</span> {cfg?.embeddings ?? "…"}
          </div>
          <div>
            <span className="k">Keys detected</span> {cfg?.providers ?? "…"}
          </div>
        </div>

        <div className="cfg-form">
          <label>Provider</label>
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="">(auto-detect / keep)</option>
            {PRESETS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>

          <label>
            Model <span className="opt">(optional — preset default if blank)</span>
          </label>
          <input
            type="text"
            placeholder="e.g. gpt-4o-mini"
            value={model}
            onChange={(e) => setModel(e.target.value)}
          />

          {provider === "openai-compatible" && (
            <>
              <label>Base URL</label>
              <input
                type="text"
                placeholder="http://localhost:4000"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </>
          )}

          <label>
            Failover <span className="opt">(optional, comma-separated)</span>
          </label>
          <input
            type="text"
            placeholder="openai,groq"
            value={fallback}
            onChange={(e) => setFallback(e.target.value)}
          />

          <button onClick={apply} disabled={busy}>
            {busy ? "Applying…" : "Apply"}
          </button>
        </div>

        {error && <div className="error">{error}</div>}
        <div className="hint">
          API keys come from the server's environment (e.g. <code>ANTHROPIC_API_KEY</code>). Without one, it
          falls back to heuristics.
        </div>
      </div>
    </div>
  );
}
