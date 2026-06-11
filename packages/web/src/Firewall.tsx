import { useMemo, useState } from "react";
import { type BehaviorDiff, type FirewallSnapshot, firewallSnapshot, firewallVerify } from "./api.js";

const CODE_EXT = /\.(py|js|cjs|mjs|ts|tsx)$/;

/** Render a stored literal arg-list as a call: "[12, -1, 7]" -> "clamp(12, -1, 7)". */
function call(symbol: string, args: string): string {
  const inner = args.trim().replace(/^\[/, "").replace(/\]$/, "");
  const parts = symbol.split(".");
  const head = parts.length === 2 ? `${parts[0]}().${parts[1]}` : parts[0];
  return `${head}(${inner})`;
}

export function Firewall({ repoId, files }: { repoId: string; files: string[] }) {
  const codeFiles = useMemo(() => [...new Set(files.filter((f) => CODE_EXT.test(f)))].sort(), [files]);
  const [path, setPath] = useState(codeFiles[0] ?? "");
  const [snap, setSnap] = useState<FirewallSnapshot | null>(null);
  const [candidate, setCandidate] = useState("");
  const [diff, setDiff] = useState<BehaviorDiff | null>(null);
  const [busy, setBusy] = useState<"snap" | "verify" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function doSnapshot() {
    if (!path) return;
    setBusy("snap");
    setError(null);
    setDiff(null);
    try {
      const s = await firewallSnapshot(repoId, path);
      setSnap(s);
      setCandidate(s.source);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSnap(null);
    } finally {
      setBusy(null);
    }
  }

  async function doVerify() {
    if (!snap) return;
    setBusy("verify");
    setError(null);
    try {
      setDiff(await firewallVerify(repoId, snap.file, candidate));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="firewall">
      <h2>🛡 Behavioral Firewall</h2>
      <p className="fw-lead">
        Snapshot a file's behavior, edit it (or paste an AI's rewrite), then verify the behavior survived —
        with the exact <code>(function, input)</code> that changed.
      </p>

      <div className="fw-pick">
        <select value={path} onChange={(e) => setPath(e.target.value)}>
          {codeFiles.length === 0 && <option value="">no code files</option>}
          {codeFiles.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button onClick={doSnapshot} disabled={!path || busy !== null}>
          {busy === "snap" ? "Snapshotting…" : "① Snapshot behavior"}
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {snap && (
        <>
          <div className="fw-pinned">
            ✓ pinned <b>{snap.totalCases}</b> behaviors across <b>{snap.symbols.length}</b> function
            {snap.symbols.length > 1 ? "s" : ""}:{" "}
            {snap.symbols.map((s) => (
              <span key={s.symbol} className="fw-sym">
                {s.symbol} <em>({s.cases})</em>
              </span>
            ))}
          </div>

          <div className="fw-edit">
            <div className="fw-edit-head">Candidate (edit freely — this is the "after"):</div>
            <textarea
              spellCheck={false}
              value={candidate}
              onChange={(e) => setCandidate(e.target.value)}
              rows={Math.min(24, Math.max(8, candidate.split("\n").length + 1))}
            />
          </div>

          <div className="fw-actions">
            <button onClick={doVerify} disabled={busy !== null}>
              {busy === "verify" ? "Verifying…" : "② Verify behavior preserved"}
            </button>
          </div>
        </>
      )}

      {diff && (
        <div className={`fw-result ${diff.ok ? "ok" : "bad"}`}>
          {diff.ok ? (
            <b>
              ✅ behavior preserved — {diff.preserved}/{diff.totalCases} behaviors unchanged
            </b>
          ) : (
            <>
              <b>❌ behavior CHANGED</b>
              {diff.changed.length > 0 && (
                <div className="fw-diffs">
                  <div className="fw-diffs-head">{diff.changed.length} behavior(s) differ:</div>
                  {diff.changed.map((c, i) => (
                    <div key={`${c.symbol}-${i}`} className="fw-diff">
                      <code>{call(c.symbol, c.args)}</code>
                      <span className="was">
                        was <code>{c.expected}</code>
                      </span>
                      <span className="now">
                        now <code>{c.actual}</code>
                      </span>
                    </div>
                  ))}
                </div>
              )}
              {diff.errored.length > 0 && (
                <div className="fw-diffs">
                  <div className="fw-diffs-head">{diff.errored.length} now raise an error:</div>
                  {diff.errored.map((c, i) => (
                    <div key={`e-${c.symbol}-${i}`} className="fw-diff">
                      <code>{call(c.symbol, c.args)}</code>
                      <span className="was">
                        was <code>{c.expected}</code>
                      </span>
                      <span className="now">now ⚠ error</span>
                    </div>
                  ))}
                </div>
              )}
              {diff.missing.length > 0 && (
                <div className="fw-diffs">
                  <div className="fw-diffs-head">{diff.missing.length} function(s) missing:</div>
                  {diff.missing.map((m) => (
                    <div key={m} className="fw-diff">
                      <code>{m}</code>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
