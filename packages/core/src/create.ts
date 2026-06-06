/**
 * Create-level assessment (Bloom's top): extend the codebase with a NEW
 * capability, verified by real tests.
 *
 * Two modes:
 *  - spec  (LLM): the model proposes a feature + a hidden acceptance test that
 *    fails on the current code; the learner implements it; we run the test.
 *  - open  (no LLM): the learner adds any new capability AND a test for it; we
 *    require the whole suite to pass with strictly more tests than before.
 */
import type { LlmProvider } from "./enrich.js";

export const OPEN_CREATE_PROMPT =
  "Extend this code with a NEW capability of your choice, and add a test that proves it. " +
  "All existing tests must still pass, and your submission must add at least one new passing test.";

export interface CreateSpec {
  feature: string;
  /** Acceptance test source (a single test file's contents). */
  test: string;
}

function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  if (start < 0) throw new Error("no JSON in response");
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("unbalanced JSON");
}

export async function generateCreateSpec(opts: {
  moduleName: string;
  language: "python" | "javascript" | "typescript";
  importHint: string; // how a test imports the module
  source: string;
  provider: LlmProvider;
}): Promise<CreateSpec> {
  const { moduleName, language, importHint, source, provider } = opts;
  const framework =
    language === "python" ? "pytest (plain `assert`)" : "Node's built-in `node:test` + `node:assert`";
  const raw = await provider.complete({
    system:
      "You design a Create-level coding challenge. Propose ONE small NEW capability that does NOT yet exist in the given module, and write a single acceptance test that specifies it. " +
      `Use ${framework}. The test MUST fail on the current code (because the feature is absent yet) and import the module via: ${importHint}. ` +
      'Respond with STRICT JSON only: {"feature": string, "test": string}. "feature" is one sentence describing what to add; "test" is the complete test file source.',
    prompt: `Module \`${moduleName}\` (${language}):\n${source.slice(0, 2000)}\n\nJSON:`,
    maxOutputTokens: 600,
    temperature: 0.5,
  });
  const obj = extractJson(raw) as Partial<CreateSpec>;
  if (typeof obj.feature !== "string" || typeof obj.test !== "string") {
    throw new Error("LLM did not return a valid {feature, test}");
  }
  return { feature: obj.feature, test: obj.test };
}

export interface CreateGrade {
  passed: boolean;
  reason: string;
}

/** Grade an open-mode attempt from before/after test counts. */
export function gradeOpenCreate(
  base: { passed: number; total: number },
  attempt: { passed: number; failed: number; total: number },
): CreateGrade {
  if (attempt.failed > 0) return { passed: false, reason: `${attempt.failed} test(s) failing` };
  if (attempt.total <= base.total) {
    return { passed: false, reason: "no new test added (suite size unchanged)" };
  }
  if (attempt.passed < base.total) {
    return { passed: false, reason: "an existing test appears to be missing or broken" };
  }
  return { passed: true, reason: `${attempt.total - base.total} new test(s), all ${attempt.total} passing` };
}
