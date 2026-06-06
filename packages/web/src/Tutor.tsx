import { useRef, useState } from "react";
import { ask, type TutorAnswer } from "./api.js";

interface Turn {
  q: string;
  a?: TutorAnswer;
  error?: string;
}

export function Tutor({ repoId }: { repoId: string }) {
  const [query, setQuery] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  // Persists across turns so the tutor remembers the conversation.
  const conversationId = useRef<string | undefined>(undefined);

  const send = async () => {
    const q = query.trim();
    if (!q || busy) return;
    setQuery("");
    setBusy(true);
    const idx = turns.length;
    setTurns((t) => [...t, { q }]);
    try {
      const a = await ask(repoId, q, conversationId.current);
      conversationId.current = a.conversationId;
      setTurns((t) => t.map((turn, i) => (i === idx ? { ...turn, a } : turn)));
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      setTurns((t) => t.map((turn, i) => (i === idx ? { ...turn, error } : turn)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tutor">
      <div className="tutor-log">
        {turns.length === 0 && (
          <div className="learn-hello" style={{ marginTop: "8vh" }}>
            <h2>Ask the tutor about this codebase.</h2>
            <p>
              Answers are grounded in the knowledge graph and cite <code>path:line</code>. Without an LLM
              configured you'll still get the most relevant code locations.
            </p>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className="turn">
            <div className="q">{t.q}</div>
            {t.error && <div className="error">{t.error}</div>}
            {t.a && (
              <div className="a">
                {!t.a.grounded && <span className="badge">no LLM · degraded</span>}
                <div className="answer">{t.a.answer}</div>
                {t.a.citations.length > 0 && (
                  <div className="cites">
                    {t.a.citations.slice(0, 8).map((c) => (
                      <span key={c.id} className="cite" title={c.summary}>
                        {c.name} <em>{c.ref}</em>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="tutor-input">
        <input
          type="text"
          placeholder="e.g. how is the average computed?"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
        />
        <button onClick={send} disabled={busy}>
          {busy ? "…" : "Ask"}
        </button>
      </div>
    </div>
  );
}
