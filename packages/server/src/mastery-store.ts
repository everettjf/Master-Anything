/**
 * Mastery + assessment state for the P0 MVP (in-memory).
 * Generates break-and-fix Apply tasks and verifies submissions with pytest.
 */
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";
import {
  BloomLevel,
  type ImpactQuestion,
  type LearnerUnitState,
  type LearningUnit,
  buildImpactQuestion,
  emptyState,
  generateExplainQuestion,
  gradeExplain,
  gradeImpact,
  recordAttempt,
} from "@ma/core";
import {
  type RunnerInfo,
  type SupportedLanguage,
  makeRunner,
  replaceLineRange,
  verifierForExtension,
} from "@ma/verifier";
import { llm } from "./store.js";
import type { RepoRecord } from "./store.js";

// One runner per language, resolved lazily/once. Python honors MA_SANDBOX.
const runnerByLang = new Map<SupportedLanguage, Promise<RunnerInfo>>();
function getRunner(language: SupportedLanguage) {
  let p = runnerByLang.get(language);
  if (!p) {
    p = makeRunner(language);
    runnerByLang.set(language, p);
  }
  return p;
}
export async function runnerDescribe(): Promise<string> {
  return (await getRunner("python")).describe;
}

/** Read the source lines a unit's primary node points at. */
function unitSource(repo: RepoRecord, unit: LearningUnit): { text: string; ref: string } {
  const node = repo.graph.nodes.find((n) => n.id === unit.primary);
  if (!node) throw new Error("unit primary node not found");
  const ref = `${node.provenance.path}:${node.provenance.startLine}`;
  // Non-code nodes (doc sections, PDF pages) carry extracted text; code reads source lines.
  if (node.text) return { text: node.text, ref };
  const lines = readFileSync(join(repo.root, node.provenance.path), "utf8").split("\n");
  return { text: lines.slice(node.provenance.startLine - 1, node.provenance.endLine).join("\n"), ref };
}

