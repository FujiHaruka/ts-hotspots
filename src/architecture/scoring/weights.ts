/**
 * Default composite weights per smell type. Every weight table sums
 * to ~1.0 so the composite score lives in `[0, 1]`. Mirrors the
 * "Default composite weights" section of
 * `docs/plans/architecture-subcommand.md`.
 *
 * Weights are exported as plain readonly records so M7's downweight
 * config block can override individual axes without editing this
 * file (the loader merges over the defaults).
 */

import type { AxisId, SmellType } from "../ranking/types.ts";

export type SmellWeights = Readonly<Partial<Record<AxisId, number>>>;
export type WeightsTable = Readonly<Record<SmellType, SmellWeights>>;

export const DEFAULT_WEIGHTS: WeightsTable = {
  architectural_hub: {
    fan_in_pct: 0.4,
    fan_out_pct: 0.3,
    reverse_closure_pct: 0.3,
  },
  high_fanout_component: {
    fan_out_pct: 1.0,
  },
  high_impact_component: {
    fan_in_pct: 0.5,
    reverse_closure_pct: 0.4,
    pagerank_pct: 0.1,
  },
  bridge_component: {
    betweenness_pct: 1.0,
  },
  unstable_dependency_candidate: {
    unstable_edge_flag: 0.6,
    instability_delta_pct: 0.4,
  },
  over_shared_component: {
    fan_in_pct: 0.4,
    fan_out_pct: 0.3,
    suppress_flag: 0.3,
  },
};
