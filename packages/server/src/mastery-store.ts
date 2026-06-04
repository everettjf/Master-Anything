/**
 * Mastery + assessment state for the P0 MVP (in-memory).
 * Generates break-and-fix Apply tasks and verifies submissions with pytest.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import {
  BloomLevel,
  type LearnerUnitState,
  type LearningUnit,
  emptyState,
  recordAttempt,
} from "@ma/core";
import { LocalPytestRunner, blankPythonFunction, replaceLineRange } from "@ma/verifier";
import type { RepoRecord } from "./store.js";

const runner = new LocalPytestRunner();

export interface ApplyAssessment {
  id: string;
  repoId: string;
  unitId: string;
  kind: "break-fix";
  language: "python";
  targetLevel: BloomLevel;
  path: string;
  startLine: number;
  endLine: number;
  prompt: string;
  brokenFunction: string;
  /** Whether the suite actually covers this function (tests fail when blanked). */
  verifiable: boolean;
  note?: string;
}

const assessments = new Map<string, ApplyAssessment>();
// learner state keyed by `${userId}:${repoId}:${unitId}`
const states = new Map<string, LearnerUnitState>();

function stateKey(userId: string, repoId: string, unitId: string): string {
  return `${userId}:${repoId}:${unitId}`;
}

export function getState(userId: string, repoId: string, unitId: string): LearnerUnitState {
  return states.get(stateKey(userId, repoId, unitId)) ?? emptyState(userId, unitId);
}

/** Pick the target function node for a unit (the function itself, or a class method with a body). */
function targetFunction(repo: RepoRecord, unit: LearningUnit) {
  const byId = new Map(repo.graph.nodes.map((n) => [n.id, n]));
  const candidates = unit.members
    .map((id) => byId.get(id)!)
    .filter((n) => n.kind === "function" && n.provenance.endLine > n.provenance.startLine);
  // prefer the primary if it qualifies
  return candidates.find((n) => n.id === unit.primary) ?? candidates[0];
}

export async function createApplyAssessment(
  repo: RepoRecord,
  unit: LearningUnit,
): Promise<ApplyAssessment> {
  const fn = targetFunction(repo, unit);
  if (!fn) throw new Error("unit has no implementable function to practice");
  if (extname(fn.provenance.path) !== ".py") {
    throw new Error("Apply tasks are Python-only in P0");
  }

  const source = readFileSync(join(repo.root, fn.provenance.path), "utf8");
  const blank = blankPythonFunction(source, fn.provenance.startLine, fn.provenance.endLine);

  // Coverage probe: blank the function and run tests. If they fail, it's verifiable.
  const probe = await runner.run(repo.root, {
    edits: [{ path: fn.provenance.path, content: blank.fileWithBlank }],
  });
  const verifiable = !probe.passed;

  const assessment: ApplyAssessment = {
    id: randomUUID(),
    repoId: repo.id,
    unitId: unit.id,
    kind: "break-fix",
    language: "python",
    targetLevel: BloomLevel.Apply,
    path: fn.provenance.path,
    startLine: fn.provenance.startLine,
    endLine: fn.provenance.endLine,
    prompt: `Reimplement \`${fn.name}\` so the project's tests pass.`,
    brokenFunction: blank.brokenFunction,
    verifiable,
    note: verifiable
      ? undefined
      : "No test covers this function — a passing submission can't be test-verified (would be self-check only).",
  };
  assessments.set(assessment.id, assessment);
  return assessment;
}

export interface AttemptResult {
  passed: boolean;
  verifiable: boolean;
  summary: string;
  raw: string;
  durationMs: number;
  state: LearnerUnitState;
}

export async function submitAttempt(
  repo: RepoRecord,
  userId: string,
  assessmentId: string,
  submission: string,
): Promise<AttemptResult> {
  const a = assessments.get(assessmentId);
  if (!a || a.repoId !== repo.id) throw new Error("assessment not found");

  const source = readFileSync(join(repo.root, a.path), "utf8");
  const edited = replaceLineRange(source, a.startLine, a.endLine, submission);
  const result = await runner.run(repo.root, { edits: [{ path: a.path, content: edited }] });

  // Only a test-covered task counts as verified mastery; otherwise it's advisory.
  const passed = result.passed;
  const key = stateKey(userId, repo.id, a.unitId);
  const prev = states.get(key) ?? emptyState(userId, a.unitId);
  const next = recordAttempt(prev, {
    assessmentId,
    targetLevel: a.targetLevel,
    passed: passed && a.verifiable,
    verifier: "tests",
    at: new Date().toISOString(),
  });
  states.set(key, next);

  return {
    passed,
    verifiable: a.verifiable,
    summary: result.summary,
    raw: result.raw,
    durationMs: result.durationMs,
    state: next,
  };
}

export function masteryFor(userId: string, repo: RepoRecord) {
  return repo.path.units.map((u) => {
    const s = states.get(stateKey(userId, repo.id, u.id));
    return {
      unitId: u.id,
      title: u.title,
      kind: u.kind,
      bloomCeiling: u.bloomCeiling,
      level: s?.level ?? BloomLevel.None,
      confidence: s?.confidence ?? 0,
      attempts: s?.attempts.length ?? 0,
    };
  });
}