export interface ApplyAssessment {
  id: string;
  repoId: string;
  unitId: string;
  kind: "break-fix";
  language: SupportedLanguage;
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

// Learner state keyed by `${userId}:${repoRoot}:${unitId}` (repoRoot is stable
// across restarts, unlike the per-process repo id) and persisted to disk.
const states = new Map<string, LearnerUnitState>();

const DATA_DIR = process.env.MA_DATA_DIR ?? join(process.cwd(), ".ma-data");
const STATE_FILE = join(DATA_DIR, "mastery.json");

function loadStates(): void {
  try {
    const entries = JSON.parse(readFileSync(STATE_FILE, "utf8")) as [string, LearnerUnitState][];
    for (const [k, v] of entries) states.set(k, v);
  } catch {
    /* no prior state */
  }
}
loadStates();

function persistStates(): void {
  try {
    mkdirSync(DATA_DIR, { recursive: true });
    writeFileSync(STATE_FILE, JSON.stringify([...states.entries()]));
  } catch (err) {
    console.warn(`could not persist mastery: ${String(err)}`);
  }
}

/** Record a learner state change and persist it. */
function setState(key: string, state: LearnerUnitState): void {
  states.set(key, state);
  persistStates();
}

function stateKey(userId: string, repoRoot: string, unitId: string): string {
  return `${userId}:${repoRoot}:${unitId}`;
}

export function getState(userId: string, repoRoot: string, unitId: string): LearnerUnitState {
  return states.get(stateKey(userId, repoRoot, unitId)) ?? emptyState(userId, unitId);
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
  const verifier = verifierForExtension(extname(fn.provenance.path));
  if (!verifier) {
    throw new Error(`Apply tasks support Python and JavaScript; not ${extname(fn.provenance.path)}`);
  }

  const source = readFileSync(join(repo.root, fn.provenance.path), "utf8");
  const blank = verifier.blank(source, fn.provenance.startLine, fn.provenance.endLine);

  // Coverage probe: blank the function and run tests. If they fail, it's verifiable.
  const { runner } = await getRunner(verifier.language);
  const probe = await runner.run(repo.root, {
    edits: [{ path: fn.provenance.path, content: blank.fileWithBlank }],
  });
  const verifiable = !probe.passed;

  const assessment: ApplyAssessment = {
    id: randomUUID(),
    repoId: repo.id,
    unitId: unit.id,
    kind: "break-fix",
    language: verifier.language,
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
  const { runner } = await getRunner(a.language);
  const result = await runner.run(repo.root, { edits: [{ path: a.path, content: edited }] });

  // Only a test-covered task counts as verified mastery; otherwise it's advisory.
  const passed = result.passed;
  const key = stateKey(userId, repo.root, a.unitId);
  const prev = states.get(key) ?? emptyState(userId, a.unitId);
  const next = recordAttempt(prev, {
    assessmentId,
    targetLevel: a.targetLevel,
    passed: passed && a.verifiable,
    verifier: "tests",
    at: new Date().toISOString(),
  });
  setState(key, next);

  return {
    passed,
    verifiable: a.verifiable,
    summary: result.summary,
    raw: result.raw,
    durationMs: result.durationMs,
    state: next,
  };
}

// --- Analyze level: graph-verified impact questions ---

interface StoredImpact {
  id: string;
  repoId: string;
  question: ImpactQuestion;
}
const impacts = new Map<string, StoredImpact>();

export function createImpactAssessment(repo: RepoRecord, unit: LearningUnit) {
  const units = [...repo.units.values()];
  const question = buildImpactQuestion(units, unit.id);
  const id = randomUUID();
  impacts.set(id, { id, repoId: repo.id, question });
  // Options carry `correct`, which the client must not see — strip it.
  return {
    id,
    unitId: unit.id,
    targetLevel: BloomLevel.Analyze,
    prompt: question.prompt,
    options: question.options.map((o) => ({ unitId: o.unitId, title: o.title })),
  };
}

export function submitImpactAttempt(
  repo: RepoRecord,
  userId: string,
  assessmentId: string,
  selectedIds: string[],
) {
  const stored = impacts.get(assessmentId);
  if (!stored || stored.repoId !== repo.id) throw new Error("assessment not found");
  const grade = gradeImpact(stored.question, selectedIds);

  const key = stateKey(userId, repo.root, stored.question.targetUnitId);
  const prev = states.get(key) ?? emptyState(userId, stored.question.targetUnitId);
  const next = recordAttempt(prev, {
    assessmentId,
    targetLevel: BloomLevel.Analyze,
    passed: grade.passed,
    verifier: "graph",
    at: new Date().toISOString(),
  });
  setState(key, next);

  return { passed: grade.passed, correctIds: grade.correctIds, missedIds: grade.missedIds, wrongIds: grade.wrongIds, state: next };
}

// --- Understand level: LLM question + source-grounded grading ---

interface StoredExplain {
  id: string;
  repoId: string;
  unitId: string;
  title: string;
  sourceText: string;
  question: string;
}
const explains = new Map<string, StoredExplain>();

export async function createExplainAssessment(repo: RepoRecord, unit: LearningUnit) {
  if (!llm) throw new Error("Understand questions require an LLM (set MA_LLM_*)");
  const { text } = unitSource(repo, unit);
  const question = await generateExplainQuestion(unit.title, text, llm);
  const id = randomUUID();
  explains.set(id, { id, repoId: repo.id, unitId: unit.id, title: unit.title, sourceText: text, question });
  return { id, unitId: unit.id, targetLevel: BloomLevel.Understand, question };
}

export async function submitExplainAttempt(
  repo: RepoRecord,
  userId: string,
  assessmentId: string,
  answer: string,
) {
  if (!llm) throw new Error("grading requires an LLM (set MA_LLM_*)");
  const stored = explains.get(assessmentId);
  if (!stored || stored.repoId !== repo.id) throw new Error("assessment not found");
  const grade = await gradeExplain(stored.title, stored.sourceText, stored.question, answer, llm);

  const key = stateKey(userId, repo.root, stored.unitId);
  const prev = states.get(key) ?? emptyState(userId, stored.unitId);
  const next = recordAttempt(prev, {
    assessmentId,
    targetLevel: BloomLevel.Understand,
    passed: grade.passed,
    verifier: "llm",
    at: new Date().toISOString(),
  });
  setState(key, next);
  return { ...grade, state: next };
}

export function masteryFor(userId: string, repo: RepoRecord) {
  return repo.path.units.map((u) => {
    const s = states.get(stateKey(userId, repo.root, u.id));
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
