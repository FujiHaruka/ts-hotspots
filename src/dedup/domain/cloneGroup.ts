import type { Evidence, RecommendationHint } from "./report.ts";

export interface FragmentView {
  filePath: string;
  startLine: number;
  endLine: number;
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

export interface AggregateScores {
  combined: AggregateAxis;
  tokenOverlap: AggregateAxis;
  statementKindSimilarity: AggregateAxis;
  callOverlap: AggregateAxis;
}

export interface CloneGroup {
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
  /** Evidence keys shared by every pair in the group. */
  sharedEvidence: Evidence;
  /** Group-level recommendation, computed against the weakest pair. */
  recommendationHint: RecommendationHint;
}
