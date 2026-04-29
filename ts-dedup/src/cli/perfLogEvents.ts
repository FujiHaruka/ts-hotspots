import type { Config } from "../config/config.ts";
import type { CandidateScore } from "../domain/candidate.ts";
import type { InvertedIndex } from "../domain/posting.ts";
import type { LshParams, LshStats } from "../index_/index.ts";
import {
  distSummary,
  meanMax,
  type PerfLogger,
  round2,
} from "./perfLog.ts";

/**
 * Per-headSearch loop accumulators. The runners build this in-place so the
 * `phase.subPhase` / `*.summary` events can be emitted in a single pass at
 * the end of the loop. Lists are appended to only when `perfLog !== undefined`,
 * so a disabled logger keeps the hot path allocation-free.
 */
export interface PerHitTracker {
  /** Wall time spent inside `searchCandidates`. */
  tSearch: number;
  /** Wall time spent inside `scoreCandidate*`. */
  tScore: number;
  /** Wall time spent inside `shouldReport`. */
  tDecide: number;
  /** Number of `searchCandidates` invocations. */
  queries: number;
  /** Number of `(changed, base)` pairs handed to the scorer. */
  scored: number;
  /** Pre-cap candidate counts per query, captured from `SearchStats`. */
  preCapList: number[];
  /** Number of queries whose candidate count exceeded the cap. */
  atCapCount: number;
  /** Per-axis intersection sizes for *reported* pairs only. */
  intersectionTokens: number[];
  intersectionStatements: number[];
  intersectionCalls: number[];
  /** Per-axis raw scores for *every* scored pair. */
  axisToken: number[];
  axisStatement: number[];
  axisCall: number[];
  axisSize: number[];
  axisCombined: number[];
  /** Reported pairs: which threshold(s) admitted them. */
  passCombined: number;
  passToken: number;
  passStatement: number;
  passCall: number;
  passAnyAxis: number;
  passed: number;
}

export function newPerHitTracker(): PerHitTracker {
  return {
    tSearch: 0,
    tScore: 0,
    tDecide: 0,
    queries: 0,
    scored: 0,
    preCapList: [],
    atCapCount: 0,
    intersectionTokens: [],
    intersectionStatements: [],
    intersectionCalls: [],
    axisToken: [],
    axisStatement: [],
    axisCall: [],
    axisSize: [],
    axisCombined: [],
    passCombined: 0,
    passToken: 0,
    passStatement: 0,
    passCall: 0,
    passAnyAxis: 0,
    passed: 0,
  };
}

/**
 * Update `tracker.pass*` counters for a reported pair. Mirrors the OR
 * structure of `shouldReport` so each axis that satisfied its own threshold
 * is credited, and `passAnyAxis` reflects the OR of the per-axis tests.
 */
export function recordPassReasons(
  tracker: PerHitTracker,
  score: CandidateScore,
  thresholds: Config["scoring"]["thresholds"],
  enabled: Config["features"]["enabled"],
): void {
  let anyAxis = false;
  if (score.combined >= thresholds.combined) tracker.passCombined += 1;
  if (enabled.token && score.breakdown.tokenOverlap >= thresholds.token) {
    tracker.passToken += 1;
    anyAxis = true;
  }
  if (
    enabled.statement &&
    score.breakdown.statementKindSimilarity >= thresholds.statement
  ) {
    tracker.passStatement += 1;
    anyAxis = true;
  }
  if (enabled.call && score.breakdown.callOverlap >= thresholds.call) {
    tracker.passCall += 1;
    anyAxis = true;
  }
  if (anyAxis) tracker.passAnyAxis += 1;
}

export function emitPhaseStart(perfLog: PerfLogger | undefined, phase: string): void {
  perfLog?.emit("phase.start", { phase });
}

export function emitPhaseEnd(
  perfLog: PerfLogger | undefined,
  phase: string,
  wallMs: number,
): void {
  perfLog?.emit("phase.end", { phase, wallMs: round2(wallMs) });
}

