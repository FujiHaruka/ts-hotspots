/**
 * Score every node against every smell type, then aggregate to one
 * candidate per node with primary + up-to-two-secondary smells.
 *
 * Inputs:
 *  - `metrics`: M2/M3 output, keyed by component id.
 *  - `options.weights`: per-smell weight overrides merged over
 *    `DEFAULT_WEIGHTS`.
 *  - threshold + small-N parameters from the requirements doc:
 *    `percentileThreshold = 0.85`, `zScoreFloor = 1.5`,
 *    `smallNCutoff = 100`.
 *
 * Algorithm:
 *  1. Build per-axis percentile distributions across all nodes.
 *  2. For every (node, smell) pair, compute the weighted composite
 *     and the per-axis contributions.
 *  3. Apply the gate: composite ≥ threshold (and, for small graphs,
 *     at least one input axis must clear `zScoreFloor`).
 *  4. Aggregate per node: pick the highest-composite passing smell as
 *     primary, the next two passing smells as secondary.
 *  5. Sort candidates by primary composite descending; ties broken by
 *     node id (lexicographic) so the order is deterministic.
 *
 * Recall over precision: when no node clears the gate the result is
 * the empty array, matching the requirements doc's "healthy small
 * repos report none".
 */

import type { MetricsRecord, NodeMetrics } from "../metrics/types.ts";
import { buildPercentileLookup } from "../ranking/percentiles.ts";
import {
  AXIS_KIND,
  AXIS_NOISE_FLOOR,
  type AxisId,
  SMELL_TYPES,
  type SmellType,
} from "../ranking/types.ts";
import { DEFAULT_WEIGHTS, type WeightsTable } from "./weights.ts";

export interface ContributingMetric {
  readonly axis: AxisId;
  readonly weight: number;
  readonly value: number;
  readonly percentile: number;
  /** 1-based rank from the top (`1` = highest). `0` for flag axes. */
  readonly rank: number;
  /** `percentile - threshold`. `0` for flag axes. */
  readonly thresholdDelta: number;
  /** Z-score against the per-axis distribution. `0` for flag axes. */
  readonly zScore: number;
}

export interface SmellHit {
  readonly smellType: SmellType;
  readonly composite: number;
  readonly contributing: readonly ContributingMetric[];
}

export interface ArchCandidate {
  readonly nodeId: string;
  readonly primary: SmellHit;
  readonly secondary: readonly SmellHit[];
}

export interface ScoreOptions {
  readonly percentileThreshold?: number;
  readonly zScoreFloor?: number;
  readonly smallNCutoff?: number;
  readonly suppressFlag?: ReadonlyMap<string, boolean>;
  readonly weights?: Partial<WeightsTable>;
  /**
   * Node ids to drop from the ranked output. Excluded nodes still
   * contribute their raw values to the per-axis percentile distribution
   * — only the candidate emission is suppressed — so excluding a
   * high-value node does not inflate the percentiles of the survivors.
   */
  readonly excludedNodeIds?: ReadonlySet<string>;
  /**
   * Per-node line counts (raw declaration line span) for the `size_pct`
   * axis. Missing entries are treated as `0`. Provided as a separate
   * input rather than reaching into `Graph` so `score()` stays pure
   * over its declared inputs — same posture as `excludedNodeIds`.
   */
  readonly lineCounts?: ReadonlyMap<string, number>;
}

const DEFAULT_PERCENTILE_THRESHOLD = 0.85;
const DEFAULT_Z_SCORE_FLOOR = 1.5;
const DEFAULT_SMALL_N_CUTOFF = 100;
const SECONDARY_LIMIT = 2;

/**
 * Map every per-node metrics record into the per-axis numeric vector
 * the percentile lookup operates on. Weighted variants of fan-in /
 * fan-out are used for the percentile axes — mirrors the requirements
 * doc's "weighted variant drove the candidate" framing.
 *
 * `size_pct` is sourced separately from a per-node `lineCounts` map
 * passed via {@link ScoreOptions}, so it bypasses this function.
 */
function readAxisValue(node: NodeMetrics, axis: AxisId): number {
  switch (axis) {
    case "fan_in_pct":
      return node.fanInWeighted;
    case "fan_out_pct":
      return node.fanOutWeighted;
    case "reverse_closure_pct":
      return node.reverseClosure;
    case "pagerank_pct":
      return node.pageRank;
    case "betweenness_pct":
      return node.betweenness;
    case "instability_delta_pct":
      return node.instabilityDelta;
    case "unstable_edge_ratio_pct":
      return node.unstableEdgeRatio;
    case "size_pct":
    case "suppress_flag":
    default:
      return 0;
  }
}

const PERCENTILE_AXES: readonly AxisId[] = [
  "fan_in_pct",
  "fan_out_pct",
  "reverse_closure_pct",
  "pagerank_pct",
  "betweenness_pct",
  "instability_delta_pct",
  "unstable_edge_ratio_pct",
  "size_pct",
];

