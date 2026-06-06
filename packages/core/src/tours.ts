/**
 * Guided tours: walk the dependency-ordered learning path one unit at a time,
 * narrating what each unit is, why it matters, and how it connects to the rest.
 * Narration uses the LLM when available, degrading to a grounded heuristic.
 */
import { dependentsOf } from "./analyze.js";
import type { LlmProvider } from "./enrich.js";
import type { LearningUnit } from "./units.js";

export interface TourStep {
  unitId: string;
  title: string;
  kind: string;
  ref: string;
  buildsOn: string[]; // titles of prerequisites
  usedBy: string[]; // titles of dependents
}

/** Build ordered tour steps from the learning path, with relationship context. */
export function tourSteps(ordered: LearningUnit[]): TourStep[] {
  const byId = new Map(ordered.map((u) => [u.id, u]));
  const deps = dependentsOf(ordered);
  const title = (id: string) => byId.get(id)?.title ?? id;
  return ordered.map((u) => ({
    unitId: u.id,
    title: u.title,
    kind: u.kind,
    ref: `${u.provenance.path}:${u.provenance.startLine}`,
    buildsOn: u.prerequisites.filter((p) => byId.has(p)).map(title),
    usedBy: [...(deps.get(u.id) ?? [])].map(title),
  }));
}

function heuristicNarration(unit: LearningUnit, buildsOn: string[], usedBy: string[]): string {
  const parts = [unit.summary ?? `\`${unit.title}\`.`];
  if (buildsOn.length) parts.push(`It builds on ${buildsOn.join(", ")}.`);
  if (usedBy.length) parts.push(`It's used by ${usedBy.join(", ")}.`);
  return parts.join(" ");
}

export async function narrateStep(
  unit: LearningUnit,
  source: string,
  buildsOn: string[],
  usedBy: string[],
  provider?: LlmProvider,
): Promise<string> {
  if (!provider) return heuristicNarration(unit, buildsOn, usedBy);
  try {
    const rel =
      (buildsOn.length ? `Builds on: ${buildsOn.join(", ")}. ` : "") +
      (usedBy.length ? `Used by: ${usedBy.join(", ")}.` : "");
    const text = await provider.complete({
      system:
        "You are a code tour guide. In 2-3 sentences explain, for a learner: what this unit does, why it matters, and how it connects to the listed neighbors. Cite the location as (path:line). Be concrete; no preamble.",
      prompt: `Unit: ${unit.title}\nLocation: ${unit.provenance.path}:${unit.provenance.startLine}\n${rel}\n\nSource:\n${source.slice(0, 1600)}\n\nNarration:`,
      maxOutputTokens: 220,
      temperature: 0.3,
    });
    return text.trim() || heuristicNarration(unit, buildsOn, usedBy);
  } catch {
    return heuristicNarration(unit, buildsOn, usedBy);
  }
}
