/**
 * Master-Anything API (P0.0).
 * Endpoints: connect a repo, fetch its knowledge graph, read node source.
 */
import { readFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { answerQuestion } from "@ma/core";
import { addRepo, embedDescribe, getRepo, listRepos, llm, llmDescribe } from "./store.js";
import {
  createApplyAssessment,
  createExplainAssessment,
  createImpactAssessment,
  masteryFor,
  runnerDescribe,
  submitAttempt,
  submitExplainAttempt,
  submitImpactAttempt,
} from "./mastery-store.js";

const app = new Hono();
app.use("/*", cors());

app.get("/health", (c) => c.json({ ok: true }));

// Connect a repo by local path -> build graph.
app.post("/repos", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const path = typeof body.path === "string" ? body.path : "";
  if (!path) return c.json({ error: "missing 'path'" }, 400);
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    return c.json({ error: `not a directory: ${path}` }, 400);
  }
  const kind = body.kind === "docs" || body.kind === "code" ? body.kind : undefined;
  try {
    const repo = await addRepo(path, kind);
    return c.json({
      id: repo.id,
      root: repo.root,
      kind: repo.kind,
      stats: { ...repo.graph.stats, units: repo.units.size },
      createdAt: repo.createdAt,
    });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

app.get("/repos", (c) =>
  c.json(
    listRepos().map((r) => ({ id: r.id, root: r.root, stats: r.graph.stats, createdAt: r.createdAt })),
  ),
);

app.get("/repos/:id/graph", (c) => {
  const repo = getRepo(c.req.param("id"));
  if (!repo) return c.json({ error: "repo not found" }, 404);
  return c.json(repo.graph);
});

// Dependency-ordered learning path (units, prerequisites first).
app.get("/repos/:id/path", (c) => {
  const repo = getRepo(c.req.param("id"));
  if (!repo) return c.json({ error: "repo not found" }, 404);
  return c.json({
    cycles: repo.path.cycles,
    units: repo.path.units.map((u) => ({
      id: u.id,
      title: u.title,
      kind: u.kind,
      summary: u.summary,
      provenance: u.provenance,
      prerequisites: u.prerequisites,
      bloomCeiling: u.bloomCeiling,
    })),
  });
});

// Read the source slice a node points at (provenance-grounded UI).
app.get("/repos/:id/source", (c) => {
  const repo = getRepo(c.req.param("id"));
  if (!repo) return c.json({ error: "repo not found" }, 404);
  const nodeId = c.req.query("node");
  const node = repo.graph.nodes.find((n) => n.id === nodeId);
  if (!node) return c.json({ error: "node not found" }, 404);
  try {
    const abs = join(repo.root, node.provenance.path);
    const lines = readFileSync(abs, "utf8").split("\n");
    const slice = lines.slice(node.provenance.startLine - 1, node.provenance.endLine);
    return c.json({
      path: node.provenance.path,
      startLine: node.provenance.startLine,
      endLine: node.provenance.endLine,
      code: slice.join("\n"),
    });
  } catch (err) {
    return c.json({ error: String(err) }, 500);
  }
});

// Generate an Apply (break-and-fix) assessment for a unit.
app.post("/repos/:id/units/:unitId/assessment", async (c) => {
  const repo = getRepo(c.req.param("id"));
  if (!repo) return c.json({ error: "repo not found" }, 404);
  const unit = repo.units.get(c.req.param("unitId"));
  if (!unit) return c.json({ error: "unit not found" }, 404);
  try {
    return c.json(await createApplyAssessment(repo, unit));
  } catch (err) {
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
  }
});

// Submit a solution -> run real tests -> update mastery.
app.post("/repos/:id/attempts", async (c) => {
  const repo = getRepo(c.req.param("id"));
  if (!repo) return c.json({ error: "repo not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const { userId, assessmentId, submission } = body as {
    userId?: string;
    assessmentId?: string;
    submission?: string;
  };
  if (!assessmentId || typeof submission !== "string") {
    return c.json({ error: "missing 'assessmentId' or 'submission'" }, 400);
  }
  try {
    return c.json(await submitAttempt(repo, userId || "anon", assessmentId, submission));
  } catch (err) {
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
  }
});

// Tutor: graph-grounded Q&A with path:line citations (GraphRAG).
app.post("/repos/:id/ask", async (c) => {
  const repo = getRepo(c.req.param("id"));
  if (!repo) return c.json({ error: "repo not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) return c.json({ error: "missing 'query'" }, 400);
  try {
    return c.json(await answerQuestion(repo.graph, query, llm, { index: repo.index }));
  } catch (err) {
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 500);
  }
});

// Understand level: tutor asks a comprehension question about a unit.
app.post("/repos/:id/units/:unitId/explain", async (c) => {
  const repo = getRepo(c.req.param("id"));
  if (!repo) return c.json({ error: "repo not found" }, 404);
  const unit = repo.units.get(c.req.param("unitId"));
  if (!unit) return c.json({ error: "unit not found" }, 404);
  try {
    return c.json(await createExplainAssessment(repo, unit));
  } catch (err) {
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
  }
});

// Submit a prose answer -> LLM grades against source -> mastery to Understand.
app.post("/repos/:id/explain-attempts", async (c) => {
  const repo = getRepo(c.req.param("id"));
  if (!repo) return c.json({ error: "repo not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const { userId, assessmentId, answer } = body as {
    userId?: string;
    assessmentId?: string;
    answer?: string;
  };
  if (!assessmentId || typeof answer !== "string") {
    return c.json({ error: "missing 'assessmentId' or 'answer'" }, 400);
  }
  try {
    return c.json(await submitExplainAttempt(repo, userId || "anon", assessmentId, answer));
  } catch (err) {
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
  }
});

// Analyze level: generate a graph-verified impact question for a unit.
app.post("/repos/:id/units/:unitId/analyze", (c) => {
  const repo = getRepo(c.req.param("id"));
  if (!repo) return c.json({ error: "repo not found" }, 404);
  const unit = repo.units.get(c.req.param("unitId"));
  if (!unit) return c.json({ error: "unit not found" }, 404);
  try {
    return c.json(createImpactAssessment(repo, unit));
  } catch (err) {
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
  }
});

// Submit an impact answer -> graded against the graph -> mastery to Analyze.
app.post("/repos/:id/analyze-attempts", async (c) => {
  const repo = getRepo(c.req.param("id"));
  if (!repo) return c.json({ error: "repo not found" }, 404);
  const body = await c.req.json().catch(() => ({}));
  const { userId, assessmentId, selectedIds } = body as {
    userId?: string;
    assessmentId?: string;
    selectedIds?: string[];
  };
  if (!assessmentId || !Array.isArray(selectedIds)) {
    return c.json({ error: "missing 'assessmentId' or 'selectedIds'" }, 400);
  }
  try {
    return c.json(submitImpactAttempt(repo, userId || "anon", assessmentId, selectedIds));
  } catch (err) {
    return c.json({ error: String(err instanceof Error ? err.message : err) }, 400);
  }
});

// Mastery dashboard for a learner across the repo's units.
app.get("/repos/:id/mastery", (c) => {
  const repo = getRepo(c.req.param("id"));
  if (!repo) return c.json({ error: "repo not found" }, 404);
  const userId = c.req.query("user") || "anon";
  return c.json({ userId, units: masteryFor(userId, repo) });
});

const port = Number(process.env.PORT ?? 8787);
serve({ fetch: app.fetch, port }, (info) => {
  console.log(`@ma/server listening on http://localhost:${info.port}`);
  console.log(`  LLM enrichment: ${llmDescribe}`);
  console.log(`  Embeddings:     ${embedDescribe}`);
  runnerDescribe().then((d) => console.log(`  Test sandbox:   ${d}`));
});
