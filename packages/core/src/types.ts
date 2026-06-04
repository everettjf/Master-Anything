/**
 * Universal Knowledge Graph schema (P0: code domain).
 * See docs/P0-CODE-MVP.md §2.
 */

export enum BloomLevel {
  None = 0,
  Remember = 1,
  Understand = 2,
  Apply = 3,
  Analyze = 4,
  Create = 5,
}

export type NodeKind =
  | "file"
  | "class"
  | "function"
  | "unit"
  // docs domain (P1)
  | "document"
  | "section";

export type EdgeType = "contains" | "imports" | "depends-on" | "calls" | "refers-to";

export interface Provenance {
  path: string; // repo-relative file path
  startLine: number; // 1-based, inclusive
  endLine: number; // 1-based, inclusive
  commit?: string; // commit SHA the graph is bound to
}

export interface KnowledgeNode {
  id: string;
  kind: NodeKind;
  name: string;
  signature?: string;
  provenance: Provenance;
  /** Filled by the LLM enrichment stage (P0.1); empty in the walking skeleton. */
  summary?: string;
  role?: string;
  domain?: string;
  /** Extracted body text for non-code nodes (doc sections, PDF pages), used for
   *  retrieval and grounding when there's no readable source slice on disk. */
  text?: string;
  prerequisites: string[]; // prerequisite node ids
  bloomCeiling: BloomLevel;
}

export interface KnowledgeEdge {
  from: string;
  to: string;
  type: EdgeType;
  weight: number;
}

export interface KnowledgeGraph {
  /** Schema version, so persisted artifacts can be migrated later. */
  version: 1;
  repo: {
    root: string;
    commit?: string;
    builtAt: string; // ISO timestamp
  };
  stats: {
    files: number;
    nodes: number;
    edges: number;
    languages: Record<string, number>;
  };
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}
