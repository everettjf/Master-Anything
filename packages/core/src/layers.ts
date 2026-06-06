/**
 * Architectural layers (system-level structure).
 *
 * A unit's layer is its depth in the dependency DAG: foundational units (no
 * prerequisites) sit at layer 0; a unit that depends on layer-0 units is layer 1,
 * and so on. This recovers a classic layered view — utilities at the bottom,
 * entry points at the top — deterministically from the graph (no LLM).
 */
import type { LearningUnit } from "./units.js";

export interface LayerInfo {
  /** unitId -> depth (0 = most foundational). */
  depth: Map<string, number>;
  maxDepth: number;
}

export function computeLayers(units: LearningUnit[]): LayerInfo {
  const byId = new Map(units.map((u) => [u.id, u]));
  const memo = new Map<string, number>();
  const visiting = new Set<string>();

  const depthOf = (id: string): number => {
    const cached = memo.get(id);
    if (cached !== undefined) return cached;
    if (visiting.has(id)) return 0; // break cycles
    visiting.add(id);
    const u = byId.get(id);
    let d = 0;
    if (u) {
      for (const p of u.prerequisites) {
        if (byId.has(p)) d = Math.max(d, depthOf(p) + 1);
      }
    }
    visiting.delete(id);
    memo.set(id, d);
    return d;
  };

  let maxDepth = 0;
  for (const u of units) maxDepth = Math.max(maxDepth, depthOf(u.id));
  return { depth: memo, maxDepth };
}

/** Human band label for a depth, scaled to the graph's maximum depth. */
export function bandName(depth: number, maxDepth: number): string {
  if (maxDepth <= 0) return "Core";
  const names4 = ["Foundation", "Core", "Application", "Interface"];
  const names3 = ["Foundation", "Core", "Interface"];
  const names2 = ["Foundation", "Interface"];
  const table = maxDepth >= 3 ? names4 : maxDepth === 2 ? names3 : names2;
  const idx = Math.round((depth / maxDepth) * (table.length - 1));
  return table[Math.min(idx, table.length - 1)]!;
}

/** Top-level module/area for a repo-relative path (for grouping by area). */
export function moduleOf(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts[0]! : "(root)";
}
