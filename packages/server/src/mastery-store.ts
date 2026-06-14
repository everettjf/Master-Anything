/**
 * Mastery + assessment state for the P0 MVP (in-memory).
 * Generates break-and-fix Apply tasks and verifies submissions with pytest.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import {
  BloomLevel,
  buildImpactQuestion,
  emptyState,
  generateCreateSpec,
  generateExplainQuestion,
  gradeExplain,
  gradeImpact,
  gradeOpenCreate,
  type ImpactQuestion,
  inferBeliefs,
  isDue,
  type LearnerUnitState,
  type LearningUnit,
  type Observation,
  OPEN_CREATE_PROMPT,
  type Quest,
  questProgress,
  recordAttempt,
  requiredSubgraph,
  retrieve,
  recommendNext as traceRecommendNext,
  type UnitBelief,
  unitsForNodes,
} from "@ma/core";
import {
  characterize,
  makeRunner,
  parseTestCounts,
  type RunnerInfo,
  replaceLineRange,
  type SupportedLanguage,
  verifierForExtension,
} from "@ma/verifier";
import { getAllMastery, getAllQuests, putMastery, putQuest } from "./db.js";
import type { RepoRecord } from "./store.js";
import { getLlm } from "./store.js";

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
  /** How verification is achieved: an existing test, or a synthesized oracle. */
  verifiedBy: "suite" | "characterization" | "none";
  /** When verifiedBy === "characterization", the synthesized test to run alongside submissions. */
  oracleTest?: { path: string; content: string };
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

export async function createApplyAssessment(repo: RepoRecord, unit: LearningUnit): Promise<ApplyAssessment> {
  const fn = targetFunction(repo, unit);
  if (!fn) throw new Error("unit has no implementable function to practice");
  const verifier = verifierForExtension(extname(fn.provenance.path));
  if (!verifier) {
    throw new Error(`Apply tasks support Python and JavaScript; not ${extname(fn.provenance.path)}`);
  }

  const source = readFileSync(join(repo.root, fn.provenance.path), "utf8");
  const blank = verifier.blank(source, fn.provenance.startLine, fn.provenance.endLine);

  // Coverage probe: blank the function and run tests. If they fail, the existing
  // suite covers it and a fix is objectively verifiable.
  const { runner } = await getRunner(verifier.language);
  const probe = await runner.run(repo.root, {
    edits: [{ path: fn.provenance.path, content: blank.fileWithBlank }],
  });

  let verifiable = !probe.passed;
  let verifiedBy: ApplyAssessment["verifiedBy"] = verifiable ? "suite" : "none";
  let oracleTest: { path: string; content: string } | undefined;
  let note: string | undefined;

  // Thrust A — universal verification: if no existing test covers the function,
  // synthesize a characterization test (oracle = the original implementation),
  // so the function becomes verifiable without a hand-written test.
  if (!verifiable) {
    const char = await characterize({
      repoRoot: repo.root,
      file: fn.provenance.path,
      symbol: fn.name,
      language: verifier.language,
    });
    if (char) {
      // Confirm the synthesized test actually catches the blank (and isn't vacuous).
      const broke = await runner.run(repo.root, {
        edits: [
          { path: fn.provenance.path, content: blank.fileWithBlank },
          { path: char.testPath, content: char.testContent },
        ],
        targets: [char.testPath],
      });
      if (!broke.passed) {
        verifiable = true;
        verifiedBy = "characterization";
        oracleTest = { path: char.testPath, content: char.testContent };
        note = `Verified by a synthesized characterization test (${char.cases} cases captured from the original implementation as oracle).`;
      }
    }
    if (!verifiable) {
      note =
        "No test covers this function and it couldn't be auto-characterized (non-deterministic or complex inputs) — a passing submission is self-check only.";
    }
  }

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
    verifiedBy,
    oracleTest,
    note,
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
  const edits = [{ path: a.path, content: edited }];
  // Characterization-verified tasks run against the synthesized oracle test.
  if (a.oracleTest) edits.push({ path: a.oracleTest.path, content: a.oracleTest.content });
  const { runner } = await getRunner(a.language);
  const result = await runner.run(repo.root, {
    edits,
    ...(a.oracleTest ? { targets: [a.oracleTest.path] } : {}),
  });

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

  return {
    passed: grade.passed,
    correctIds: grade.correctIds,
    missedIds: grade.missedIds,
    wrongIds: grade.wrongIds,
    state: next,
  };
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
  const llm = getLlm();
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
  const llm = getLlm();
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

  const llm = getLlm();
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

  return {
    passed: grade.passed,
    reason: grade.reason,
    summary: result.summary,
    raw: result.raw,
    state: next,
  };
}

