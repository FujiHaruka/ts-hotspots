export type FunctionKind =
  | "function"
  | "method"
  | "arrow"
  | "function-expression"
  | "getter"
  | "setter"
  | "constructor";

export interface FunctionMetrics {
  cyclomaticComplexity: number;
  cognitiveComplexity: number;
  sloc: number;
  statementCount: number;
  parameterCount: number;
  maxNestingDepth: number;
  returnCount: number;
  anyCount: number;
  anyTaintedExpressionCount: number;
  typeAssertionCount: number;
  unsafeCastCount: number;
  nonNullAssertionCount: number;
  tsIgnoreCount: number;
  tsExpectErrorCount: number;
  tsNocheckCount: number;
  callerCount: number;
  calleeCount: number;
  tryCatchCount: number;
  awaitCount: number;
  mutationSiteCount: number;
  commitCount: number;
}

export type FunctionAxisId =
  | "cognitiveComplexity"
  | "cyclomaticComplexity"
  | "maxNestingDepth"
  | "sloc"
  | "statementCount"
  | "parameterCount"
  | "returnCount"
  | "anyCount"
  | "anyTaintedExpressionCount"
  | "typeAssertionCount"
  | "unsafeCastCount"
  | "nonNullAssertionCount"
  | "tsSuppressionsFamily"
  | "callerCount"
  | "calleeCount"
  | "tryCatchCount"
  | "awaitCount"
  | "mutationSiteCount"
  | "commitCount";

export const FUNCTION_AXIS_IDS: readonly FunctionAxisId[] = [
  "cognitiveComplexity",
  "cyclomaticComplexity",
  "maxNestingDepth",
  "sloc",
  "statementCount",
  "parameterCount",
  "returnCount",
  "anyCount",
  "anyTaintedExpressionCount",
  "typeAssertionCount",
  "unsafeCastCount",
  "nonNullAssertionCount",
  "tsSuppressionsFamily",
  "callerCount",
  "calleeCount",
  "tryCatchCount",
  "awaitCount",
  "mutationSiteCount",
  "commitCount",
];

export interface FunctionRef {
  location: string;
  name: string;
  kind: FunctionKind;
}

export interface RankedFunctionEntry {
  ref: FunctionRef;
  value: number;
}

export interface FunctionEntry {
  location: string;
  name: string;
  kind: FunctionKind;
  metrics: Partial<FunctionMetrics>;
  bodyHash: string;
}

export interface ReportTool {
  name: "ts-hotspots";
  version: string;
}

export interface ReportProject {
  tsconfigPath: string;
  rootDir: string;
  sourceFileCount: number;
  functionCount: number;
}

export interface FunctionCoOccurrenceEntry {
  ref: FunctionRef;
  axisHitCount: number;
  axes: FunctionAxisId[];
}

export interface AxisMeta {
  nonZeroCount: number;
  maxTieLength: number;
  topNSpread: number;
  uniqueTopNValues: number;
}

export interface HotspotCandidate {
  ref: FunctionRef;
  metrics: Partial<FunctionMetrics>;
  dismissalId: string;
}

export interface DismissedSummary {
  active: number;
  filteredThisRun: number;
  prunedThisRun: number;
}

export interface FunctionReport {
  status: "ok";
  tool: ReportTool;
  project: ReportProject;
  functionHotspotCandidates: HotspotCandidate[];
  functionRankings?: Partial<Record<FunctionAxisId, RankedFunctionEntry[]>>;
  functionAxisMeta?: Record<FunctionAxisId, AxisMeta>;
  functionCoOccurrence?: FunctionCoOccurrenceEntry[];
  functions?: FunctionEntry[];
  dismissed?: DismissedSummary;
}

export interface ErrorReport {
  status: "error";
  error: { code: string; message: string };
}
