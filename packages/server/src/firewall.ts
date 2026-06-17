/**
 * Behavioral Firewall server glue (thrust: verify AI edits to untested code).
 *
 * Wraps @ma/verifier's snapshot/verify for the HTTP API: snapshot a repo file's
 * behavior (kept in memory, keyed by path), then verify a candidate edit against
 * it and return the behavioral diff. Snapshots hold golden values server-side;
 * the snapshot response only exposes symbol names + case counts (and the current
 * file source, so the UI can prefill a candidate to edit).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import {
  type BehaviorDiff,
  type BehaviorSnapshot,
  snapshotFile,
  verifierForExtension,
  verifyAgainstSnapshot,
} from "@ma/verifier";
import type { RepoRecord } from "./store.js";

const snapshots = new Map<string, { repoId: string; snapshot: BehaviorSnapshot }>();
const latestByPath = new Map<string, string>(); // `${repoId}:${path}` -> snapshot id

function languageOf(path: string) {
  const v = verifierForExtension(extname(path));
  if (!v) throw new Error(`Firewall supports Python / JS / TS, not ${extname(path) || path}`);
  return v.language;
}

export interface SnapshotSummary {
  id: string;
  file: string;
  language: string;
  source: string;
  totalCases: number;
  symbols: { symbol: string; cases: number }[];
}

export async function snapshotForRepo(
  repo: RepoRecord,
  path: string,
  entrypoint?: string,
): Promise<SnapshotSummary> {
  const language = languageOf(path);
  const source = readFileSync(join(repo.root, path), "utf8");
  const snap = await snapshotFile({ repoRoot: repo.root, file: path, language, entrypoint });
  if (!snap || snap.symbols.length === 0) {
    throw new Error(
      "Nothing to snapshot — no deterministic, literal-returning functions found in this file.",
    );
  }
  const id = randomUUID();
  snapshots.set(id, { repoId: repo.id, snapshot: snap });
  latestByPath.set(`${repo.id}:${path}`, id);
  return {
    id,
    file: path,
    language,
    source,
    totalCases: snap.symbols.reduce((n, s) => n + s.cases.length, 0),
    symbols: snap.symbols.map((s) => ({ symbol: s.symbol, cases: s.cases.length })),
  };
}

export async function verifyForRepo(
  repo: RepoRecord,
  opts: { path: string; candidate?: string; snapshotId?: string },
): Promise<BehaviorDiff> {
  const id = opts.snapshotId ?? latestByPath.get(`${repo.id}:${opts.path}`);
  const stored = id ? snapshots.get(id) : undefined;
  if (!stored || stored.repoId !== repo.id) {
    throw new Error("No snapshot for this file yet — snapshot it first.");
  }
  const language = languageOf(opts.path);
  const candidate = opts.candidate ?? readFileSync(join(repo.root, opts.path), "utf8");
  return verifyAgainstSnapshot({
    repoRoot: repo.root,
    file: opts.path,
    language,
    snapshot: stored.snapshot,
    candidate,
  });
}
