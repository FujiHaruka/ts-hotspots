/**
 * Shared types for ranking + scoring.
 *
 * `AxisId` enumerates every input axis that any smell weight table can
 * reference. `SmellType` enumerates the v1 smell catalogue.
 *
 * Each axis is either:
 *  - **percentile** — backed by a numeric distribution; ranking
 *    produces `(percentile, rank, zScore)`.
 *  - **flag** — backed by a binary 0/1 signal; the value passes
 *    through into the composite directly.
 *
 * `AXIS_KIND[axisId]` distinguishes the two so the scoring composer
 * can pick the right contribution shape.
 */

export type SmellType =
  | "architectural_hub"
  | "high_fanout_component"
  | "high_impact_component"
  | "bridge_component"
  | "unstable_dependency_candidate"
  | "over_shared_component";

export const SMELL_TYPES: readonly SmellType[] = [
  "architectural_hub",
  "high_fanout_component",
  "high_impact_component",
  "bridge_component",
  "unstable_dependency_candidate",
  "over_shared_component",
];

export type AxisId =
  | "fan_in_pct"
  | "fan_out_pct"
  | "reverse_closure_pct"
  | "pagerank_pct"
  | "betweenness_pct"
  | "instability_delta_pct"
  | "unstable_edge_ratio_pct"
  | "size_pct"
  | "suppress_flag";

export type AxisKind = "percentile" | "flag";

export const AXIS_KIND: Readonly<Record<AxisId, AxisKind>> = {
  fan_in_pct: "percentile",
  fan_out_pct: "percentile",
  reverse_closure_pct: "percentile",
  pagerank_pct: "percentile",
  betweenness_pct: "percentile",
  instability_delta_pct: "percentile",
  unstable_edge_ratio_pct: "percentile",
  size_pct: "percentile",
  suppress_flag: "flag",
};
