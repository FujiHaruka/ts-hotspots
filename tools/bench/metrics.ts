import type { PhaseTimingsRecord } from "../../src/duplication/cli/perfLog.ts";
import type { MatchResult } from "./matchReport.ts";

/** Re-export for the rest of the bench tool chain. */
type PhaseTimings = PhaseTimingsRecord;

export interface ScenarioRunMetrics {
  scenarioId: string;
  tags: string[];
  /** Total GT positives in the fixture. */
  positives: number;
  /** Total GT negatives in the fixture. */
  negatives: number;
  /** GT positives matched within the top-10 of the report. */
  matchedTop10: number;
  /** GT positives matched within the top-50 of the report. */
  matchedTop50: number;
  /** GT positives matched anywhere in the report. */
  matchedAll: number;
  /** Count of report pairs that hit a negative (changed, existing) file pair. */
  negativeViolations: number;
  /** GT positives that matched but fell below their `minScore`. */
  minScoreFailures: number;
  /** Per-positive failure reasons for the Markdown failures section. */
  failures: string[];
  /** Wall-clock milliseconds for `runDetector`. */
  wallMs: number;
  /** Populated when bench was invoked with --phase-timings. */
  phaseTimings?: PhaseTimings;
}

export interface RunSummary {
  label: string;
  scenarios: ScenarioRunMetrics[];
  /** Total wall time across all scenarios in the run. */
  wallMs: number;
}

export interface AggregateRow {
  label: string;
  recallAt10: number;
  recallAt50: number;
  recallAtAll: number;
  negativeViolations: number;
  wallMs: number;
}

export function scenarioMetricsFromMatch(
  scenarioId: string,
  tags: string[],
  match: MatchResult,
  wallMs: number,
  phaseTimings?: PhaseTimings,
): ScenarioRunMetrics {
  let matchedTop10 = 0;
  let matchedTop50 = 0;
  let matchedAll = 0;
  let minScoreFailures = 0;
  const failures: string[] = [];

  for (const p of match.positives) {
    if (p.rank === null) {
      failures.push(
        `missed: ${p.expected.changed.filePath} ↔ ${p.expected.existing.filePath}`,
      );
      continue;
    }
    matchedAll += 1;
    if (p.rank < 10) matchedTop10 += 1;
    if (p.rank < 50) matchedTop50 += 1;
    if (p.minScoreFailure !== null) {
      minScoreFailures += 1;
      failures.push(
        `minScore: ${p.expected.changed.filePath} ↔ ${p.expected.existing.filePath} (${p.minScoreFailure})`,
      );
    }
  }

  let negativeViolations = 0;
  for (const n of match.negatives) {
    negativeViolations += n.violations;
    if (n.violations > 0) {
      failures.push(
        `neg: ${n.expected.changed.filePath} ↔ ${n.expected.existing.filePath} (${String(n.violations)} hit${n.violations === 1 ? "" : "s"})`,
      );
    }
  }

  const out: ScenarioRunMetrics = {
    scenarioId,
    tags,
    positives: match.positives.length,
    negatives: match.negatives.length,
    matchedTop10,
    matchedTop50,
    matchedAll,
    negativeViolations,
    minScoreFailures,
    failures,
    wallMs,
  };
  if (phaseTimings !== undefined) out.phaseTimings = phaseTimings;
  return out;
}

/**
 * Micro recall: sum matched positives / sum total positives across all scenarios.
 * Negative violations are summed (not averaged).
 */
export function aggregate(run: RunSummary): AggregateRow {
  let matched10 = 0;
  let matched50 = 0;
  let matchedAll = 0;
  let total = 0;
  let violations = 0;
  for (const s of run.scenarios) {
    matched10 += s.matchedTop10;
    matched50 += s.matchedTop50;
    matchedAll += s.matchedAll;
    total += s.positives;
    violations += s.negativeViolations;
  }
  const safe = (n: number): number => (total === 0 ? 0 : n / total);
  return {
    label: run.label,
    recallAt10: safe(matched10),
    recallAt50: safe(matched50),
    recallAtAll: safe(matchedAll),
    negativeViolations: violations,
    wallMs: run.wallMs,
  };
}

interface PerTagRow {
  tag: string;
  matched: number;
  total: number;
  recall: number;
}

export function perTagRecall(run: RunSummary): PerTagRow[] {
  const byTag = new Map<string, { matched: number; total: number }>();
  for (const s of run.scenarios) {
    if (s.positives === 0) continue;
    for (const tag of s.tags) {
      const cur = byTag.get(tag) ?? { matched: 0, total: 0 };
      cur.matched += s.matchedAll;
      cur.total += s.positives;
      byTag.set(tag, cur);
    }
  }
  const rows: PerTagRow[] = [];
  for (const [tag, v] of byTag) {
    rows.push({
      tag,
      matched: v.matched,
      total: v.total,
      recall: v.total === 0 ? 0 : v.matched / v.total,
    });
  }
  rows.sort((a, b) => a.tag.localeCompare(b.tag));
  return rows;
}

export function totalPositives(run: RunSummary): number {
  return run.scenarios.reduce((acc, s) => acc + s.positives, 0);
}

export function totalNegatives(run: RunSummary): number {
  return run.scenarios.reduce((acc, s) => acc + s.negatives, 0);
}

const PHASE_KEYS = [
  "diff",
  "listBase",
  "baseIndex",
  "headSearch",
  "report",
] as const satisfies readonly (keyof PhaseTimings)[];

type PhaseKey = (typeof PHASE_KEYS)[number];

export interface PhaseBreakdownRow {
  phase: PhaseKey;
  meanMs: number;
  p90Ms: number;
  maxMs: number;
  /** Share of the per-phase mean relative to the sum of all phase means (0..1). */
  share: number;
}

/**
 * Build a per-phase breakdown for scenarios that carry `phaseTimings`.
 * Scenarios missing timings are skipped, so this safely returns an empty
 * array when `--phase-timings` was not passed to the bench harness.
 */
export function phaseBreakdown(run: RunSummary): PhaseBreakdownRow[] {
  const samples: Record<PhaseKey, number[]> = {
    diff: [],
    listBase: [],
    baseIndex: [],
    headSearch: [],
    report: [],
  };
  for (const s of run.scenarios) {
    if (s.phaseTimings === undefined) continue;
    for (const key of PHASE_KEYS) samples[key].push(s.phaseTimings[key]);
  }
  if (samples.diff.length === 0) return [];

  const means: Record<PhaseKey, number> = {
    diff: mean(samples.diff),
    listBase: mean(samples.listBase),
    baseIndex: mean(samples.baseIndex),
    headSearch: mean(samples.headSearch),
    report: mean(samples.report),
  };
  const totalMean = PHASE_KEYS.reduce((acc, k) => acc + means[k], 0);
  return PHASE_KEYS.map((phase) => ({
    phase,
    meanMs: means[phase],
    p90Ms: percentile(samples[phase], 0.9),
    maxMs: Math.max(...samples[phase]),
    share: totalMean === 0 ? 0 : means[phase] / totalMean,
  }));
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor(p * (sorted.length - 1) + 0.5),
  );
  return sorted[idx] ?? 0;
}
