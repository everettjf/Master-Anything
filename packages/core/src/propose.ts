/**
 * LLM-proposed inputs (thrust A, deepening): when a model is configured, ask it
 * for domain-representative argument-lists to feed the characterization oracle.
 *
 * The deterministic battery (in @ma/verifier) only fuzzes primitives/collections;
 * captured-run I/O needs a driver. When neither covers a function but an LLM is
 * available, it can *propose* realistic inputs from the function's source — a
 * config dict, a well-formed record, a tricky edge case. These run through the
 * oracle's existing round-trip + two-run-stable filter, so wrong guesses are
 * simply dropped; the result is just extra `proposedInputs` for `characterize`.
 *
 * Offline (no provider) this isn't called — the battery stands alone.
 */
import type { LlmProvider } from "./enrich.js";

export interface ProposeInputsOptions {
  provider: LlmProvider;
  language: "python" | "javascript" | "typescript";
  /** Function name, possibly "Class.method". */
  symbol: string;
  /** Source of the function (or its file), used to ground the proposal. */
  source: string;
  /** Max number of argument-lists to return (default 8). */
  max?: number;
}

/** Extract the first balanced JSON array from free text. */
function extractJsonArray(text: string): unknown {
  const start = text.indexOf("[");
  if (start < 0) throw new Error("no JSON array");
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === "[") depth++;
    else if (ch === "]" && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error("unbalanced JSON array");
}

/** Render a JSON value as a Python literal (so the Python harness can `eval` it). */
export function jsonToPyLiteral(v: unknown): string {
  if (v === null) return "None";
  if (typeof v === "boolean") return v ? "True" : "False";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return JSON.stringify(v); // valid Python str literal too
  if (Array.isArray(v)) return `[${v.map(jsonToPyLiteral).join(", ")}]`;
  if (typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).map(
      ([k, val]) => `${JSON.stringify(k)}: ${jsonToPyLiteral(val)}`,
    );
    return `{${entries.join(", ")}}`;
  }
  throw new Error(`unsupported value: ${typeof v}`);
}

/**
 * Convert one parsed argument-list (array of JSON values) into the harness's
 * native literal form, or null if it isn't a usable list.
 */
function toNativeArgList(argList: unknown, language: ProposeInputsOptions["language"]): string | null {
  if (!Array.isArray(argList)) return null;
  try {
    return language === "python" ? `[${argList.map(jsonToPyLiteral).join(", ")}]` : JSON.stringify(argList);
  } catch {
    return null;
  }
}

/**
 * Ask the LLM for argument-lists to characterize `symbol`. Returns native-literal
 * arg-list strings ready for `characterize({ proposedInputs })`. Never throws —
 * on any failure (bad model output, parse error) it returns `[]` so the caller
 * degrades to the battery.
 */
export async function proposeInputs(opts: ProposeInputsOptions): Promise<string[]> {
  const { provider, language, symbol, source } = opts;
  const max = opts.max ?? 8;
  try {
    const raw = await provider.complete({
      system:
        "You generate test inputs for a single function so its behavior can be characterized. " +
        "Return STRICT JSON only: an array of argument-lists, where each argument-list is a JSON array of the " +
        "function's POSITIONAL arguments in order (no keyword args). Prefer realistic, domain-representative " +
        "inputs (well-formed records/objects the function expects) plus a few edge cases. Every value MUST be a " +
        "JSON literal (string/number/boolean/null/array/object) — no expressions, no functions, no dates. " +
        `Return at most ${max} argument-lists.`,
      prompt: `Function \`${symbol}\` (${language}):\n${source.slice(0, 2000)}\n\nJSON array of argument-lists:`,
      maxOutputTokens: 600,
      temperature: 0.4,
    });
    const arr = extractJsonArray(raw);
    if (!Array.isArray(arr)) return [];
    const out: string[] = [];
    for (const argList of arr.slice(0, max)) {
      const lit = toNativeArgList(argList, language);
      if (lit) out.push(lit);
    }
    return out;
  } catch {
    return [];
  }
}
