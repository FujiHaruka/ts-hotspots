export { combinedScore } from "./combinedScore.ts";
export { shouldReport } from "./decide.ts";
export { buildFeatureSets, type FragmentFeatureSets } from "./featureSets.ts";
export { lengthScore } from "./lengthScore.ts";
export { meetsMinSize } from "./minSize.ts";
export {
  buildIntersectionsFromSets,
  type DetailedScore,
  scoreCandidateDetailedFromSets,
  scoreCandidateFromSets,
  type ScoreInputsFromSets,
  type ScoreIntersections,
} from "./scoreCandidate.ts";
export { sizeCompatibility } from "./sizeCompatibility.ts";
