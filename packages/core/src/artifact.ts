/**
 * Persistable repo artifact (vision: "commit the graph once, teammates skip the
 * pipeline"). A built graph + learning units + path, serialized to JSON so a
 * reconnect can load instead of re-running tree-sitter/LLM.
 */
import type { KnowledgeGraph } from "./types.js";
import type { LearningUnit } from "./units.js";

export interface RepoArtifact {
  version: 1;
  kind: string; // "code" | "docs"
  builtAt: string;
  commit?: string;
  graph: KnowledgeGraph;
  /** Learning units in recommended (dependency-ordered) learning order. */
  units: LearningUnit[];
  cycles: number;
}

export function serializeArtifact(a: RepoArtifact): string {
  return JSON.stringify(a, null, 2);
}

export function parseArtifact(json: string): RepoArtifact {
  const a = JSON.parse(json) as RepoArtifact;
  if (a.version !== 1) throw new Error(`unsupported artifact version: ${a.version}`);
  if (!a.graph || !Array.isArray(a.units)) throw new Error("malformed artifact");
  return a;
}
