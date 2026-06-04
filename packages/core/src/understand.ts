/**
 * Understand-level assessment: the tutor asks a comprehension question about a
 * unit, the learner answers in prose, and the LLM grades the answer *against
 * the source code* (provenance-grounded), not against its own opinion of the
 * topic. Passing promotes the unit to the Understand Bloom level.
 *
 * Requires an LLM provider (generation + grading). Callers degrade when absent.
 */
import type { LlmProvider } from "./enrich.js";

export interface ExplainGrade {
  passed: boolean;
  score: number; // 0..100
  feedback: string;
}

/** Extract the first balanced {...} JSON object from a string. */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("no JSON object in response");
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) {
      return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error("unbalanced JSON in response");
}

export async function generateExplainQuestion(
  title: string,
  sourceText: string,
  provider: LlmProvider,
): Promise<string> {
  const q = await provider.complete({
    system:
      "You are a code tutor. Ask ONE specific question that checks whether the learner UNDERSTANDS this code (focus on why/how and behavior, not trivia). Output only the question.",
    prompt: `Code for \`${title}\`:\n${sourceText}\n\nQuestion:`,
    maxOutputTokens: 120,
    temperature: 0.4,
  });
  return q.trim();
}

export async function gradeExplain(
  title: string,
  sourceText: string,
  question: string,
  answer: string,
  provider: LlmProvider,
): Promise<ExplainGrade> {
  const raw = await provider.complete({
    system:
      'You grade a learner\'s answer against the reference code. Respond with STRICT JSON only: {"passed": boolean, "score": number, "feedback": string}. ' +
      "score is 0-100. Pass (passed=true) only if the answer is substantially correct AND grounded in the code. Keep feedback to one or two sentences.",
    prompt: `Code for \`${title}\`:\n${sourceText}\n\nQuestion: ${question}\nLearner answer: ${answer}\n\nJSON:`,
    maxOutputTokens: 200,
    temperature: 0,
  });
  try {
    const obj = extractJson(raw) as Partial<ExplainGrade>;
    return {
      passed: Boolean(obj.passed),
      score: typeof obj.score === "number" ? obj.score : obj.passed ? 100 : 0,
      feedback: typeof obj.feedback === "string" ? obj.feedback : "",
    };
  } catch {
    // If the model didn't return clean JSON, fail safe with the raw text.
    return { passed: false, score: 0, feedback: raw.trim().slice(0, 300) };
  }
}
