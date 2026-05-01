export { buildCloneGroups } from "./buildCloneGroups.ts";
export { buildCloneGroupsFromClusters } from "./buildCloneGroupsFromClusters.ts";
export {
  type Cluster,
  type ClusterConfig,
  type ClusterStats,
  clusterPairs,
} from "./clusterPairs.ts";
export { collapsePairs } from "./collapsePairs.ts";
export { dropThinWrapperPairs } from "./dropThinWrapperPairs.ts";
export { buildEvidence, type Intersections } from "./evidence.ts";
export {
  buildJsonReport,
  type ReportInput,
  type ScoredPair,
} from "./jsonReport.ts";
export { type RankablePair, sortCandidates } from "./ranking.ts";
export {
  type DeriveHintArgs,
  deriveHint,
} from "./recommendationHint.ts";
