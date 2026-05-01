import type {
  AggregateChurn,
  AggregateScores,
  CloneCandidateReport,
  CloneGroup,
  DismissedSummary,
  DuplicationPrInfo,
  Evidence,
  FragmentView,
  GroupMember,
  RecommendationHint,
  ReportTool,
} from "../domain/index.ts";

/**
 * Output schema emitted by `ts-hotspots duplication`. The internal
 * `CloneCandidateReport` model carries every signal the pipeline produced;
 * this module narrows it to a coordinate-first shape an AI agent can
 * consume without drowning in evidence detail.
 *
 * Two profiles:
 *   - **slim** (default): just the fields needed to start an investigation
 *     (location, kind, score, top shared calls/properties, dismissalId).
 *   - **verbose** (`--verbose`): adds per-member scores, aggregate score
 *     axes, full evidence (statement kinds, token n-gram sample), the
 *     recommendation hint, and the analysis summary.
 *
 * Both profiles share the same envelope (`status`, `tool`, `project`,
 * `pr?`, `hotspots[]`, `dismissed?`) so consumers can branch only on the
 * extra detail keys, not on the top-level shape.
 */

/**
 * Single representative score for a clone group. `axis` is `"combined"`
 * (the only public dup axis) and `value` is the median pair `combined`
 * score across the group. Mirrors `comp`'s `HotspotScore` so consumers
 * read the headline number off either subcommand uniformly.
 */
export interface DupScore {
  axis: "combined";
  value: number;
}

export interface SlimDupHotspot {
  kind: "duplication";
  /** Total fragments in the group: `(anchor ? 1 : 0) + members.length`. */
  size: number;
  /** Headline score — see `DupScore`. */
  score: DupScore;
  /** PR mode anchor (the changed-side fragment). Absent in whole-repo. */
  anchor?: { ref: HotspotRef };
  /** Other fragments in the group, ordered by descending score. */
  members: { ref: HotspotRef }[];
  /** Top shared signals across the group, prefix-stripped for readability. */
  evidence: { calls: string[]; properties: string[] };
  /**
   * `dup:<sha256>` id derived from member body hashes. Pass to
   * `ts-hotspots dismiss` to filter this group from future runs.
   */
  dismissalId: string;
}

export interface HotspotRef {
  /** `file:start-end` coordinate string, identical to comp's. */
  location: string;
  /** Fragment kind: `function | block | window`. */
  kind: string;
}

export interface VerboseDupHotspot extends SlimDupHotspot {
  /** min/median/max for combined + the four sub-axes. */
  aggregateScores: AggregateScores;
  /**
   * Recent-commit churn for the files this group spans. Absent when
   * churn collection was disabled or skipped (non-git, shallow clone,
   * `--no-churn`).
   */
  aggregateChurn?: AggregateChurn;
  /** Pipeline's recommendation derived from the weakest pair. */
  recommendationHint: RecommendationHint;
  /** Statement-kind / token-ngram signals dropped from slim output. */
  evidenceFull: { statementKinds: string[]; tokenNgramsSample: string[] };
  members: VerboseMember[];
  anchor?: { ref: HotspotRef; code?: string };
}

export interface VerboseMember {
  ref: HotspotRef;
  code?: string;
  scores: GroupMember["scores"];
  evidence: { calls: string[]; properties: string[] };
}

export interface SerializedDupReport {
  tool: ReportTool;
  project: { sourceFileCount: number; fragmentCount?: number };
  /** Only emitted in PR mode (omitted in whole-repo). */
  pr?: DuplicationPrInfo;
  hotspots: SlimDupHotspot[];
  dismissed?: DismissedSummary;
  /** `--verbose` only: pipeline counts and scope sizes. */
  summary?: CloneCandidateReport["summary"];
}

export interface SerializedDupReportVerbose extends SerializedDupReport {
  hotspots: VerboseDupHotspot[];
  summary: CloneCandidateReport["summary"];
}

export interface SerializeOptions {
  verbose: boolean;
}

/**
 * Convert a rich `CloneCandidateReport` into the public output schema.
 * The internal report is left untouched; this function only produces the
 * narrowed view emitted by the CLI.
 */
