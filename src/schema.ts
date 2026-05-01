export type FunctionKind =
  | "function"
  | "method"
  | "arrow"
  | "function-expression"
  | "getter"
  | "setter"
  | "constructor";

export interface FunctionMetrics {
  cognitiveComplexity: number;
  sloc: number;
  parameterCount: number;
  maxNestingDepth: number;
  calleeCount: number;
  tryCatchCount: number;
  awaitCount: number;
  mutationSiteCount: number;
  commitCount: number;
}

export type FunctionAxisId =
  | "cognitiveComplexity"
  | "maxNestingDepth"
  | "sloc"
  | "parameterCount"
  | "calleeCount"
  | "tryCatchCount"
  | "awaitCount"
  | "mutationSiteCount"
  | "commitCount";

export const FUNCTION_AXIS_IDS: readonly FunctionAxisId[] = [
  "cognitiveComplexity",
  "maxNestingDepth",
  "sloc",
  "parameterCount",
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
  sourceFileCount: number;
  /** `--verbose` only. Total functions collected (across all files). */
  functionCount?: number;
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

/**
 * Single representative metric driving a hotspot's rank. `axis` is the
 * `FunctionAxisId` where this candidate's rank within the per-axis list is
 * highest (i.e. smallest index); `value` is the raw metric value at that
 * axis. Mirrors `dup`'s `score: { axis, value }` so consumers can read the
 * "headline number" off a hotspot uniformly across subcommands.
 */
export interface HotspotScore {
  axis: FunctionAxisId;
  value: number;
}

export interface HotspotCandidate {
  /** Discriminator parallel to `dup`'s `kind: "duplication"`. */
  kind: "complexity";
  ref: FunctionRef;
  /** Headline metric — see `HotspotScore`. */
  score: HotspotScore;
  metrics: Partial<FunctionMetrics>;
  dismissalId: string;
}

export interface DismissedSummary {
  active: number;
  filteredThisRun: number;
  prunedThisRun: number;
}

/**
 * PR scope metadata. Present when complexity was invoked with `--pr` so the
 * report's hotspot surfaces are filtered to functions in the changed-files
 * set. Rankings are still computed against the full head ref so the
 * underlying distribution is intact — only the displayed lists are scoped.
 */
export interface PrInfo {
  baseSha: string;
  headSha: string;
  /** `true` for `A...B` (merge-base semantics). `false` for `A..B`. */
  threeDot: boolean;
  /** Changed `.ts`/`.tsx` files (after exclude globs) intersected with the project. */
  changedFiles: number;
}

export interface FunctionReport {
  tool: ReportTool;
  project: ReportProject;
  /**
   * Per-function hotspot candidates. Renamed from
   * `functionHotspotCandidates` so the envelope mirrors `dup`'s
   * `hotspots[]` shape — both subcommands now expose a single ranked
   * list under the same key.
   */
  hotspots: HotspotCandidate[];
  functionRankings?: Partial<Record<FunctionAxisId, RankedFunctionEntry[]>>;
  functionAxisMeta?: Record<FunctionAxisId, AxisMeta>;
  functionCoOccurrence?: FunctionCoOccurrenceEntry[];
  functions?: FunctionEntry[];
  dismissed?: DismissedSummary;
  pr?: PrInfo;
  notice?: { code: string; message: string };
}

export interface ErrorReport {
  status: "error";
  error: { code: string; message: string };
}
