/**
 * Graph-grounded tutor (GraphRAG): answer questions using ONLY retrieved graph
 * context, with path:line citations. This is the conversational surface; the
 * "Master" value comes from grounding every claim in the graph rather than the
 * model's memory.
 */
import type { LlmProvider } from "./enrich.js";
import { type ContextItem, buildContext } from "./retrieval.js";
import type { KnowledgeGraph } from "./types.js";

export interface TutorAnswer {
  answer: string;
  citations: ContextItem[];
  grounded: boolean; // false when no LLM is configured (degraded mode)
}

const SYSTEM =
  "You are a code tutor. Answer the question using ONLY the provided context. " +
  "Cite every claim with a source as (path:line). If the context is insufficient, " +
  "say so plainly instead of guessing. Be concise and concrete.";

function contextBlock(items: ContextItem[]): string {
  return items
    .map(
      (c) =>
        `- ${c.name} (${c.ref})` +
        (c.summary ? `: ${c.summary}` : "") +
        (c.signature ? `\n    ${c.signature}` : ""),
    )
    .join("\n");
}

export async function answerQuestion(
  graph: KnowledgeGraph,
  query: string,
  provider: LlmProvider | undefined,
  k = 6,
): Promise<TutorAnswer> {
  const citations = buildContext(graph, query, k);

  if (!provider) {
    // Degraded mode: no LLM — surface the most relevant pieces honestly.
    const list =
      citations.length === 0
        ? "No matching code found in the graph."
        : citations.map((c) => `- ${c.name} (${c.ref})${c.summary ? `: ${c.summary}` : ""}`).join("\n");
    return {
      answer: `LLM not configured — here are the most relevant pieces from the graph:\n${list}`,
      citations,
      grounded: false,
    };
  }

  const answer = await provider.complete({
    system: SYSTEM,
    prompt: `Context:\n${contextBlock(citations)}\n\nQuestion: ${query}\n\nAnswer (cite path:line):`,
    maxOutputTokens: 500,
    temperature: 0.2,
  });
  return { answer: answer.trim(), citations, grounded: true };
}