/** Emit `index.stats` + `index.hotKeys` once the inverted index is built. */
export function emitIndexStats(
  perfLog: PerfLogger | undefined,
  index: InvertedIndex,
  totalFragments: number,
  topN = 20,
): void {
  if (perfLog === undefined) return;
  const sizes: number[] = [];
  let totalPostings = 0;
  const top: { key: string; size: number }[] = [];
  for (const [key, postings] of index.postings) {
    sizes.push(postings.length);
    totalPostings += postings.length;
    top.push({ key, size: postings.length });
  }
  sizes.sort((a, b) => a - b);
  top.sort((a, b) => b.size - a.size);
  const uniqueKeys = index.postings.size;
  const avgSize = uniqueKeys === 0 ? 0 : totalPostings / uniqueKeys;
  perfLog.emit("index.stats", {
    uniqueKeys,
    totalPostings,
    avgSize: round2(avgSize),
    p50: percentile(sizes, 0.5),
    p90: percentile(sizes, 0.9),
    p99: percentile(sizes, 0.99),
    max: sizes[sizes.length - 1] ?? 0,
  });
  perfLog.emit("index.hotKeys", {
    top: top.slice(0, topN).map((k) => ({
      key: k.key,
      size: k.size,
      df: totalFragments === 0 ? 0 : round2(k.size / totalFragments),
    })),
  });
}

/** Emit `fragments.stats` summarising fragment counts per kind / per file. */
export function emitFragmentsStats(
  perfLog: PerfLogger | undefined,
  total: number,
  byKind: { function: number; block: number; window: number },
  fragmentsPerFile: readonly number[],
): void {
  if (perfLog === undefined) return;
  const sorted = [...fragmentsPerFile].sort((a, b) => a - b);
  perfLog.emit("fragments.stats", {
    total,
    byKind: { ...byKind },
    byFile: {
      p50: percentile(sorted, 0.5),
      p90: percentile(sorted, 0.9),
      max: sorted[sorted.length - 1] ?? 0,
    },
  });
}

/** Emit `phase.subPhase` (search) + `search.summary`. */
export function emitSearchSummary(
  perfLog: PerfLogger | undefined,
  queries: number,
  wallMs: number,
  preCapList: readonly number[],
  cap: number,
  atCapCount: number,
): void {
  if (perfLog === undefined) return;
  perfLog.emit("phase.subPhase", {
    phase: "search",
    wallMs: round2(wallMs),
    count: queries,
  });
  perfLog.emit("search.summary", {
    queries,
    wallMs: round2(wallMs),
    preCapCandidates: distSummary(preCapList),
    cap,
    capSaturation: {
      atCapFragments: atCapCount,
      ratio: queries === 0 ? 0 : round2(atCapCount / queries),
    },
  });
}

/**
 * Emit `phase.subPhase` (scoring) + `scoring.summary`.
 *
 * `pairs` is the raw count handed to scoring; `uniquePairs` is the count
 * after canonical-key dedup (whole-repo) or equal to `pairs` (PR mode).
 */
export function emitScoringSummary(
  perfLog: PerfLogger | undefined,
  pairs: number,
  uniquePairs: number,
  tracker: PerHitTracker,
): void {
  if (perfLog === undefined) return;
  perfLog.emit("phase.subPhase", {
    phase: "scoring",
    wallMs: round2(tracker.tScore),
    count: tracker.scored,
  });
  perfLog.emit("scoring.summary", {
    pairs,
    uniquePairs,
    wallMs: round2(tracker.tScore),
    usPerPair:
      tracker.scored === 0 ? 0 : round2((tracker.tScore * 1000) / tracker.scored),
    intersectionSizes: {
      token: meanMax(tracker.intersectionTokens),
      statement: meanMax(tracker.intersectionStatements),
      call: meanMax(tracker.intersectionCalls),
    },
    axisDist: {
      token: axisSummary(tracker.axisToken),
      statement: axisSummary(tracker.axisStatement),
      call: axisSummary(tracker.axisCall),
      size: axisSummary(tracker.axisSize),
      combined: axisSummary(tracker.axisCombined),
    },
  });
}

