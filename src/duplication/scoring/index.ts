export { combinedScore } from "./combinedScore.ts";
export { shouldReport } from "./decide.ts";
export { buildFeatureSets, type FragmentFeatureSets } from "./featureSets.ts";
export { lengthScore } from "./lengthScore.ts";
export { meetsMinSize } from "./minSize.ts";
export {
  buildIntersectionsFromSets,
  type DetailedScore,
  type ScoreInputsFromSets,
  type ScoreIntersections,
  scoreCandidateDetailedFromSets,
  scoreCandidateFromSets,
} from "./scoreCandidate.ts";
export { sizeCompatibility } from "./sizeCompatibility.ts";
