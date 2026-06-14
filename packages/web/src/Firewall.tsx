import { useMemo, useState } from "react";
import {
  type BehaviorDiff,
  type CertificationReport,
  type ComparisonReport,
  certify,
  certifyCompare,
  type FirewallSnapshot,
  firewallSnapshot,
  firewallVerify,
} from "./api.js";

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
  const [cert, setCert] = useState<CertificationReport | null>(null);
  const [certBusy, setCertBusy] = useState<string | null>(null);
  const [board, setBoard] = useState<ComparisonReport | null>(null);

  async function runCertify(agent: "llm" | "oracle" | "lazy") {
    setCertBusy(agent);
    setError(null);
    setBoard(null);
    try {
      setCert(await certify(repoId, agent));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCertBusy(null);
    }
  }

  async function runCompare() {
    setCertBusy("compare");
    setError(null);
    setCert(null);
    try {
      setBoard(await certifyCompare(repoId, ["llm", "oracle", "lazy"]));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCertBusy(null);
    }
  }

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

      <div className="cert">
        <h2>🤖 Certify an agent</h2>
        <p className="fw-lead">
          Run the Apply exam over this repo with an agent as solver and grade it objectively — a competence
          profile of where it's solid and where it's weak on <i>your</i> code.
        </p>
        <div className="cert-actions">
          <button onClick={() => runCertify("llm")} disabled={certBusy !== null}>
            {certBusy === "llm" ? "Running…" : "Certify the configured model"}
          </button>
          <button className="ghost" onClick={() => runCertify("oracle")} disabled={certBusy !== null}>
            {certBusy === "oracle" ? "…" : "oracle baseline"}
          </button>
          <button className="ghost" onClick={() => runCertify("lazy")} disabled={certBusy !== null}>
            {certBusy === "lazy" ? "…" : "lazy baseline"}
          </button>
          <button onClick={runCompare} disabled={certBusy !== null}>
            {certBusy === "compare" ? "Comparing…" : "⚖ Compare (leaderboard)"}
          </button>
        </div>

        {board && (
          <div className="cert-board">
            <div className="cert-board-head">
              Leaderboard — {board.gradable} gradable unit{board.gradable === 1 ? "" : "s"} on this repo
            </div>
            {board.leaderboard.map((r, i) => (
              <div key={r.agent} className="cert-board-row">
                <span className="cert-rank">#{i + 1}</span>
                <span className="cert-pct sm">{Math.round(r.passRate * 100)}%</span>
                <span className="cert-board-agent">{r.agent}</span>
                <span className="cert-sub">
                  {r.passed}/{r.gradable}
                </span>
              </div>
            ))}
          </div>
        )}

        {cert && (
          <div className="cert-report">
            <div className="cert-score">
              <span className="cert-pct">{Math.round(cert.passRate * 100)}%</span>
              <span className="cert-sub">
                <b>{cert.agent}</b> — passed {cert.passed}/{cert.gradable} gradable units (of{" "}
                {cert.totalUnits})
              </span>
            </div>
            <div className="cert-rows">
              {cert.results.map((r) => (
                <div key={r.unitId} className="cert-row">
                  <span className={`cert-mark ${r.gradable ? (r.passed ? "ok" : "bad") : "na"}`}>
                    {r.gradable ? (r.passed ? "✓" : "✗") : "–"}
                  </span>
                  <span className="cert-title">{r.title}</span>
                  <span className="cert-tag">{r.gradable ? r.verifiedBy : "not gradable"}</span>
                </div>
              ))}
            </div>
            {cert.weakest.length > 0 && (
              <div className="cert-weak">
                Weakest on this repo: {cert.weakest.map((w) => w.title).join(" · ")}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