export function serializeReport(
  report: CloneCandidateReport,
  opts: SerializeOptions,
): SerializedDupReport | SerializedDupReportVerbose {
  const sourceFileCount = report.summary.scope.base.files;
  const wholeRepo = report.summary.mode === "whole-repo";

  const project: SerializedDupReport["project"] = { sourceFileCount };
  if (opts.verbose) {
    project.fragmentCount = report.summary.scope.base.fragments;
  }

  const base: SerializedDupReport = {
    tool: report.tool,
    project,
    hotspots: opts.verbose
      ? report.groups.map(toVerboseHotspot)
      : report.groups.map(toSlimHotspot),
  };
  if (!wholeRepo) {
    base.pr = report.pr;
  }
  if (report.dismissed !== undefined) {
    base.dismissed = report.dismissed;
  }
  if (opts.verbose) {
    base.summary = report.summary;
  }
  return base;
}

function toSlimHotspot(group: CloneGroup): SlimDupHotspot {
  const result: SlimDupHotspot = {
    kind: "duplication",
    size: group.size,
    score: {
      axis: "combined",
      value: group.aggregateScores.combined.median,
    },
    members: group.members.map((m) => ({ ref: toRef(m.fragment) })),
    evidence: humanizeEvidence(group.sharedEvidence),
    dismissalId: group.dismissalId,
  };
  if (group.anchor !== undefined) {
    result.anchor = { ref: toRef(group.anchor) };
  }
  return result;
}

function toVerboseHotspot(group: CloneGroup): VerboseDupHotspot {
  const slim = toSlimHotspot(group);
  const result: VerboseDupHotspot = {
    ...slim,
    aggregateScores: group.aggregateScores,
    recommendationHint: group.recommendationHint,
    evidenceFull: {
      statementKinds: group.sharedEvidence.matchedStatementKinds,
      tokenNgramsSample: group.sharedEvidence.matchedTokenNgramsSample,
    },
    members: group.members.map(toVerboseMember),
  };
  if (group.aggregateChurn !== undefined) {
    result.aggregateChurn = group.aggregateChurn;
  }
  if (group.anchor !== undefined) {
    const anchor: VerboseDupHotspot["anchor"] = { ref: toRef(group.anchor) };
    if (group.anchor.code !== undefined) anchor.code = group.anchor.code;
    result.anchor = anchor;
  }
  return result;
}

function toVerboseMember(m: GroupMember): VerboseMember {
  const out: VerboseMember = {
    ref: toRef(m.fragment),
    scores: m.scores,
    evidence: humanizeEvidence(m.evidence),
  };
  if (m.fragment.code !== undefined) out.code = m.fragment.code;
  return out;
}

function toRef(view: FragmentView): HotspotRef {
  return { location: view.location, kind: view.kind };
}

/**
 * Map raw `Evidence` into reader-friendly `calls` / `properties` arrays.
 *
 * - `CALL:foo`        → `foo`
 * - `NEW:Foo`         → `new Foo`
 * - `AWAIT_CALL:foo`  → `await foo`
 * - `PROP:obj.field`  → `obj.field`
 *
 * Keeps the call/constructor/await distinction visible while removing the
 * internal-prefix noise. Order is preserved (the upstream arrays are
 * already deterministically sorted).
 */
function humanizeEvidence(evidence: Evidence): {
  calls: string[];
  properties: string[];
} {
  const calls = evidence.sharedCalls.map(humanizeCall);
  const properties = evidence.sharedProperties.map(stripPropPrefix);
  return { calls, properties };
}

function humanizeCall(raw: string): string {
  if (raw.startsWith("CALL:")) return raw.slice("CALL:".length);
  if (raw.startsWith("NEW:")) return `new ${raw.slice("NEW:".length)}`;
  if (raw.startsWith("AWAIT_CALL:")) {
    return `await ${raw.slice("AWAIT_CALL:".length)}`;
  }
  return raw;
}

function stripPropPrefix(raw: string): string {
  return raw.startsWith("PROP:") ? raw.slice("PROP:".length) : raw;
}
