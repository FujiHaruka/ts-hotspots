/**
 * Identify components whose declaration line span is too small to be
 * an architectural refactor target. The candidate ranking drops them,
 * but the dependency graph and per-axis percentile distributions stay
 * untouched — same "exclude from output, keep in population" semantic
 * as `collectTypeOnlyNodeIds`.
 *
 * Rationale: percentile rank is computed over the full export
 * population, so a 5-line utility with fan-in 3 can land at the 90th
 * percentile in a codebase whose median export is a one-line const.
 * The math is correct; pointing the agent there is not. A hard floor
 * filters this noise without changing the percentile axes' shape.
 *
 * Pure function over the shape `{ id, lineCount }`; no I/O.
 */

import type { Component } from "../graph/types.ts";

export const DEFAULT_SIZE_FLOOR_LINES = 10;

export function collectSmallNodeIds(
  nodes: readonly Component[],
  floorLines: number = DEFAULT_SIZE_FLOOR_LINES,
): ReadonlySet<string> {
  const result = new Set<string>();
  if (floorLines <= 1) return result;
  for (const node of nodes) {
    const lineCount = node.endLine - node.line + 1;
    if (lineCount < floorLines) result.add(node.id);
  }
  return result;
}

export function buildLineCounts(
  nodes: readonly Component[],
): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const node of nodes) {
    counts.set(node.id, node.endLine - node.line + 1);
  }
  return counts;
}
