/**
 * AI-certification twin — run the mastery loop with the learner = an *agent*.
 *
 * The same objective verification that grades a human's Apply attempt can grade a
 * model's. For every implementable unit we blank the function, ask an agent to
 * reimplement it, and verify with real tests / the characterization oracle — then
 * feed the pass/fail into knowledge tracing to produce a per-unit *competence
 * profile* of that agent on *this* repo: where it's solid, where it's weak.
 *
 * Pure orchestration over A (verification) + B (beliefs). The only non-
 * deterministic step is the agent itself, injected as a `solve` function, so the
 * harness is fully testable with a fake agent and pluggable to any real model.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beliefsFor, createApplyAssessment, submitAttempt } from "./mastery-store.js";
import type { RepoRecord } from "./store.js";
import { getLlm } from "./store.js";

export interface CertTask {
  unitId: string;
  title: string;
  language: string;
  path: string;
  /** The function with its body removed (signature + NotImplemented stub). */
  brokenFunction: string;
  /** The whole file with the target blanked — context for the agent. */
  context: string;
  /** The reference implementation (used by oracle/test solvers; never sent to a real model). */
  originalFunction: string;
}

/** An agent under test: given a task, return the full reimplemented function. */
export type AgentSolver = (task: CertTask) => Promise<string>;

export interface CertUnitResult {
  unitId: string;
  title: string;
  verifiedBy: "suite" | "characterization" | "none";
  /** Whether the unit could be objectively graded (has a real or synthesized oracle). */
  gradable: boolean;
  passed: boolean;
}

export interface CertificationReport {
  agent: string;
  totalUnits: number;
  gradable: number;
  passed: number;
  /** passed / gradable, 0..1. */
  passRate: number;
  weakest: { unitId: string; title: string; belief: number }[];
  results: CertUnitResult[];
}

const AGENT_SYSTEM =
  "You are an expert software engineer. Reimplement the given function so the project's tests pass. " +
  "Respond with ONLY the complete function — signature and body, correctly indented — and no markdown fences or commentary.";

function stripFences(text: string): string {
  const fenced = text.match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  return (fenced ? fenced[1]! : text).trimEnd();
}

/** Build an agent backed by the configured LLM (uses only the blanked context). */
export function llmSolver(): AgentSolver | null {
  const llm = getLlm();
  if (!llm) return null;
  return async (task) => {
    const out = await llm.complete({
      system: AGENT_SYSTEM,
      prompt:
        `File \`${task.path}\` (the target function's body has been removed):\n\n` +
        `${task.context}\n\n` +
        `Reimplement this function completely:\n\n${task.brokenFunction}`,
      temperature: 0,
      maxOutputTokens: 700,
    });
    return stripFences(out);
  };
}

/** An "oracle agent" that submits the reference implementation — a perfect baseline. */
export const oracleSolver: AgentSolver = async (task) => task.originalFunction;

/** A "lazy agent" that leaves the stub untouched — a zero baseline / negative control. */
export const lazySolver: AgentSolver = async (task) => task.brokenFunction;

/**
 * Certify an agent against a repo: run the Apply loop for each implementable unit
 * with the agent as solver, verify objectively, and trace competence.
 */
export async function certifyAgent(
  repo: RepoRecord,
  solve: AgentSolver,
  opts: { agent?: string; limit?: number; userId?: string } = {},
): Promise<CertificationReport> {
  const agent = opts.agent ?? "agent";
  const userId = opts.userId ?? `agent:${agent}`;
  const units = repo.path.units.slice(0, opts.limit ?? repo.path.units.length);
  const results: CertUnitResult[] = [];

  for (const unit of units) {
    let assessment: Awaited<ReturnType<typeof createApplyAssessment>>;
    try {
      assessment = await createApplyAssessment(repo, unit);
    } catch {
      continue; // unit has no implementable function — not part of the exam
    }

    const source = readFileSync(join(repo.root, assessment.path), "utf8");
    const lines = source.split("\n");
    const originalFunction = lines.slice(assessment.startLine - 1, assessment.endLine).join("\n");
    const context = [
      ...lines.slice(0, assessment.startLine - 1),
      assessment.brokenFunction,
      ...lines.slice(assessment.endLine),
    ].join("\n");

    if (!assessment.verifiable) {
      results.push({
        unitId: unit.id,
        title: unit.title,
        verifiedBy: assessment.verifiedBy,
        gradable: false,
        passed: false,
      });
      continue;
    }

    let passed = false;
    try {
      const submission = await solve({
        unitId: unit.id,
        title: unit.title,
        language: assessment.language,
        path: assessment.path,
        brokenFunction: assessment.brokenFunction,
        context,
        originalFunction,
      });
      const result = await submitAttempt(repo, userId, assessment.id, submission);
      passed = result.passed && result.verifiable;
    } catch {
      passed = false;
    }
    results.push({
      unitId: unit.id,
      title: unit.title,
      verifiedBy: assessment.verifiedBy,
      gradable: true,
      passed,
    });
  }

  const gradable = results.filter((r) => r.gradable);
  const passed = gradable.filter((r) => r.passed).length;

  // Competence profile from the agent's own attempts, propagated across the graph.
  const beliefs = beliefsFor(userId, repo);
  const weakest = gradable
    .map((r) => ({ unitId: r.unitId, title: r.title, belief: beliefs.get(r.unitId)?.belief ?? 0 }))
    .filter((w) => !gradableResultPassed(results, w.unitId))
    .sort((a, b) => a.belief - b.belief)
    .slice(0, 5);

  return {
    agent,
    totalUnits: results.length,
    gradable: gradable.length,
    passed,
    passRate: gradable.length ? passed / gradable.length : 0,
    weakest,
    results,
  };
}

function gradableResultPassed(results: CertUnitResult[], unitId: string): boolean {
  return results.find((r) => r.unitId === unitId)?.passed ?? false;
}
