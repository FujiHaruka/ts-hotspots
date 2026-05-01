export type {
  Candidate,
  CandidateScore,
  ScoreBreakdown,
} from "./candidate.ts";
export type {
  AggregateAxis,
  AggregateScores,
  CloneGroup,
  FragmentView,
  GroupMember,
  PairScores,
} from "./cloneGroup.ts";
export type { ChangedFile, ChangedHunk } from "./diff.ts";
export type {
  Feature,
  FeatureKey,
  FeatureKind,
  FragmentFeatures,
} from "./feature.ts";
export type { Fragment, FragmentKind } from "./fragment.ts";
export { fragmentLineCount } from "./fragment.ts";
export type { InvertedIndex, Posting } from "./posting.ts";
export type {
  AnalysisSummary,
  CloneCandidateReport,
  DismissedSummary,
  DuplicationErrorReport,
  DuplicationPrInfo,
  Evidence,
  RecommendationHint,
  ReportTool,
  ScopeStats,
} from "./report.ts";
