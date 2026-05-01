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

/**
 * Per-axis raw noise floor. Raw values at or below this floor contribute
 * `0` to the composite (same shape as the raw-zero short-circuit) — they
 * are treated as "no signal" regardless of where they sit in the
 * percentile distribution. The default is `0`, so axes preserve the
 * existing zero-only short-circuit unless they opt in.
 *
 * `instability_delta_pct: 0.05` — Robert C. Martin's instability is a
 * ratio in `[0, 1]`; a delta below 5 pp between source and target
 * instability is below the structural resolution of "this dependency
 * violates SDP in any meaningful way". Without the floor, a sparse
 * population of small positive deltas inflates the percentile of the
 * smallest non-zero (e.g. `0.024 → 0.99`), which combined with a high
 * `unstable_edge_ratio_pct` would still clear the threshold.
 */
export const AXIS_NOISE_FLOOR: Readonly<Record<AxisId, number>> = {
  fan_in_pct: 0,
  fan_out_pct: 0,
  reverse_closure_pct: 0,
  pagerank_pct: 0,
  betweenness_pct: 0,
  instability_delta_pct: 0.05,
  unstable_edge_ratio_pct: 0,
  size_pct: 0,
  suppress_flag: 0,
};
