/**
 * Semantic enrichment (P0.1): give each learning unit a short summary.
 *
 * The LLM is a thin, pluggable text-generation interface (`complete`). Domain
 * prompts live here in core. With no provider we fall back to a deterministic,
 * signature-based summary so the pipeline runs without an API key
 * (docs/P0-CODE-MVP.md §5.3: degrade honestly).
 */
import type { KnowledgeGraph, KnowledgeNode } from "./types.js";
import type { LearningUnit } from "./units.js";

export interface CompleteOptions {
  system?: string;
  prompt: string;
  maxOutputTokens?: number;
  temperature?: number;
}

export interface LlmProvider {
  complete(opts: CompleteOptions): Promise<string>;
}

export interface EnrichInput {
  unit: LearningUnit;
  primary: KnowledgeNode;
  memberSignatures: string[];
}

function heuristicSummary(input: EnrichInput): string {
  const { unit, primary } = input;
  // Adapter-provided summary (e.g. a doc section's first sentence) wins.
  if (primary.summary) return primary.summary;
  if (unit.kind === "class") {
    const methods = unit.members.length - 1;
    return `Class \`${unit.title}\`${methods > 0 ? ` with ${methods} method(s)` : ""}.`;
  }
  if (unit.kind === "section") return unit.title;
  return primary.signature ?? `Function \`${unit.title}\`.`;
}

export interface EnrichOptions {
  /** unit id -> previously computed summary, reused to skip the LLM for
   *  unchanged units during incremental rebuilds. */
  reuseSummaries?: Map<string, string>;
}

export async function enrichUnits(
  units: LearningUnit[],
  graph: KnowledgeGraph,
  provider?: LlmProvider,
  opts: EnrichOptions = {},
): Promise<LearningUnit[]> {
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  for (const unit of units) {
    const reused = opts.reuseSummaries?.get(unit.id);
    if (reused) {
      unit.summary = reused;
      continue;
    }
    const primary = byId.get(unit.primary)!;
    const memberSignatures = unit.members
      .map((id) => byId.get(id)?.signature)
      .filter((s): s is string => Boolean(s));

    if (provider) {
      try {
        const sigs = memberSignatures.slice(0, 12).join("\n") || "(no signatures)";
        const text = await provider.complete({
          system:
            "You explain code to a learner. Reply with ONE concise sentence describing what the unit does. No preamble, no markdown.",
          prompt: `Unit: ${unit.title} (${unit.kind})\nSignatures:\n${sigs}\n\nOne sentence:`,
          maxOutputTokens: 80,
          temperature: 0.2,
        });
        const summary = text.trim().split("\n")[0]!.trim();
        if (summary) {
          unit.summary = summary;
          continue;
        }
      } catch {
        // fall through to heuristic on provider failure
      }
    }
    unit.summary = heuristicSummary({ unit, primary, memberSignatures });
  }
  return units;
}