export function masteryFor(userId: string, repo: RepoRecord) {
  const beliefs = beliefsFor(userId, repo);
  return repo.path.units.map((u) => {
    const s = states.get(stateKey(userId, repo.root, u.id));
    const b = beliefs.get(u.id);
    return {
      unitId: u.id,
      title: u.title,
      kind: u.kind,
      bloomCeiling: u.bloomCeiling,
      level: s?.level ?? BloomLevel.None,
      confidence: s?.confidence ?? 0,
      attempts: s?.attempts.length ?? 0,
      nextReviewAt: s?.nextReviewAt,
      // Thrust B — graph-propagated knowledge tracing.
      belief: b?.belief ?? 0,
      readiness: b?.readiness ?? 1,
      mastered: b?.mastered ?? false,
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

// --- Knowledge tracing (thrust B): graph-propagated beliefs + adaptive next ---

/** Each unit's attempt history as tracing observations. */
function observationsFor(userId: string, repo: RepoRecord): Map<string, Observation[]> {
  const obs = new Map<string, Observation[]>();
  for (const u of repo.path.units) {
    const s = states.get(stateKey(userId, repo.root, u.id));
    obs.set(
      u.id,
      (s?.attempts ?? []).map((a) => ({
        passed: a.passed,
        verifier: a.verifier,
        targetLevel: a.targetLevel,
      })),
    );
  }
  return obs;
}

/** Belief P(mastered) for every unit, with prerequisite evidence propagated. */
export function beliefsFor(userId: string, repo: RepoRecord): Map<string, UnitBelief> {
  return inferBeliefs(repo.path.units, observationsFor(userId, repo));
}

function dueSet(userId: string, repo: RepoRecord, at: number): Set<string> {
  const due = new Set<string>();
  for (const u of repo.path.units) {
    const s = states.get(stateKey(userId, repo.root, u.id));
    if (s && isDue(s, at)) due.add(u.id);
  }
  return due;
}

/**
 * Adaptive recommendation: the next best units to practise, chosen from the
 * graph-propagated belief state (ready, not-yet-mastered, high-unlock first),
 * with due reviews floated to the top.
 */
export function recommendFor(userId: string, repo: RepoRecord, limit = 5, at: number = Date.now()) {
  const beliefs = beliefsFor(userId, repo);
  return traceRecommendNext(repo.path.units, beliefs, { due: dueSet(userId, repo, at), limit });
}

// --- Goal-anchored Quests (thrust C): a mission over a required sub-graph ------

// Quests are repo-scoped, keyed by their id; the stable repo key across restarts
// is `repo.root` (the runtime `repo.id` is regenerated each process).
const quests = new Map<string, { repoRoot: string; quest: Quest }>();

// Hydrate persisted quests from the DB on boot.
for (const { repoRoot, quest } of getAllQuests()) {
  quests.set(quest.id, { repoRoot, quest });
}

/**
 * Create a quest from a free-text goal (anchored to the best-matching unit via
 * retrieval) or an explicit target unit, then compute the required sub-graph.
 */
export function createQuest(repo: RepoRecord, opts: { goal?: string; targetUnitId?: string }): Quest {
  const units = repo.path.units;
  let targets: string[] = [];

  if (opts.targetUnitId && repo.units.has(opts.targetUnitId)) {
    targets = [opts.targetUnitId];
  } else if (opts.goal?.trim()) {
    const nodeIds = retrieve(repo.graph, opts.goal, 8).map((r) => r.node.id);
    targets = unitsForNodes(units, nodeIds).slice(0, 1);
  }
  if (targets.length === 0) {
    throw new Error("Couldn't anchor a goal to a unit — try a more specific goal or pick a unit.");
  }

  const titleOf = (id: string) => units.find((u) => u.id === id)?.title ?? id;
  const goal = opts.goal?.trim() || `Master “${titleOf(targets[0]!)}”`;
  const quest: Quest = {
    id: randomUUID(),
    goal,
    targetUnitIds: targets,
    requiredUnitIds: requiredSubgraph(units, targets),
  };
  quests.set(quest.id, { repoRoot: repo.root, quest });
  putQuest(repo.root, quest);
  return quest;
}

export function getQuestProgress(repo: RepoRecord, userId: string, questId: string, at = Date.now()) {
  const stored = quests.get(questId);
  if (!stored || stored.repoRoot !== repo.root) throw new Error("quest not found");
  const beliefs = beliefsFor(userId, repo);
  return questProgress(stored.quest, repo.path.units, beliefs, { due: dueSet(userId, repo, at) });
}

/** All quests for a repo with live progress for the given learner. */
export function listQuests(repo: RepoRecord, userId: string) {
  const out = [];
  for (const { repoRoot, quest } of quests.values()) {
    if (repoRoot === repo.root) out.push(getQuestProgress(repo, userId, quest.id));
  }
  return out;
}
