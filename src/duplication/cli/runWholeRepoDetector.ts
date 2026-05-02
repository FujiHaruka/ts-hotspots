import { performance } from "node:perf_hooks";
import { collectChurn } from "../../collectors/churn/commit-count.ts";
import type { Config } from "../config/index.ts";
import { resolveSha } from "../diff/gitRunner.ts";
import type {
  CloneCandidateReport,
  Fragment,
  ReportTool,
  ScopeStats,
} from "../domain/index.ts";
import {
  buildInvertedIndex,
  buildLshIndex,
  type LshIndexInput,
} from "../index_/index.ts";
import { buildBaseIndex } from "../indexer/index.ts";
import { buildJsonReport, type ScoredPair } from "../report/index.ts";
import {
  buildIntersectionsFromSets,
  type FragmentFeatureSets,
  meetsMinSize,
  scoreCandidateFromSets,
  shouldReport,
} from "../scoring/index.ts";
import {
  isSameFileOverlap,
  type SearchStats,
  searchCandidates,
} from "../search/index.ts";
import { countLines, listBaseSources } from "./listBaseSources.ts";
import type { PerfLogger } from "./perfLog.ts";
import {
  emitDecideSummary,
  emitFragmentsStats,
  emitIndexStats,
  emitLshSummary,
  emitLshUnion,
  emitPairsDedup,
  emitPhaseEnd,
  emitPhaseStart,
  emitScoringSummary,
  emitSearchSummary,
  newPerHitTracker,
  type PerHitTracker,
  recordPassReasons,
} from "./perfLogEvents.ts";
import type { ChurnRunOptions } from "./runDetector.ts";

export interface WholeRepoOptions {
  repoPath: string;
  /** Commit/branch/tag to scan. Resolved with `git rev-parse`. */
  ref: string;
  config: Config;
  /**
   * Optional perf-debug logger. When provided, the pipeline emits structured
   * timing / distribution events to it. When omitted, the hot path is free
   * of `performance.now()` calls and event allocations.
   */
  perfLog?: PerfLogger;
  /**
   * Forwarded to `buildJsonReport`. When `false`, fragment source is omitted
   * from the report. Defaults to `true`.
   */
  includeCode?: boolean;
  /** Stamped onto the report's `tool` envelope. */
  tool?: ReportTool;
  /** See `RunOptions.churn`. */
  churn?: ChurnRunOptions;
}

/**
 * All-pairs duplication scan over a single ref.
 *
 * Builds the same indexer / feature pipeline as `runDetector`, then routes
 * candidate generation through one of two strategies selected by
 * `config.search.wholeRepoCandidateGenerator`:
 *
 * - `inverted-index` (legacy): treat every fragment as a query, walk the
 *   inverted index per fragment. Quadratic in fragment count — only
 *   practical at a few thousand fragments.
 * - `lsh`: MinHash + locality-sensitive hashing on the token feature set.
 *   Sub-quadratic; trades recall for throughput. Suitable for repo-scale.
 *
 * Symmetric pairs `(a, b)` / `(b, a)` are deduplicated by a canonical key
 * (lex-smaller fragment id first). Self-matches are dropped.
 *
 * The resulting report uses the same `CloneCandidateReport` schema as the
 * PR-mode runner. `pr.baseSha` and `pr.headSha` are both set to the
 * scanned ref's sha — consumers that key off the schema keep working,
 * and the equality of the two fields documents that no diff was involved.
 */
