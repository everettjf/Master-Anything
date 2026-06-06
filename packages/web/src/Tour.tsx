import { useEffect, useState } from "react";
import { type TourStep, fetchTour, narrateTourStep } from "./api.js";

export function Tour({ repoId, onClose }: { repoId: string; onClose: () => void }) {
  const [steps, setSteps] = useState<TourStep[]>([]);
  const [i, setI] = useState(0);
  const [narration, setNarration] = useState<string>("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchTour(repoId)
      .then((t) => setSteps(t.steps))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [repoId]);

  const step = steps[i];
  useEffect(() => {
    if (!step) return;
    setBusy(true);
    setNarration("");
    narrateTourStep(repoId, step.unitId)
      .then((r) => setNarration(r.narration))
      .catch((e) => setNarration(`(narration unavailable: ${e instanceof Error ? e.message : e})`))
      .finally(() => setBusy(false));
  }, [repoId, step?.unitId]);

  if (error) return <div className="tour"><div className="error">{error}</div></div>;
  if (!step) return <div className="tour"><div className="hint">Loading tour…</div></div>;

  return (
    <div className="tour-wrap">
      <div className="tour-card">
        <button className="close" onClick={onClose}>×</button>
        <div className="tour-prog">Guided tour · step {i + 1} of {steps.length}</div>
        <div className="tour-bar"><span style={{ width: `${((i + 1) / steps.length) * 100}%` }} /></div>

        <h2>{step.title}</h2>
        <div className="path">{step.kind} · {step.ref}</div>

        <p className="tour-narr">{busy ? "Narrating…" : narration}</p>

        <div className="tour-rel">
          {step.buildsOn.length > 0 && (
            <div><span className="rel-label">builds on</span>{step.buildsOn.map((t) => <span key={t} className="cite">{t}</span>)}</div>
          )}
          {step.usedBy.length > 0 && (
            <div><span className="rel-label">used by</span>{step.usedBy.map((t) => <span key={t} className="cite">{t}</span>)}</div>
          )}
        </div>

        <div className="tour-nav">
          <button className="ghostbtn" disabled={i === 0} onClick={() => setI(i - 1)}>← Prev</button>
          <span className="hint">{step.unitId.split(":")[0]}</span>
          {i < steps.length - 1 ? (
            <button onClick={() => setI(i + 1)}>Next →</button>
          ) : (
            <button onClick={onClose}>Finish ✓</button>
          )}
        </div>
      </div>
    </div>
  );
}
