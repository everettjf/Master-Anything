/**
 * Mastery engine (P0.2): domain-agnostic learner state + Bloom transitions.
 * See docs/ARCHITECTURE.md §4 and docs/P0-CODE-MVP.md §3-4.
 */
import { BloomLevel } from "./types.js";

export interface AttemptRecord {
  assessmentId: string;
  targetLevel: BloomLevel;
  passed: boolean;
  verifier: "tests" | "graph" | "llm";
  at: string; // ISO timestamp
}

export interface LearnerUnitState {
  userId: string;
  unitId: string;
  level: BloomLevel; // highest level reached
  confidence: number; // 0..1
  attempts: AttemptRecord[];
  lastReviewedAt?: string;
  nextReviewAt?: string;
}

export function emptyState(userId: string, unitId: string): LearnerUnitState {
  return { userId, unitId, level: BloomLevel.None, confidence: 0, attempts: [] };
}

// Spaced-repetition spacing per reached level (hours), simple P0 schedule.
const REVIEW_HOURS: Record<number, number> = { 1: 12, 2: 24, 3: 72, 4: 168, 5: 336 };

/**
 * Apply an attempt to a learner's unit state.
 * Passing an assessment targeting level L promotes the learner to at least L;
 * failing nudges confidence down without demoting a previously reached level.
 */
export function recordAttempt(
  state: LearnerUnitState,
  attempt: AttemptRecord,
): LearnerUnitState {
  const attempts = [...state.attempts, attempt];
  let level = state.level;
  let confidence = state.confidence;

  if (attempt.passed) {
    level = Math.max(level, attempt.targetLevel);
    confidence = Math.min(1, confidence + 0.34);
  } else {
    confidence = Math.max(0, confidence - 0.2);
  }

  const now = attempt.at;
  const hours = REVIEW_HOURS[level] ?? 0;
  const nextReviewAt =
    hours > 0 ? new Date(new Date(now).getTime() + hours * 3600_000).toISOString() : undefined;

  return { ...state, attempts, level, confidence, lastReviewedAt: now, nextReviewAt };
}

export function bloomName(level: BloomLevel): string {
  return (
    ["None", "Remember", "Understand", "Apply", "Analyze", "Create"][level] ?? String(level)
  );
}