export async function runWholeRepoDetector(
  opts: WholeRepoOptions,
): Promise<CloneCandidateReport> {
  const { repoPath, ref, config, perfLog, includeCode, tool, churn } = opts;
  const now: () => number =
    perfLog !== undefined ? () => performance.now() : () => 0;

  let t0 = now();
  emitPhaseStart(perfLog, "diff");
  const sha = await resolveSha(repoPath, ref);
  emitPhaseEnd(perfLog, "diff", now() - t0);

  t0 = now();
  emitPhaseStart(perfLog, "listBase");
  const sourceList = await listBaseSources(repoPath, sha, config);
  const sources = sourceList.sources;
  let totalLines = 0;
  for (const source of sources) totalLines += countLines(source.text);
  emitPhaseEnd(perfLog, "listBase", now() - t0);

  let churnByFile: ReadonlyMap<string, number> | undefined;
  if (churn !== undefined) {
    t0 = now();
    emitPhaseStart(perfLog, "churn");
    churnByFile = collectChurn({
      rootDir: repoPath,
      files: sources.map((s) => ({ path: s.path })),
      window: churn.window,
      ref: churn.ref,
      onWarning: churn.onWarning,
    });
    emitPhaseEnd(perfLog, "churn", now() - t0);
  }

  t0 = now();
  emitPhaseStart(perfLog, "baseIndex");
  // Drive parse + fragment extraction + per-fragment feature work in a
  // worker pool. The thin-wrapper judgement is computed alongside since
  // the worker already has the `ts.SourceFile` in scope — that lets the
  // main thread skip persisting `sourceFileByPath` entirely.
  const baseIndexResult = await buildBaseIndex(sources, config, {
    thinWrapperEnabled: config.report.thinWrapper.enabled,
  });
  const {
    entries,
    featureSetsById,
    thinWrapperByFragmentId,
    fragmentsByKind,
    fragmentsPerFile,
  } = baseIndexResult;

  // The inverted index is only consumed by the legacy candidate generator.
  // Skip the build (and the per-key Map allocations) when LSH is in charge.
  const generator = config.search.wholeRepoCandidateGenerator;
  const useLsh = generator === "lsh";
  const invertedIndex = useLsh ? null : buildInvertedIndex(entries);
  emitPhaseEnd(perfLog, "baseIndex", now() - t0);

  if (invertedIndex !== null) {
    emitIndexStats(perfLog, invertedIndex, entries.length);
  }
  emitFragmentsStats(
    perfLog,
    entries.length,
    fragmentsByKind,
    fragmentsPerFile,
  );

  t0 = now();
  emitPhaseStart(perfLog, "headSearch");
  const tracker = newPerHitTracker();
  const scoredPairs: ScoredPair[] = [];

  // Intern fragmentIds to integer indices so the cross-axis dedup Set
  // and the per-pair lookups in `scoreOne` operate on integers rather
  // than strings. The infoByIndex array is sorted lex by fragmentId so
  // that numeric `(lo, hi)` pair canonicalization matches the legacy
  // lex canonical contract (downstream code that pivots on
  // `changedFragment.id < baseFragment.id` keeps working unchanged).
  interface FragmentInfo {
    readonly fragment: Fragment;
    readonly sets: FragmentFeatureSets;
  }
  const infoByIndex: FragmentInfo[] = [];
  for (const { fragment } of entries) {
    const sets = featureSetsById.get(fragment.id);
    if (sets === undefined) continue;
    infoByIndex.push({ fragment, sets });
  }
  infoByIndex.sort((a, b) =>
    a.fragment.id < b.fragment.id ? -1 : a.fragment.id > b.fragment.id ? 1 : 0,
  );
  const fragmentIndexById = new Map<string, number>();
  for (let i = 0; i < infoByIndex.length; i++) {
    const info = infoByIndex[i];
    if (info === undefined) continue;
    fragmentIndexById.set(info.fragment.id, i);
  }
  const fragmentIndexCount = infoByIndex.length;
  const stride = fragmentIndexCount + 1;
  const seenPairIds = new Set<number>();

  /** Score one candidate pair and, if it passes, push it into `scoredPairs`. */
  const scoreOneByInfo = (aInfo: FragmentInfo, bInfo: FragmentInfo): void => {
    if (
      !meetsMinSize(
        aInfo.fragment,
        bInfo.fragment,
        config.scoring.thresholds.minLines,
      )
    ) {
      return;
    }

    const tsc = now();
    const score = scoreCandidateFromSets(
      {
        candidate: {
          changedFragmentId: aInfo.fragment.id,
          baseFragmentId: bInfo.fragment.id,
          // hitCounts is an internal ranking signal used only by the
          // inverted-index candidate sort. Downstream scoring / decide /
          // report don't read it, so zero-fill in the LSH path.
          hitCounts: { token: 0, statement: 0, call: 0 },
        },
        changedFragment: aInfo.fragment,
        baseFragment: bInfo.fragment,
        changedFeatureSets: aInfo.sets,
        baseFeatureSets: bInfo.sets,
      },
      config,
    );
    tracker.tScore += now() - tsc;
    tracker.scored += 1;

    const td = now();
    const ok = shouldReport(
      score,
      config.scoring.thresholds,
      config.features.enabled,
    );
    tracker.tDecide += now() - td;

    if (perfLog !== undefined) {
      tracker.axisToken.push(score.breakdown.tokenOverlap);
      tracker.axisStatement.push(score.breakdown.statementKindSimilarity);
      tracker.axisCall.push(score.breakdown.callOverlap);
      tracker.axisSize.push(score.breakdown.sizeCompatibility);
      tracker.axisCombined.push(score.combined);
      if (ok) {
        tracker.passed += 1;
        recordPassReasons(
          tracker,
          score,
          config.scoring.thresholds,
          config.features.enabled,
        );
      }
    }

    if (!ok) return;
    const intersections = buildIntersectionsFromSets(aInfo.sets, bInfo.sets);
    if (perfLog !== undefined) {
      tracker.intersectionTokens.push(intersections.tokens.length);
      tracker.intersectionStatements.push(intersections.statements.length);
      tracker.intersectionCalls.push(intersections.calls.length);
    }
    scoredPairs.push({
      score,
      changedFragment: aInfo.fragment,
      baseFragment: bInfo.fragment,
      intersections,
    });
  };

  /**
   * String-id facade over `scoreOneByInfo` for the legacy inverted-index
   * candidate path, which still hands out string id pairs.
   */
  const scoreOneByIds = (aId: string, bId: string): void => {
    const aIdx = fragmentIndexById.get(aId);
    const bIdx = fragmentIndexById.get(bId);
    if (aIdx === undefined || bIdx === undefined) return;
    const aInfo = infoByIndex[aIdx];
    const bInfo = infoByIndex[bIdx];
    if (aInfo === undefined || bInfo === undefined) return;
    scoreOneByInfo(aInfo, bInfo);
  };

  let candidatePairs = 0;

  if (useLsh) {
    candidatePairs = runLshCandidateGeneration(
      infoByIndex,
      stride,
      seenPairIds,
      config,
      perfLog,
      now,
      tracker,
      scoreOneByInfo,
    );
  } else {
    if (invertedIndex === null) {
      // Defensive: branch already guarded above, but the type system needs
      // the explicit non-null assertion.
      throw new Error("invertedIndex unexpectedly null in legacy path");
    }
    const searchStats: SearchStats | undefined =
      perfLog !== undefined
        ? {
            uniqueKeys: { token: 0, statement: 0, call: 0 },
            postingsHit: 0,
            preCapCandidates: 0,
            truncatedAtCap: false,
          }
        : undefined;

    for (const { fragment, features } of entries) {
      const ts = now();
      const candidates = searchCandidates(
        fragment,
        features,
        invertedIndex,
        config,
        searchStats,
      );
      tracker.tSearch += now() - ts;
      tracker.queries += 1;
      if (searchStats !== undefined) {
        tracker.preCapList.push(searchStats.preCapCandidates);
        if (searchStats.truncatedAtCap) tracker.atCapCount += 1;
      }
      candidatePairs += candidates.length;

      for (const candidate of candidates) {
        const otherId = candidate.baseFragmentId;
        const aId = fragment.id < otherId ? fragment.id : otherId;
        const bId = fragment.id < otherId ? otherId : fragment.id;
        const aIdx = fragmentIndexById.get(aId);
        const bIdx = fragmentIndexById.get(bId);
        if (aIdx === undefined || bIdx === undefined) continue;
        const lo = aIdx < bIdx ? aIdx : bIdx;
        const hi = aIdx < bIdx ? bIdx : aIdx;
        const key = lo * stride + hi;
        if (seenPairIds.has(key)) continue;
        seenPairIds.add(key);
        scoreOneByIds(aId, bId);
      }
    }
  }
  const tHeadSearch = now() - t0;
  emitPhaseEnd(perfLog, "headSearch", tHeadSearch);

  if (!useLsh) {
    emitSearchSummary(
      perfLog,
      tracker.queries,
      tracker.tSearch,
      tracker.preCapList,
      config.search.maxCandidatesPerFragment,
      tracker.atCapCount,
    );
  }
  // Both paths dedup pairs via `seenPairIds` (numeric packed (lo, hi)
  // index keys) — legacy at canonical-key construction, LSH at
  // axis-union time. `candidatePairs` is the **post-dedup** count for
  // LSH mode (unionPairs) and the **pre-dedup** raw count for legacy.
  const uniquePairs = seenPairIds.size;
  emitScoringSummary(perfLog, candidatePairs, uniquePairs, tracker);
  emitDecideSummary(perfLog, tracker);
  emitPairsDedup(perfLog, candidatePairs, uniquePairs);

  const repoScope: ScopeStats = {
    files: sources.length,
    lines: totalLines,
    fragments: entries.length,
    fragmentsByKind,
    excludedFiles: sourceList.excludedCount,
  };

  t0 = now();
  emitPhaseStart(perfLog, "report");
  const report: CloneCandidateReport = buildJsonReport(
    {
      tool,
      diff: { baseSha: sha, headSha: sha, threeDot: false, changedFiles: 0 },
      pairs: scoredPairs,
      config,
      summary: {
        mode: "whole-repo",
        scope: { base: repoScope },
        pipeline: {
          candidatePairs,
          reportedPairs: scoredPairs.length,
        },
      },
      includeCode,
      isThinFragmentById: thinWrapperByFragmentId,
      churnByFile,
    },
    perfLog,
  );
  emitPhaseEnd(perfLog, "report", now() - t0);

  return report;
}

