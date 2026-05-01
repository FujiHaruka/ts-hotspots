import { performance } from "node:perf_hooks";
import type ts from "typescript";
import type { Config } from "../config/index.ts";
import { resolveSha } from "../diff/gitRunner.ts";
import type {
  CloneCandidateReport,
  Fragment,
  ReportTool,
  ScopeStats,
} from "../domain/index.ts";
import { buildFileFeatureContext, extractFeatures } from "../features/index.ts";
import {
  buildInvertedIndex,
  buildLshIndex,
  type IndexInput,
  type LshIndexInput,
} from "../index_/index.ts";
import { extractFragments, parseSource } from "../indexer/index.ts";
import { buildJsonReport, type ScoredPair } from "../report/index.ts";
import {
  buildFeatureSets,
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
  const { repoPath, ref, config, perfLog, includeCode, tool } = opts;
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

  t0 = now();
  emitPhaseStart(perfLog, "baseIndex");
  const entries: IndexInput[] = [];
  const fragmentById = new Map<string, Fragment>();
  const featureSetsById = new Map<string, FragmentFeatureSets>();
  const sourceFileByPath = new Map<string, ts.SourceFile>();
  const fragmentsByKind = { function: 0, block: 0, window: 0 };
  const fragmentsPerFile: number[] = [];

  for (const source of sources) {
    const parsed = parseSource(source.path, source.text);
    sourceFileByPath.set(source.path, parsed.sourceFile);
    const fragments = extractFragments(parsed, config);
    fragmentsPerFile.push(fragments.length);
    // Build per-file context once and share across every fragment of this
    // file — keeps `extractFeatures` from rebuilding type/regex ranges
    // (full-AST walks) per fragment.
    const fileCtx = buildFileFeatureContext(parsed.sourceFile);
    for (const fragment of fragments) {
      fragmentsByKind[fragment.kind] += 1;
      const features = extractFeatures(
        fragment,
        parsed.sourceFile,
        config,
        fileCtx,
      );
      entries.push({ fragment, features });
      fragmentById.set(fragment.id, fragment);
      featureSetsById.set(fragment.id, buildFeatureSets(features));
    }
  }

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
  const seenPairs = new Set<string>();
  const scoredPairs: ScoredPair[] = [];

  /** Score one candidate pair and, if it passes, push it into `scoredPairs`. */
  const scoreOne = (aId: string, bId: string): void => {
    const aFragment = fragmentById.get(aId);
    const bFragment = fragmentById.get(bId);
    const aSets = featureSetsById.get(aId);
    const bSets = featureSetsById.get(bId);
    if (
      aFragment === undefined ||
      bFragment === undefined ||
      aSets === undefined ||
      bSets === undefined
    ) {
      return;
    }
    if (
      !meetsMinSize(aFragment, bFragment, config.scoring.thresholds.minLines)
    ) {
      return;
    }

    const tsc = now();
    const score = scoreCandidateFromSets(
      {
        candidate: {
          changedFragmentId: aId,
          baseFragmentId: bId,
          // hitCounts is an internal ranking signal used only by the
          // inverted-index candidate sort. Downstream scoring / decide /
          // report don't read it, so zero-fill in the LSH path.
          hitCounts: { token: 0, statement: 0, call: 0 },
        },
        changedFragment: aFragment,
        baseFragment: bFragment,
        changedFeatureSets: aSets,
        baseFeatureSets: bSets,
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
    const intersections = buildIntersectionsFromSets(aSets, bSets);
    if (perfLog !== undefined) {
      tracker.intersectionTokens.push(intersections.tokens.length);
      tracker.intersectionStatements.push(intersections.statements.length);
      tracker.intersectionCalls.push(intersections.calls.length);
    }
    scoredPairs.push({
      score,
      changedFragment: aFragment,
      baseFragment: bFragment,
      intersections,
    });
  };

  let candidatePairs = 0;

  if (useLsh) {
    candidatePairs = runLshCandidateGeneration(
      entries,
      fragmentById,
      featureSetsById,
      config,
      perfLog,
      now,
      tracker,
      scoreOne,
      seenPairs,
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
        const key = `${aId}|${bId}`;
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        scoreOne(aId, bId);
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
  // Both paths dedup pairs via `seenPairs` — legacy at canonical-key
  // construction, LSH at axis-union time. `candidatePairs` is the
  // **post-dedup** count for LSH mode (unionPairs) and the **pre-dedup**
  // raw count for legacy mode.
  const uniquePairs = seenPairs.size;
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
      pr: { baseSha: sha, headSha: sha, threeDot: false, changedFiles: 0 },
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
      getSourceFile: (filePath) => sourceFileByPath.get(filePath),
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
 * Pairs are unioned across axes via the runner-level `seenPairs` Set —
 * `forEachCandidatePair` only dedups within a single index, so a pair
 * that collides on both token and call axes would otherwise be scored
 * twice. The first axis to surface a pair "wins" (drives the scoring
 * call); later axes that collide on the same pair are no-ops.
 *
 * Returns the **union** candidate-pair count for downstream stats.
 */
function runLshCandidateGeneration(
  entries: readonly IndexInput[],
  fragmentById: ReadonlyMap<string, Fragment>,
  featureSetsById: ReadonlyMap<string, FragmentFeatureSets>,
  config: Config,
  perfLog: PerfLogger | undefined,
  now: () => number,
  tracker: PerHitTracker,
  scoreOne: (aId: string, bId: string) => void,
  seenPairs: Set<string>,
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
    for (const { fragment } of entries) {
      const sets = featureSetsById.get(fragment.id);
      if (sets === undefined) continue;
      lshInputs.push({
        fragmentId: fragment.id,
        features: axis.pickFeatures(sets),
      });
    }

    const ts = now();
    const lsh = buildLshIndex(lshInputs, axisCfg);
    const buildWall = now() - ts;
    totalBuildWall += buildWall;

    // Pairs surfaced by THIS axis (before union dedup).
    let axisCount = 0;
    lsh.forEachCandidatePair((a, b) => {
      // Drop same-file sliding-window siblings at search time, mirroring
      // the inverted-index path (`candidateSearch.ts#tally`). The LSH
      // index itself is keyed only by feature sets, so file/line
      // information lives in `fragmentById` — look both fragments up here
      // and skip overlapping pairs before they reach scoring or counts.
      const aFragment = fragmentById.get(a);
      const bFragment = fragmentById.get(b);
      if (
        aFragment !== undefined &&
        bFragment !== undefined &&
        isSameFileOverlap(aFragment, bFragment)
      ) {
        return;
      }
      axisCount += 1;
      const key = `${a}|${b}`;
      if (seenPairs.has(key)) return;
      seenPairs.add(key);
      unionPairs += 1;
      scoreOne(a, b);
    });
    axisPairCounts[axis.name] = axisCount;

    emitLshSummary(
      perfLog,
      axis.name,
      axisCfg,
      lsh.stats,
      entries.length,
      axisCount,
      buildWall,
    );
  }

  tracker.tSearch += totalBuildWall;
  emitLshUnion(perfLog, axisPairCounts, unionPairs);
  return unionPairs;
}
