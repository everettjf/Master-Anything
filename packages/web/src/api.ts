/** Thin client for the @ma/server API (proxied at /api in dev). */

export interface GraphStats {
  files: number;
  nodes: number;
  edges: number;
  languages: Record<string, number>;
}

export interface RepoSummary {
  id: string;
  root: string;
  kind: "code" | "docs" | "pdf" | "mixed";
  stats: GraphStats;
  createdAt: string;
}

export interface GraphNode {
  id: string;
  kind: "file" | "class" | "function" | "unit" | "document" | "section";
  name: string;
  signature?: string;
  provenance: { path: string; startLine: number; endLine: number };
  bloomCeiling: number;
  layer?: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  type: "contains" | "imports" | "depends-on" | "calls";
  weight: number;
}

export interface KnowledgeGraph {
  stats: GraphStats;
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface SourceSlice {
  path: string;
  startLine: number;
  endLine: number;
  code: string;
}

const BASE = "/api";

async function jsonOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function connectRepo(path: string): Promise<RepoSummary> {
  const res = await fetch(`${BASE}/repos`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path }),
  });
  return jsonOrThrow<RepoSummary>(res);
}

export async function fetchGraph(id: string): Promise<KnowledgeGraph> {
  return jsonOrThrow<KnowledgeGraph>(await fetch(`${BASE}/repos/${id}/graph`));
}

export async function fetchSource(id: string, nodeId: string): Promise<SourceSlice> {
  return jsonOrThrow<SourceSlice>(
    await fetch(`${BASE}/repos/${id}/source?node=${encodeURIComponent(nodeId)}`),
  );
}

export interface PathUnit {
  id: string;
  title: string;
  kind: "function" | "class" | "section";
  summary?: string;
  provenance: { path: string; startLine: number; endLine: number };
  prerequisites: string[];
  bloomCeiling: number;
  layer?: number;
  band?: string;
  module?: string;
}

export async function fetchPath(id: string): Promise<{ cycles: number; units: PathUnit[] }> {
  return jsonOrThrow(await fetch(`${BASE}/repos/${id}/path`));
}

export interface WikiPage {
  unitId: string;
  slug: string;
  title: string;
  markdown: string;
}

export async function fetchWiki(id: string): Promise<{ index: string; pages: WikiPage[] }> {
  return jsonOrThrow(await fetch(`${BASE}/repos/${id}/wiki`));
}

export async function exportWiki(id: string): Promise<{ dir: string; files: number }> {
  return jsonOrThrow(await fetch(`${BASE}/repos/${id}/wiki/export`, { method: "POST" }));
}

export interface TourStep {
  unitId: string;
  title: string;
  kind: string;
  ref: string;
  buildsOn: string[];
  usedBy: string[];
}

export async function fetchTour(id: string): Promise<{ steps: TourStep[] }> {
  return jsonOrThrow(await fetch(`${BASE}/repos/${id}/tour`));
}

export async function narrateTourStep(id: string, unitId: string): Promise<{ narration: string }> {
  return jsonOrThrow(
    await fetch(`${BASE}/repos/${id}/tour/${encodeURIComponent(unitId)}/narrate`, { method: "POST" }),
  );
}

export interface LayerBand {
  band: string;
  layer: number;
  units: { id: string; title: string; kind: string; module?: string; layer: number }[];
}

export async function fetchLayers(id: string): Promise<{ bands: LayerBand[] }> {
  return jsonOrThrow(await fetch(`${BASE}/repos/${id}/layers`));
}

export interface MasteryUnit {
  unitId: string;
  title: string;
  kind: string;
  bloomCeiling: number;
  level: number;
  confidence: number;
  attempts: number;
}

export async function fetchMastery(id: string, user: string): Promise<{ units: MasteryUnit[] }> {
  return jsonOrThrow(await fetch(`${BASE}/repos/${id}/mastery?user=${encodeURIComponent(user)}`));
}

export interface ReviewItem {
  unitId: string;
  title: string;
  level: number;
  nextReviewAt?: string;
  overdueMs: number;
}

export async function fetchReviews(id: string, user: string): Promise<{ at: string; due: ReviewItem[] }> {
  return jsonOrThrow(await fetch(`${BASE}/repos/${id}/reviews?user=${encodeURIComponent(user)}`));
}