/**
 * MinHash + LSH candidate generation, multi-axis.
 *
 * For each axis enabled in `config.search.lsh.{token,call,…}`:
 *   1. Build a per-axis `LshIndexInput[]` from the fragments' feature sets.
 *   2. Build an LSH index using that axis's params.
 *   3. Iterate the index's candidate pairs.
 *
 * Pairs are unioned across axes via the runner-level `seenPairIds` Set
 * (numeric packed (lo, hi) index key) — `forEachCandidatePair` only
 * dedups within a single index, so a pair that collides on both token
 * and call axes would otherwise be scored twice. The first axis to
 * surface a pair "wins" (drives the scoring call); later axes that
 * collide on the same pair are no-ops.
 *
 * Returns the **union** candidate-pair count for downstream stats.
 */
function runLshCandidateGeneration<
  TInfo extends { fragment: Fragment; sets: FragmentFeatureSets },
>(
  infoByIndex: readonly TInfo[],
  stride: number,
  seenPairIds: Set<number>,
  config: Config,
  perfLog: PerfLogger | undefined,
  now: () => number,
  tracker: PerHitTracker,
  scoreOneByInfo: (a: TInfo, b: TInfo) => void,
): number {
  interface Axis {
    name: "token" | "call" | "statement";
    pickFeatures: (s: FragmentFeatureSets) => ReadonlySet<string>;
  }
  const AXES: Axis[] = [
    { name: "token", pickFeatures: (s) => s.tokens },
    { name: "call", pickFeatures: (s) => s.calls },
    { name: "statement", pickFeatures: (s) => s.statements },
  ];

  const axisPairCounts: Record<string, number> = {};
  let unionPairs = 0;
  let totalBuildWall = 0;

  for (const axis of AXES) {
    const axisCfg = config.search.lsh[axis.name];
    if (!axisCfg.enabled) continue;

    const lshInputs: LshIndexInput[] = [];
    for (let i = 0; i < infoByIndex.length; i++) {
      const info = infoByIndex[i];
      if (info === undefined) continue;
      lshInputs.push({
        fragmentId: i,
        features: axis.pickFeatures(info.sets),
      });
    }

    const ts = now();
    const lsh = buildLshIndex(lshInputs, axisCfg);
    const buildWall = now() - ts;
    totalBuildWall += buildWall;

    // Pairs surfaced by THIS axis (before union dedup). The visitor
    // receives `(lo, hi)` numeric indices directly — no string round
    // trip — so the per-pair cost is just two array lookups + a
    // packed-key Set probe.
    let axisCount = 0;
    lsh.forEachCandidatePair((lo, hi) => {
      const aInfo = infoByIndex[lo];
      const bInfo = infoByIndex[hi];
      if (aInfo === undefined || bInfo === undefined) return;
      if (isSameFileOverlap(aInfo.fragment, bInfo.fragment)) return;
      axisCount += 1;
      const key = lo * stride + hi;
      if (seenPairIds.has(key)) return;
      seenPairIds.add(key);
      unionPairs += 1;
      scoreOneByInfo(aInfo, bInfo);
    });
    axisPairCounts[axis.name] = axisCount;

    emitLshSummary(
      perfLog,
      axis.name,
      axisCfg,
      lsh.stats,
      infoByIndex.length,
      axisCount,
      buildWall,
    );
  }

  tracker.tSearch += totalBuildWall;
  emitLshUnion(perfLog, axisPairCounts, unionPairs);
  return unionPairs;
}
