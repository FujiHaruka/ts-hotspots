import type { Evidence, RecommendationHint } from "./report.ts";

export interface FragmentView {
  /**
   * `file:start-end` coordinate string (or `file:line` for single-line
   * fragments). Matches `comp`'s `location` so both reports surface the
   * same coordinate shape.
   */
  location: string;
  kind: string;
  /** Fragment source. Omitted when the report was built with includeCode=false. */
  code?: string;
}

export interface PairScores {
  combined: number;
  tokenOverlap: number;
  statementKindSimilarity: number;
  callOverlap: number;
  sizeCompatibility: number;
  lengthScore: number;
}

export interface GroupMember {
  fragment: FragmentView;
  /** Pair-level scores between the anchor and this member. */
  scores: PairScores;
  /** Pair-level evidence between the anchor and this member. */
  evidence: Evidence;
}

export interface AggregateAxis {
  min: number;
  median: number;
  max: number;
}

export interface AggregateCombinedAxis extends AggregateAxis {
  /**
   * Group sort key: `max * churnAmplifier(aggregateChurn.max)`. Equals
   * `max` when churn is unavailable or zero, so `--no-churn` runs (or
   * shallow / non-git environments) preserve the prior ranking.
   */
  amplified: number;
}

export interface AggregateScores {
  combined: AggregateCombinedAxis;
  tokenOverlap: AggregateAxis;
  statementKindSimilarity: AggregateAxis;
  callOverlap: AggregateAxis;
}

/**
 * Per-group churn metadata. `max` is the maximum commit count over the
 * file set (de-duped — same file with multiple members counts once);
 * `min` is the minimum. `perFile` lists the commit count for each file
 * involved (omitted in slim output to keep the schema small).
 *
 * Absent on a group when churn collection was disabled or the run was
 * outside a git repo.
 */
export interface AggregateChurn {
  max: number;
  min: number;
  perFile: Record<string, number>;
}

export interface CloneGroup {
  /**
   * `dup:<sha256>` id used by `ts-hotspots dismiss` to filter this group
   * from future runs. Derived from every member's normalized body hash
   * (sorted, joined, hashed) so the id is stable under member reordering
   * but auto-expires when the group's membership changes.
   */
  dismissalId: string;
  /**
   * In PR mode this is the changed-side fragment that anchors the group.
   * In whole-repo mode there is no privileged direction, so `anchor` is
   * `undefined` and every cluster member sits in `members`.
   */
  anchor?: FragmentView;
  /**
   * Member fragments. PR mode: every base fragment that paired with the
   * anchor. Whole-repo mode: every fragment in the cluster, ordered by
   * `fragmentId` ascending.
   */
  members: GroupMember[];
  /**
   * Total fragment count: PR mode = `1 (anchor) + members.length`,
   * whole-repo mode = `members.length`. Reads as "how many fragments
   * does this group cover" in either mode.
   */
  size: number;
  aggregateScores: AggregateScores;
  /**
   * Per-group churn metadata. Present when churn collection ran
   * successfully; absent when `--no-churn` was passed, when running
   * outside a git repo, or on a fully shallow clone.
   */
  aggregateChurn?: AggregateChurn;
  /** Evidence keys shared by every pair in the group. */
  sharedEvidence: Evidence;
  /** Group-level recommendation, computed against the weakest pair. */
  recommendationHint: RecommendationHint;
}
