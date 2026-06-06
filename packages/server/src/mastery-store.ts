/**
 * Mastery + assessment state for the P0 MVP (in-memory).
 * Generates break-and-fix Apply tasks and verifies submissions with pytest.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import {
  BloomLevel,
  OPEN_CREATE_PROMPT,
  type ImpactQuestion,
  type LearnerUnitState,
  type LearningUnit,
  buildImpactQuestion,
  emptyState,
  generateCreateSpec,
  generateExplainQuestion,
  gradeExplain,
  gradeImpact,
  gradeOpenCreate,
  isDue,
  recordAttempt,
} from "@ma/core";
import {
  type RunnerInfo,
  type SupportedLanguage,
  makeRunner,
  parseTestCounts,
  replaceLineRange,
  verifierForExtension,
} from "@ma/verifier";
import { getAllMastery, putMastery } from "./db.js";
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
export function unitSource(repo: RepoRecord, unit: LearningUnit): { text: string; ref: string } {
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

// Learner state cached in memory, durably backed by SQLite (write-through).
// Keyed by `${userId}:${repoRoot}:${unitId}` — repoRoot is stable across restarts.
const states = new Map<string, LearnerUnitState>();

function stateKey(userId: string, repoRoot: string, unitId: string): string {
  return `${userId}:${repoRoot}:${unitId}`;
}

// Hydrate the in-memory cache from the DB on boot.
for (const { user, repoRoot, state } of getAllMastery()) {
  states.set(stateKey(user, repoRoot, state.unitId), state);
}

/** Record a learner state change and write it through to SQLite. */
function setState(userId: string, repoRoot: string, state: LearnerUnitState): void {
  const key = stateKey(userId, repoRoot, state.unitId);
  states.set(key, state);
  putMastery(userId, repoRoot, state);
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
  setState(userId, repo.root, next);

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
  setState(userId, repo.root, next);

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
  setState(userId, repo.root, next);
  return { ...grade, state: next };
}

// --- Create level: extend the codebase with a new capability, verified by tests ---

interface StoredCreate {
  id: string;
  repoId: string;
  unitId: string;
  mode: "spec" | "open";
  language: SupportedLanguage;
  codePath: string;
  testPath: string;
  hiddenTest?: string; // spec mode: the acceptance test (not sent to client)
  baseTotal: number;
  basePassed: number;
}
const creates = new Map<string, StoredCreate>();
const baselineCache = new Map<string, { passed: number; total: number }>();

async function baseline(repo: RepoRecord, language: SupportedLanguage) {
  const key = `${repo.id}:${language}`;
  const cached = baselineCache.get(key);
  if (cached) return cached;
  const { runner } = await getRunner(language);
  const res = await runner.run(repo.root, {});
  const c = parseTestCounts(res.raw);
  const v = { passed: c.passed, total: c.total };
  baselineCache.set(key, v);
  return v;
}

function importHint(language: SupportedLanguage, codePath: string): string {
  const mod = basename(codePath).replace(/\.[^.]+$/, "");
  if (language === "python") return `from ${mod} import ...`;
  if (language === "typescript") return `import { ... } from "./${basename(codePath)}"`;
  return `const { ... } = require("./${mod}")`;
}

function newTestPath(language: SupportedLanguage, codePath: string): string {
  const dir = dirname(codePath);
  const p = (n: string) => (dir === "." ? n : `${dir}/${n}`);
  if (language === "python") return p("test_ma_create.py");
  if (language === "typescript") return p("ma_create.test.ts");
  return p("ma_create.test.js");
}

export async function createCreateAssessment(repo: RepoRecord, unit: LearningUnit) {
  const node = repo.graph.nodes.find((n) => n.id === unit.primary);
  if (!node) throw new Error("unit primary node not found");
  const verifier = verifierForExtension(extname(node.provenance.path));
  if (!verifier) throw new Error("Create challenges are for code units (Python/JS/TS)");

  const codePath = node.provenance.path;
  const language = verifier.language;
  const code = readFileSync(join(repo.root, codePath), "utf8");
  const testPath = newTestPath(language, codePath);
  const base = await baseline(repo, language);

  let mode: "spec" | "open" = "open";
  let hiddenTest: string | undefined;
  let feature: string | undefined;

  if (llm) {
    try {
      const spec = await generateCreateSpec({
        moduleName: basename(codePath),
        language,
        importHint: importHint(language, codePath),
        source: code,
        provider: llm,
      });
      // The acceptance test must FAIL on current code (feature absent) to be valid.
      const { runner } = await getRunner(language);
      const probe = await runner.run(repo.root, { edits: [{ path: testPath, content: spec.test }] });
      if (parseTestCounts(probe.raw).failed > 0) {
        mode = "spec";
        hiddenTest = spec.test;
        feature = spec.feature;
      }
    } catch {
      /* fall back to open mode */
    }
  }

  const id = randomUUID();
  creates.set(id, {
    id,
    repoId: repo.id,
    unitId: unit.id,
    mode,
    language,
    codePath,
    testPath,
    hiddenTest,
    baseTotal: base.total,
    basePassed: base.passed,
  });

  return {
    id,
    unitId: unit.id,
    targetLevel: BloomLevel.Create,
    mode,
    language,
    prompt:
      mode === "spec"
        ? `Implement this new feature so the hidden acceptance test passes: ${feature}`
        : OPEN_CREATE_PROMPT,
    feature,
    codePath,
    code, // starter: current file content
    testPath,
    testStarter: mode === "open" ? "" : undefined,
  };
}

export async function submitCreateAttempt(
  repo: RepoRecord,
  userId: string,
  assessmentId: string,
  code: string,
  test?: string,
) {
  const a = creates.get(assessmentId);
  if (!a || a.repoId !== repo.id) throw new Error("assessment not found");

  const edits = [{ path: a.codePath, content: code }];
  if (a.mode === "spec") edits.push({ path: a.testPath, content: a.hiddenTest! });
  else edits.push({ path: a.testPath, content: test ?? "" });

  const { runner } = await getRunner(a.language);
  const result = await runner.run(repo.root, { edits });
  const counts = parseTestCounts(result.raw);
  const grade = gradeOpenCreate({ passed: a.basePassed, total: a.baseTotal }, counts);

  const key = stateKey(userId, repo.root, a.unitId);
  const prev = states.get(key) ?? emptyState(userId, a.unitId);
  const next = recordAttempt(prev, {
    assessmentId,
    targetLevel: BloomLevel.Create,
    passed: grade.passed,
    verifier: "tests",
    at: new Date().toISOString(),
  });
  setState(userId, repo.root, next);

  return { passed: grade.passed, reason: grade.reason, summary: result.summary, raw: result.raw, state: next };
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
      nextReviewAt: s?.nextReviewAt,
    };
  });
}

/** Spaced-repetition queue: mastered units whose review is due at time `at` (ms). */
export function reviewsFor(userId: string, repo: RepoRecord, at: number = Date.now()) {
  const due = [];
  for (const u of repo.path.units) {
    const s = states.get(stateKey(userId, repo.root, u.id));
    if (s && isDue(s, at)) {
      due.push({
        unitId: u.id,
        title: u.title,
        level: s.level,
        nextReviewAt: s.nextReviewAt,
        overdueMs: at - new Date(s.nextReviewAt!).getTime(),
      });
    }
  }
  due.sort((a, b) => b.overdueMs - a.overdueMs);
  return due;
}
