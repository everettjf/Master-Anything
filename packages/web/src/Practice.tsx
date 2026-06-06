import { useEffect, useState } from "react";
import {
  type Assessment,
  type AttemptResult,
  type CreateAssessment,
  type CreateResult,
  type ExplainQuestion,
  type ExplainResult,
  type ImpactQuestion,
  type ImpactResult,
  type PathUnit,
  createAssessment,
  createCreate,
  createExplain,
  createImpact,
  submitAttempt,
  submitCreate,
  submitExplain,
  submitImpact,
} from "./api.js";

const BLOOM = ["None", "Remember", "Understand", "Apply", "Analyze", "Create"];

export function Practice({
  repoId,
  unit,
  userId,
  repoKind,
  onClose,
  onMastered,
}: {
  repoId: string;
  unit: PathUnit;
  userId: string;
  repoKind: "code" | "docs" | "pdf" | "mixed";
  onClose: () => void;
  onMastered: () => void;
}) {
  // Apply (break-and-fix) is available per-unit for code files, even inside a
  // mixed repo where other units are docs.
  const codeApply = /\.(py|js|mjs|cjs|ts|tsx|jsx)$/.test(unit.provenance.path);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);

  useEffect(() => {
    if (!codeApply) {
      setLoading(false);
      return; // docs units have no executable Apply task
    }
    setLoading(true);
    setError(null);
    setResult(null);
    createAssessment(repoId, unit.id)
      .then((a) => {
        setAssessment(a);
        setCode(a.brokenFunction);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [repoId, unit.id, codeApply]);

  const run = async () => {
    if (!assessment) return;
    setRunning(true);
    setResult(null);
    try {
      const r = await submitAttempt(repoId, userId, assessment.id, code);
      setResult(r);
      if (r.passed && r.verifiable) onMastered();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="practice">
      <button className="close" onClick={onClose}>
        ×
      </button>
      <h3>Practice · {unit.title}</h3>

      {loading && <div className="hint">Preparing a task (running the test suite once)…</div>}
      {error && <div className="error">{error}</div>}

      {assessment && (
        <div className="apply">
          <h4 style={{ color: "#3fb950" }}>Apply challenge · real tests</h4>
          <div className="prompt">{assessment.prompt}</div>
          <div className="path">
            {assessment.path}:{assessment.startLine}-{assessment.endLine} ·{" "}
            {assessment.verifiable ? (
              <span className="ok">✓ test-verified</span>
            ) : (
              <span className="warn">⚠ not test-covered (advisory only)</span>
            )}
          </div>
          {assessment.note && <div className="hint">{assessment.note}</div>}

          <textarea
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            rows={Math.max(6, code.split("\n").length + 1)}
          />

          <div className="actions">
            <button onClick={run} disabled={running}>
              {running ? "Running tests…" : "Run tests"}
            </button>
            <span className="hint">
              Target: <b>{BLOOM[assessment.targetLevel]}</b>
            </span>
          </div>

          {result && (
            <div className={`result ${result.passed && result.verifiable ? "pass" : "fail"}`}>
              <b>
                {result.passed && result.verifiable
                  ? "✓ Mastered (Apply) — tests pass"
                  : result.passed
                    ? "Tests pass (advisory; not counted)"
                    : "✗ Tests failing"}
              </b>
              <div className="summary">
                {result.summary} · {result.durationMs}ms · level {result.state.level}
              </div>
              <pre>{result.raw}</pre>
            </div>
          )}
        </div>
      )}

      {!loading && (
        <>
          <UnderstandChallenge repoId={repoId} unit={unit} userId={userId} onMastered={onMastered} />
          <AnalyzeChallenge repoId={repoId} unit={unit} userId={userId} onMastered={onMastered} />
          {codeApply && (
            <CreateChallenge repoId={repoId} unit={unit} userId={userId} onMastered={onMastered} />
          )}
        </>
      )}
    </div>
  );
}

/** Create-level challenge: extend the code with a new capability, verified by real tests. */
function CreateChallenge({
  repoId,
  unit,
  userId,
  onMastered,
}: {
  repoId: string;
  unit: PathUnit;
  userId: string;
  onMastered: () => void;
}) {
  const [a, setA] = useState<CreateAssessment | null>(null);
  const [code, setCode] = useState("");
  const [test, setTest] = useState("");
  const [result, setResult] = useState<CreateResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const asmt = await createCreate(repoId, unit.id);
      setA(asmt);
      setCode(asmt.code);
      setTest("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!a) return;
    setBusy(true);
    setResult(null);
    try {
      const r = await submitCreate(repoId, userId, a.id, code, test);
      setResult(r);
      if (r.passed) onMastered();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="analyze">
      <h4 style={{ color: "#f778ba" }}>Create challenge · build something new, verified by tests</h4>
      {error && <div className="error">{error}</div>}
      {!a && (
        <button onClick={load} disabled={busy}>
          {busy ? "…" : "Start create challenge"}
        </button>
      )}
      {a && (
        <>
          <div className="prompt">{a.prompt}</div>
          <div className="path">
            edit <code>{a.codePath}</code>
            {a.mode === "open" && (
              <>
                {" "}
                · add a test in <code>{a.testPath}</code>
              </>
            )}
            {a.mode === "spec" && <> · a hidden acceptance test will run</>}
          </div>

          <div className="hint" style={{ margin: "6px 0" }}>{a.codePath}</div>
          <textarea
            spellCheck={false}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            rows={Math.min(16, code.split("\n").length + 1)}
          />
          {a.mode === "open" && (
            <>
              <div className="hint" style={{ margin: "6px 0" }}>{a.testPath} (your test)</div>
              <textarea
                spellCheck={false}
                placeholder="Write a test that proves your new capability…"
                value={test}
                onChange={(e) => setTest(e.target.value)}
                rows={6}
              />
            </>
          )}

          {!result && (
            <button onClick={submit} disabled={busy}>
              {busy ? "Running tests…" : "Run tests"}
            </button>
          )}
          {result && (
            <div className={`result ${result.passed ? "pass" : "fail"}`}>
              <b>{result.passed ? "✓ Mastered (Create) — verified by tests" : "✗ Not yet"}</b>
              <div className="summary">
                {result.reason} · {result.summary} · level {result.state.level}
              </div>
              <pre>{result.raw}</pre>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Understand-level challenge: tutor asks, you answer in prose, LLM grades vs source. */
function UnderstandChallenge({
  repoId,
  unit,
  userId,
  onMastered,
}: {
  repoId: string;
  unit: PathUnit;
  userId: string;
  onMastered: () => void;
}) {
  const [q, setQ] = useState<ExplainQuestion | null>(null);
  const [answer, setAnswer] = useState("");
  const [result, setResult] = useState<ExplainResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setAnswer("");
    try {
      setQ(await createExplain(repoId, unit.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!q || !answer.trim()) return;
    setBusy(true);
    try {
      const r = await submitExplain(repoId, userId, q.id, answer);
      setResult(r);
      if (r.passed) onMastered();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="analyze">
      <h4 style={{ color: "#58a6ff" }}>Understand challenge · LLM-graded vs source</h4>
      {error && <div className="error">{error}</div>}
      {!q && (
        <button onClick={load} disabled={busy}>
          {busy ? "…" : "Ask me a question"}
        </button>
      )}
      {q && (
        <>
          <div className="prompt">{q.question}</div>
          <textarea
            rows={4}
            spellCheck={false}
            placeholder="Explain in your own words…"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
          />
          {!result && (
            <button onClick={submit} disabled={busy || !answer.trim()}>
              {busy ? "Grading…" : "Submit answer"}
            </button>
          )}
          {result && (
            <div className={`result ${result.passed ? "pass" : "fail"}`}>
              <b>
                {result.passed ? "✓ Mastered (Understand)" : "✗ Not yet"} · score {result.score}
              </b>
              <div className="summary">level {result.state.level}</div>
              {result.feedback && <div>{result.feedback}</div>}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Analyze-level challenge: graph-verified impact (select-all-that-apply). */
function AnalyzeChallenge({
  repoId,
  unit,
  userId,
  onMastered,
}: {
  repoId: string;
  unit: PathUnit;
  userId: string;
  onMastered: () => void;
}) {
  const [q, setQ] = useState<ImpactQuestion | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<ImpactResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setSelected(new Set());
    try {
      setQ(await createImpact(repoId, unit.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  const toggle = (id: string) => {
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    setSelected(next);
  };

  const submit = async () => {
    if (!q) return;
    try {
      const r = await submitImpact(repoId, userId, q.id, [...selected]);
      setResult(r);
      if (r.passed) onMastered();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="analyze">
      <h4>Analyze challenge · graph-verified</h4>
      {error && <div className="error">{error}</div>}
      {!q && (
        <button onClick={load} disabled={loading}>
          {loading ? "…" : "Start impact challenge"}
        </button>
      )}
      {q && (
        <>
          <div className="prompt">{q.prompt}</div>
          <div className="opts">
            {q.options.map((o) => {
              const cls = result
                ? result.correctIds.includes(o.unitId)
                  ? "opt correct"
                  : selected.has(o.unitId)
                    ? "opt wrong"
                    : "opt"
                : "opt";
              return (
                <label key={o.unitId} className={cls}>
                  <input
                    type="checkbox"
                    checked={selected.has(o.unitId)}
                    disabled={!!result}
                    onChange={() => toggle(o.unitId)}
                  />
                  {o.title}
                </label>
              );
            })}
          </div>
          {!result && <button onClick={submit}>Check answer</button>}
          {result && (
            <div className={`result ${result.passed ? "pass" : "fail"}`}>
              <b>{result.passed ? "✓ Mastered (Analyze) — matches the graph" : "✗ Not quite"}</b>
              <div className="summary">level {result.state.level}</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
