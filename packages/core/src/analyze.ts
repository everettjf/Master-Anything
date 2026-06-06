/**
 * Analyze-level assessment, verified by the graph (docs/P0-CODE-MVP.md §4).
 *
 * "If you change unit X, which units are affected?" has a ground-truth answer:
 * the units that depend on X (call into it). We generate a select-all-that-apply
 * question and grade it deterministically against the graph — no LLM opinion.
 */
import type { LearningUnit } from "./units.js";

export interface ImpactOption {
  unitId: string;
  title: string;
  correct: boolean; // depends on the target (would be affected)
}

export interface ImpactQuestion {
  targetUnitId: string;
  targetTitle: string;
  prompt: string;
  options: ImpactOption[];
}

/** Map each unit -> the units that directly depend on it (its dependents). */
export function dependentsOf(units: LearningUnit[]): Map<string, Set<string>> {
  const deps = new Map<string, Set<string>>();
  for (const u of units) deps.set(u.id, new Set());
  for (const u of units) {
    for (const prereq of u.prerequisites) {
      deps.get(prereq)?.add(u.id);
    }
  }
  return deps;
}

/** Units that have at least one dependent — the ones worth asking about. */
export function impactableUnits(units: LearningUnit[]): LearningUnit[] {
  const deps = dependentsOf(units);
  return units.filter((u) => (deps.get(u.id)?.size ?? 0) > 0);
}

/**
 * Build an impact question for `targetUnitId`. `pick` selects distractors
 * (defaults to deterministic order) so tests are reproducible.
 */
export function buildImpactQuestion(
  units: LearningUnit[],
  targetUnitId: string,
  maxOptions = 5,
): ImpactQuestion {
  const byId = new Map(units.map((u) => [u.id, u]));
  const target = byId.get(targetUnitId);
  if (!target) throw new Error("target unit not found");

  const deps = dependentsOf(units);
  const correctIds = deps.get(targetUnitId) ?? new Set<string>();

  const correct = [...correctIds].map((id) => byId.get(id)!).filter(Boolean);
  const distractors = units.filter((u) => u.id !== targetUnitId && !correctIds.has(u.id));

  const chosen = [...correct, ...distractors].slice(0, Math.max(maxOptions, correct.length));
  // stable order by title so the UI is deterministic
  chosen.sort((a, b) => a.title.localeCompare(b.title));

  return {
    targetUnitId,
    targetTitle: target.title,
    prompt: `If you change \`${target.title}\`, which of these units are directly affected? (select all that apply)`,
    options: chosen.map((u) => ({
      unitId: u.id,
      title: u.title,
      correct: correctIds.has(u.id),
    })),
  };
}

export interface ImpactGrade {
  passed: boolean;
  correctIds: string[];
  missedIds: string[]; // correct answers not selected
  wrongIds: string[]; // selected but not correct
}

export function gradeImpact(question: ImpactQuestion, selectedIds: string[]): ImpactGrade {
  const selected = new Set(selectedIds);
  const correctIds = question.options.filter((o) => o.correct).map((o) => o.unitId);
  const correctSet = new Set(correctIds);
  const missedIds = correctIds.filter((id) => !selected.has(id));
  const wrongIds = [...selected].filter((id) => !correctSet.has(id));
  return { passed: missedIds.length === 0 && wrongIds.length === 0, correctIds, missedIds, wrongIds };
}
