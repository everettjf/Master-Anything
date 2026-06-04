/**
 * SQLite persistence (better-sqlite3) — durable, queryable store replacing the
 * in-memory/JSON state. Two tables:
 *   repos   : root -> serialized RepoArtifact (the knowledge graph + units)
 *   mastery : (user, repo_root, unit_id) -> Bloom level + attempts
 *
 * DB path: MA_DB, else <MA_DATA_DIR or ./.ma-data>/master-anything.db
 */
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import type { LearnerUnitState } from "@ma/core";

function dbPath(): string {
  if (process.env.MA_DB) return process.env.MA_DB;
  const dir = process.env.MA_DATA_DIR ?? join(process.cwd(), ".ma-data");
  return join(dir, "master-anything.db");
}

const file = dbPath();
mkdirSync(dirname(file), { recursive: true });

const db = new Database(file);
db.pragma("journal_mode = WAL");
db.exec(`
  CREATE TABLE IF NOT EXISTS repos (
    root       TEXT PRIMARY KEY,
    kind       TEXT NOT NULL,
    commit_sha TEXT,
    artifact   TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS mastery (
    user       TEXT NOT NULL,
    repo_root  TEXT NOT NULL,
    unit_id    TEXT NOT NULL,
    level      INTEGER NOT NULL,
    confidence REAL NOT NULL,
    state      TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (user, repo_root, unit_id)
  );
`);

// --- repo artifacts ---

const upsertRepo = db.prepare(
  `INSERT INTO repos (root, kind, commit_sha, artifact, updated_at)
   VALUES (@root, @kind, @commit_sha, @artifact, @updated_at)
   ON CONFLICT(root) DO UPDATE SET
     kind=@kind, commit_sha=@commit_sha, artifact=@artifact, updated_at=@updated_at`,
);
const selectRepo = db.prepare(`SELECT artifact FROM repos WHERE root = ?`);

export function putRepoArtifact(root: string, kind: string, commit: string | undefined, artifactJson: string): void {
  upsertRepo.run({ root, kind, commit_sha: commit ?? null, artifact: artifactJson, updated_at: new Date().toISOString() });
}

export function getRepoArtifact(root: string): string | undefined {
  return (selectRepo.get(root) as { artifact: string } | undefined)?.artifact;
}

// --- mastery ---

const upsertMastery = db.prepare(
  `INSERT INTO mastery (user, repo_root, unit_id, level, confidence, state, updated_at)
   VALUES (@user, @repo_root, @unit_id, @level, @confidence, @state, @updated_at)
   ON CONFLICT(user, repo_root, unit_id) DO UPDATE SET
     level=@level, confidence=@confidence, state=@state, updated_at=@updated_at`,
);
const selectAllMastery = db.prepare(`SELECT user, repo_root, unit_id, state FROM mastery`);

export function putMastery(user: string, repoRoot: string, state: LearnerUnitState): void {
  upsertMastery.run({
    user,
    repo_root: repoRoot,
    unit_id: state.unitId,
    level: state.level,
    confidence: state.confidence,
    state: JSON.stringify(state),
    updated_at: new Date().toISOString(),
  });
}

export function getAllMastery(): { user: string; repoRoot: string; state: LearnerUnitState }[] {
  return (selectAllMastery.all() as { user: string; repo_root: string; state: string }[]).map((r) => ({
    user: r.user,
    repoRoot: r.repo_root,
    state: JSON.parse(r.state) as LearnerUnitState,
  }));
}
