/**
 * Graph-grounded tutor (GraphRAG): answer questions using ONLY retrieved graph
 * context, with path:line citations. This is the conversational surface; the
 * "Master" value comes from grounding every claim in the graph rather than the
 * model's memory.
 */
import type { EmbeddingIndex } from "./embeddings.js";
import type { LlmProvider } from "./enrich.js";
import { type ContextItem, buildContext, expandHits } from "./retrieval.js";
import type { KnowledgeGraph } from "./types.js";

export interface ChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface TutorOptions {
  k?: number;
  /** When provided, retrieval is semantic (embeddings) instead of lexical. */
  index?: EmbeddingIndex;
  /** Prior conversation turns, for follow-up questions ("its callers?"). */
  history?: ChatTurn[];
}

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
  opts: TutorOptions = {},
): Promise<TutorAnswer> {
  const k = opts.k ?? 6;
  const history = opts.history ?? [];
  // Fold recent user turns into the retrieval query so follow-ups resolve
  // ("what about its callers?" needs the earlier subject).
  const recentUser = history
    .filter((t) => t.role === "user")
    .slice(-2)
    .map((t) => t.content);
  const retrievalQuery = [...recentUser, query].join(" ");
  const citations = opts.index
    ? expandHits(graph, await opts.index.query(retrievalQuery, k), k)
    : buildContext(graph, retrievalQuery, k);

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

  const convo = history.length
    ? `Conversation so far:\n${history.map((t) => `${t.role}: ${t.content}`).join("\n")}\n\n`
    : "";
  const answer = await provider.complete({
    system: SYSTEM,
    prompt: `${convo}Context:\n${contextBlock(citations)}\n\nQuestion: ${query}\n\nAnswer (cite path:line):`,
    maxOutputTokens: 500,
    temperature: 0.2,
  });
  return { answer: answer.trim(), citations, grounded: true };
}