/** Emit `phase.subPhase` (decide) + `decide.summary`. */
export function emitDecideSummary(
  perfLog: PerfLogger | undefined,
  tracker: PerHitTracker,
): void {
  if (perfLog === undefined) return;
  perfLog.emit("phase.subPhase", {
    phase: "decide",
    wallMs: round2(tracker.tDecide),
    count: tracker.scored,
  });
  const rejected = tracker.scored - tracker.passed;
  perfLog.emit("decide.summary", {
    passed: tracker.passed,
    rejected,
    passedRatio:
      tracker.scored === 0 ? 0 : round2(tracker.passed / tracker.scored),
    passReasons: {
      combined: tracker.passCombined,
      token: tracker.passToken,
      statement: tracker.passStatement,
      call: tracker.passCall,
      anyAxis: tracker.passAnyAxis,
    },
  });
}

/**
 * Emit `lsh.summary` for a single axis (whole-repo, LSH generator only).
 *
 * `axis` distinguishes per-axis LSH passes ("token" / "call" / …) so
 * downstream tooling can break out wall and collision counts per axis.
 */
export function emitLshSummary(
  perfLog: PerfLogger | undefined,
  axis: string,
  params: LshParams,
  stats: LshStats,
  fragmentCount: number,
  candidatePairs: number,
  buildWallMs: number,
): void {
  if (perfLog === undefined) return;
  perfLog.emit("lsh.summary", {
    axis,
    params: {
      numHashes: params.numHashes,
      bands: params.bands,
      rows: params.rows,
      seedCount: params.seedCount,
      seed: params.seed,
    },
    fragmentCount,
    buildWallMs: round2(buildWallMs),
    bucketCollisionPairs: stats.bucketCollisionPairs,
    candidatePairsAfterDedup: candidatePairs,
    totalBuckets: stats.totalBuckets,
    nonTrivialBuckets: stats.nonTrivialBuckets,
    maxBucketSize: stats.maxBucketSize,
    inflectionThreshold:
      params.bands === 0 || params.rows === 0
        ? 0
        : round2((1 / params.bands) ** (1 / params.rows)),
  });
}

/**
 * Emit `lsh.union` after all axes' candidate pairs have been merged.
 * `axisPairs` records per-axis emit counts (before union); `unionPairs`
 * is the deduplicated result. `overlapPairs` (= sum(axisPairs) -
 * unionPairs) shows how much axes' candidate sets agreed.
 */
export function emitLshUnion(
  perfLog: PerfLogger | undefined,
  axisPairs: Record<string, number>,
  unionPairs: number,
): void {
  if (perfLog === undefined) return;
  let total = 0;
  for (const n of Object.values(axisPairs)) total += n;
  perfLog.emit("lsh.union", {
    axisPairs,
    unionPairs,
    overlapPairs: total - unionPairs,
  });
}

/** Emit `pairs.dedup` (whole-repo only). */
export function emitPairsDedup(
  perfLog: PerfLogger | undefined,
  rawCandidates: number,
  uniqueAfterCanonical: number,
): void {
  if (perfLog === undefined) return;
  perfLog.emit("pairs.dedup", {
    rawCandidates,
    uniqueAfterCanonical,
    dedupRate:
      rawCandidates === 0
        ? 0
        : round2(1 - uniqueAfterCanonical / rawCandidates),
  });
}

interface AxisSummary {
  min: number;
  p50: number;
  p99: number;
  max: number;
}

function axisSummary(values: readonly number[]): AxisSummary {
  if (values.length === 0) return { min: 0, p50: 0, p99: 0, max: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  return {
    min: round2(sorted[0] ?? 0),
    p50: round2(percentile(sorted, 0.5)),
    p99: round2(percentile(sorted, 0.99)),
    max: round2(sorted[sorted.length - 1] ?? 0),
  };
}

function percentile(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.floor(sortedAsc.length * p));
  return sortedAsc[idx] ?? 0;
}
