/**
 * Semantic enrichment (P0.1): give each learning unit a short summary.
 *
 * The LLM is pluggable and optional. With no provider we fall back to a
 * deterministic, signature-based summary so the whole pipeline runs without
 * an API key (docs/P0-CODE-MVP.md §5.3: degrade honestly).
 */
import type { KnowledgeGraph, KnowledgeNode } from "./types.js";
import type { LearningUnit } from "./units.js";

export interface EnrichInput {
  unit: LearningUnit;
  primary: KnowledgeNode;
  memberSignatures: string[];
}

export interface LlmProvider {
  /** Return a one-sentence summary of what the unit does. */
  summarizeUnit(input: EnrichInput): Promise<string>;
}

function heuristicSummary(input: EnrichInput): string {
  const { unit, primary, memberSignatures } = input;
  if (unit.kind === "class") {
    const methods = unit.members.length - 1;
    return `Class \`${unit.title}\`${methods > 0 ? ` with ${methods} method(s)` : ""}.`;
  }
  return primary.signature ?? `Function \`${unit.title}\`.` + (memberSignatures.length ? "" : "");
}

export async function enrichUnits(
  units: LearningUnit[],
  graph: KnowledgeGraph,
  provider?: LlmProvider,
): Promise<LearningUnit[]> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const unit of units) {
    const primary = byId.get(unit.primary)!;
    const memberSignatures = unit.members
      .map((id) => byId.get(id)?.signature)
      .filter((s): s is string => Boolean(s));
    const input: EnrichInput = { unit, primary, memberSignatures };
    if (provider) {
      try {
        unit.summary = await provider.summarizeUnit(input);
        continue;
      } catch {
        // fall through to heuristic on provider failure
      }
    }
    unit.summary = heuristicSummary(input);
  }
  return units;
}