export function score(
  metrics: MetricsRecord,
  options: ScoreOptions = {},
): ArchCandidate[] {
  const threshold = options.percentileThreshold ?? DEFAULT_PERCENTILE_THRESHOLD;
  const zFloor = options.zScoreFloor ?? DEFAULT_Z_SCORE_FLOOR;
  const smallNCutoff = options.smallNCutoff ?? DEFAULT_SMALL_N_CUTOFF;
  const weights = mergeWeights(options.weights);
  const suppressFlag = options.suppressFlag ?? new Map<string, boolean>();
  const excludedNodeIds = options.excludedNodeIds;
  const lineCounts = options.lineCounts;

  const nodeIds = [...metrics.keys()];
  const n = nodeIds.length;
  if (n === 0) return [];

  const sizeOf = (id: string): number => lineCounts?.get(id) ?? 0;

  const lookups = new Map<AxisId, ReturnType<typeof buildPercentileLookup>>();
  for (const axis of PERCENTILE_AXES) {
    const population = nodeIds.map((id) => {
      if (axis === "size_pct") return sizeOf(id);
      const m = metrics.get(id);
      return m === undefined ? 0 : readAxisValue(m, axis);
    });
    lookups.set(axis, buildPercentileLookup({ population }));
  }

  const candidates: ArchCandidate[] = [];

  for (const id of nodeIds) {
    if (excludedNodeIds?.has(id) === true) continue;
    const node = metrics.get(id);
    if (node === undefined) continue;
    const hits: SmellHit[] = [];

    for (const smell of SMELL_TYPES) {
      // Structural gate: a single-caller node cannot be an architectural
      // bridge or load-bearing fan-out target. fanIn=0 means nothing
      // depends on the node (top-level entry / dead export); fanIn=1
      // means a single upstream pipeline owns it. In neither case does
      // restructuring the node relieve cross-cutting pressure — the
      // smell would be a false positive on CLI orchestrators and
      // single-caller pipeline entry points. unstable_dependency_candidate
      // is intentionally exempt: a node with no callers can still depend
      // on more-unstable downstream code, and that is the SDP violation
      // the smell tracks.
      if (
        (smell === "bridge_component" || smell === "high_fanout_component") &&
        node.fanInUnweighted <= 1
      ) {
        continue;
      }

      const smellWeights = weights[smell];
      let composite = 0;
      const contributing: ContributingMetric[] = [];
      let anyZClears = false;

      for (const axisStr of Object.keys(smellWeights)) {
        const axis = axisStr as AxisId;
        const weight = smellWeights[axis];
        if (weight === undefined || weight === 0) continue;

        if (AXIS_KIND[axis] === "flag") {
          const value =
            axis === "suppress_flag"
              ? suppressFlag.get(id) === true
                ? 1
                : 0
              : readAxisValue(node, axis);
          composite += weight * value;
          contributing.push({
            axis,
            weight,
            value,
            percentile: value,
            rank: 0,
            thresholdDelta: 0,
            zScore: 0,
          });
          if (value > 0) anyZClears = true;
          continue;
        }

        const lookup = lookups.get(axis);
        if (lookup === undefined) continue;
        const raw =
          axis === "size_pct" ? sizeOf(id) : readAxisValue(node, axis);
        // Per-axis noise floor (defaults to 0, see AXIS_NOISE_FLOOR).
        // A raw value at or below the floor contributes 0 to the
        // composite — the value is below the resolution at which the
        // axis carries any signal, regardless of where it sits in the
        // percentile distribution. The default-0 floor still catches
        // raw-zero cases (a node with no outgoing edges has no
        // fan-out, no unstable edges, etc.); axes that carry
        // quantization noise on small positives (e.g.
        // `instability_delta_pct`) raise the floor to suppress
        // single-tail-positive percentile inflation.
        if (raw <= AXIS_NOISE_FLOOR[axis]) {
          contributing.push({
            axis,
            weight,
            value: raw,
            percentile: 0,
            rank: 0,
            thresholdDelta: -threshold,
            zScore: 0,
          });
          continue;
        }
        const entry = lookup(raw);
        composite += weight * entry.percentile;
        contributing.push({
          axis,
          weight,
          value: raw,
          percentile: entry.percentile,
          rank: entry.rank === 0 ? 0 : n - entry.rank + 1,
          thresholdDelta: entry.percentile - threshold,
          zScore: entry.zScore,
        });
        if (entry.zScore >= zFloor) anyZClears = true;
      }

      if (composite < threshold) continue;
      if (n < smallNCutoff && !anyZClears) continue;
      hits.push({ smellType: smell, composite, contributing });
    }

    if (hits.length === 0) continue;
    hits.sort(compareHits);
    const primary = hits[0];
    if (primary === undefined) continue;
    const secondary = hits.slice(1, 1 + SECONDARY_LIMIT);
    candidates.push({ nodeId: id, primary, secondary });
  }

  candidates.sort(compareCandidates);
  return candidates;
}

function compareHits(a: SmellHit, b: SmellHit): number {
  if (a.composite !== b.composite) return b.composite - a.composite;
  if (a.smellType < b.smellType) return -1;
  if (a.smellType > b.smellType) return 1;
  return 0;
}

function compareCandidates(a: ArchCandidate, b: ArchCandidate): number {
  if (a.primary.composite !== b.primary.composite) {
    return b.primary.composite - a.primary.composite;
  }
  if (a.nodeId < b.nodeId) return -1;
  if (a.nodeId > b.nodeId) return 1;
  return 0;
}

function mergeWeights(
  override: Partial<WeightsTable> | undefined,
): WeightsTable {
  if (override === undefined) return DEFAULT_WEIGHTS;
  const merged: Record<SmellType, Record<AxisId, number>> = {} as Record<
    SmellType,
    Record<AxisId, number>
  >;
  for (const smell of SMELL_TYPES) {
    const base: Record<AxisId, number> = {} as Record<AxisId, number>;
    const def = DEFAULT_WEIGHTS[smell];
    for (const k of Object.keys(def)) {
      const axis = k as AxisId;
      const v = def[axis];
      if (v !== undefined) base[axis] = v;
    }
    const ov = override[smell];
    if (ov !== undefined) {
      for (const k of Object.keys(ov)) {
        const axis = k as AxisId;
        const v = ov[axis];
        if (v !== undefined) base[axis] = v;
      }
    }
    merged[smell] = base;
  }
  return merged as unknown as WeightsTable;
}
