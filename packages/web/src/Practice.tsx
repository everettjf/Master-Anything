import { useEffect, useState } from "react";
import {
  type Assessment,
  type AttemptResult,
  type PathUnit,
  createAssessment,
  submitAttempt,
} from "./api.js";

const BLOOM = ["None", "Remember", "Understand", "Apply", "Analyze", "Create"];

export function Practice({
  repoId,
  unit,
  userId,
  onClose,
  onMastered,
}: {
  repoId: string;
  unit: PathUnit;
  userId: string;
  onClose: () => void;
  onMastered: () => void;
}) {
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AttemptResult | null>(null);

  useEffect(() => {
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
  }, [repoId, unit.id]);

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
        <>
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
        </>
      )}
    </div>
  );
}