export interface Assessment {
  id: string;
  unitId: string;
  kind: string;
  language: string;
  targetLevel: number;
  path: string;
  startLine: number;
  endLine: number;
  prompt: string;
  brokenFunction: string;
  verifiable: boolean;
  note?: string;
}

export async function createAssessment(id: string, unitId: string): Promise<Assessment> {
  return jsonOrThrow(
    await fetch(`${BASE}/repos/${id}/units/${encodeURIComponent(unitId)}/assessment`, {
      method: "POST",
    }),
  );
}

export interface AttemptResult {
  passed: boolean;
  verifiable: boolean;
  summary: string;
  raw: string;
  durationMs: number;
  state: { level: number; confidence: number; attempts: unknown[] };
}

export async function submitAttempt(
  id: string,
  userId: string,
  assessmentId: string,
  submission: string,
): Promise<AttemptResult> {
  return jsonOrThrow(
    await fetch(`${BASE}/repos/${id}/attempts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, assessmentId, submission }),
    }),
  );
}

// --- Tutor (GraphRAG) ---

export interface Citation {
  id: string;
  name: string;
  ref: string;
  summary?: string;
}

export interface TutorAnswer {
  answer: string;
  citations: Citation[];
  grounded: boolean;
  conversationId: string;
}

export async function ask(
  id: string,
  query: string,
  conversationId?: string,
): Promise<TutorAnswer> {
  return jsonOrThrow(
    await fetch(`${BASE}/repos/${id}/ask`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query, conversationId }),
    }),
  );
}

// --- Understand (LLM question + source-grounded grading) ---

export interface ExplainQuestion {
  id: string;
  unitId: string;
  targetLevel: number;
  question: string;
}

export async function createExplain(id: string, unitId: string): Promise<ExplainQuestion> {
  return jsonOrThrow(
    await fetch(`${BASE}/repos/${id}/units/${encodeURIComponent(unitId)}/explain`, {
      method: "POST",
    }),
  );
}

export interface ExplainResult {
  passed: boolean;
  score: number;
  feedback: string;
  state: { level: number };
}

export async function submitExplain(
  id: string,
  userId: string,
  assessmentId: string,
  answer: string,
): Promise<ExplainResult> {
  return jsonOrThrow(
    await fetch(`${BASE}/repos/${id}/explain-attempts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, assessmentId, answer }),
    }),
  );
}

// --- Create (extend the codebase, verified by real tests) ---

export interface CreateAssessment {
  id: string;
  unitId: string;
  mode: "spec" | "open";
  language: string;
  targetLevel: number;
  prompt: string;
  feature?: string;
  codePath: string;
  code: string;
  testPath: string;
}

export async function createCreate(id: string, unitId: string): Promise<CreateAssessment> {
  return jsonOrThrow(
    await fetch(`${BASE}/repos/${id}/units/${encodeURIComponent(unitId)}/create`, { method: "POST" }),
  );
}

export interface CreateResult {
  passed: boolean;
  reason: string;
  summary: string;
  raw: string;
  state: { level: number };
}

export async function submitCreate(
  id: string,
  userId: string,
  assessmentId: string,
  code: string,
  test: string,
): Promise<CreateResult> {
  return jsonOrThrow(
    await fetch(`${BASE}/repos/${id}/create-attempts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, assessmentId, code, test }),
    }),
  );
}

// --- Analyze (graph-verified impact) ---

export interface ImpactQuestion {
  id: string;
  unitId: string;
  targetLevel: number;
  prompt: string;
  options: { unitId: string; title: string }[];
}

export async function createImpact(id: string, unitId: string): Promise<ImpactQuestion> {
  return jsonOrThrow(
    await fetch(`${BASE}/repos/${id}/units/${encodeURIComponent(unitId)}/analyze`, {
      method: "POST",
    }),
  );
}

export interface ImpactResult {
  passed: boolean;
  correctIds: string[];
  missedIds: string[];
  wrongIds: string[];
  state: { level: number };
}

export async function submitImpact(
  id: string,
  userId: string,
  assessmentId: string,
  selectedIds: string[],
): Promise<ImpactResult> {
  return jsonOrThrow(
    await fetch(`${BASE}/repos/${id}/analyze-attempts`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId, assessmentId, selectedIds }),
    }),
  );
}
