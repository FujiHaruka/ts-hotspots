import { performance } from "node:perf_hooks";
import type ts from "typescript";
import { collectChurn } from "../../collectors/churn/commit-count.ts";
import { parseSource } from "../../parser/parseSource.ts";
import type { Config } from "../config/config.ts";
import { collectChangedFragments } from "../diff/pipeline.ts";
import type { Candidate } from "../domain/candidate.ts";
import type { Fragment } from "../domain/fragment.ts";
import type {
  CloneCandidateReport,
  ReportTool,
  ScopeStats,
} from "../domain/report.ts";
import { extractFeatures } from "../features/extractFeatures.ts";
import { buildFileFeatureContext } from "../features/fileContext.ts";
import {
  type FeatureKeyPool,
  internFeatureKeys,
} from "../features/internFeatureKeys.ts";
import { extractFragments } from "../indexer/extractFragments.ts";
import {
  buildInvertedIndex,
  type IndexInput,
} from "../lookup/invertedIndex.ts";
import {
  buildJsonReport,
  type FragmentSide,
  type ScoredPair,
} from "../report/jsonReport.ts";
import { shouldReport } from "../scoring/decide.ts";
import {
  buildFeatureSets,
  type FragmentFeatureSets,
} from "../scoring/featureSets.ts";
import { meetsMinSize } from "../scoring/minSize.ts";
import {
  buildIntersectionsFromSets,
  scoreCandidateFromSets,
} from "../scoring/scoreCandidate.ts";
import {
  type SearchStats,
  searchCandidates,
} from "../search/candidateSearch.ts";
import { countLines, listBaseSources } from "./listBaseSources.ts";
import type { PerfLogger } from "./perfLog.ts";
import {
  emitDecideSummary,
  emitFragmentsStats,
  emitIndexStats,
  emitPhaseEnd,
  emitPhaseStart,
  emitScoringSummary,
  emitSearchSummary,
  newPerHitTracker,
  recordPassReasons,
} from "./perfLogEvents.ts";

export interface ChurnRunOptions {
  /** Number of commits to walk via `git log` for per-file commit counts. */
  window: number;
  /**
   * Ref to walk. PR mode defaults to the head ref of the diff (so the
   * churn window matches the PR head); pass an explicit value to
   * override. Whole-repo mode passes the scan ref.
   */
  ref: string;
}

interface RunOptions {
  repoPath: string;
  baseRef: string;
  headRef: string;
  /** `true` for `A...B` (merge-base vs head). `false` for `A..B`. */
  threeDot: boolean;
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
  /**
   * Churn-collector wiring. Omitted (`undefined`) skips churn collection
   * entirely — group ranking falls back to raw `combined.max` and no
   * `aggregateChurn` is attached. Passed via `--no-churn`, non-git
   * environments, and tests that don't want git access.
   */
  churn?: ChurnRunOptions;
}

/**
 * End-to-end ts-dedup pipeline: diff → base index → candidate search →
 * re-score → report.
 *
 * The base-side codebase is read from the git object store (pinned to
 * `baseSha`) rather than the worktree, so repeated runs on an unchanged
 * commit pair are bit-identical.
 *
 * Kept as a pure function so E2E tests can exercise the full pipeline
 * without touching argv or the filesystem.
 */
export async function runDetector(
  opts: RunOptions,
): Promise<CloneCandidateReport> {
  const {
    repoPath,
    baseRef,
    headRef,
    threeDot,
    config,
    perfLog,
    includeCode,
    tool,
    churn,
  } = opts;
  const now: () => number =
    perfLog !== undefined ? () => performance.now() : () => 0;

  let t0 = now();
  emitPhaseStart(perfLog, "diff");
  const diff = await collectChangedFragments({
    repoPath,
    baseRef,
    headRef,
    threeDot,
    config,
  });
  emitPhaseEnd(perfLog, "diff", now() - t0);

  let changedLines = 0;
  for (const file of diff.files) changedLines += countLines(file.text);

  // ---- Base side: parse, extract fragments, extract features, build index.
  t0 = now();
  emitPhaseStart(perfLog, "listBase");
  const baseList = await listBaseSources(repoPath, diff.baseSha, config);
  const baseSources = baseList.sources;
  let baseLines = 0;
  for (const source of baseSources) baseLines += countLines(source.text);
  emitPhaseEnd(perfLog, "listBase", now() - t0);

  let churnByFile: ReadonlyMap<string, number> | undefined;
  if (churn !== undefined) {
    t0 = now();
    emitPhaseStart(perfLog, "churn");
    const fileSet = new Set<string>();
    for (const s of baseSources) fileSet.add(s.path);
    for (const f of diff.files) fileSet.add(f.filePath);
    churnByFile = collectChurn({
      rootDir: repoPath,
      files: [...fileSet].map((path) => ({ path })),
      window: churn.window,
      ref: churn.ref,
    });
    emitPhaseEnd(perfLog, "churn", now() - t0);
  }

  t0 = now();
  emitPhaseStart(perfLog, "baseIndex");
  const baseEntries: IndexInput[] = [];
  const baseEntryById = new Map<string, IndexInput>();
  const featureSetsById = new Map<string, FragmentFeatureSets>();
  const baseTextByPath = new Map<string, string>();
  const changedTextByPath = new Map<string, string>();
  const baseFragmentsByKind = { function: 0, block: 0, window: 0 };
  const fragmentsPerFile: number[] = [];
  const keyPool: FeatureKeyPool = new Map();

  for (const source of baseSources) {
    const parsed = parseSource(source.path, source.text);
    baseTextByPath.set(source.path, source.text);
    const fragments = extractFragments(parsed, config);
    fragmentsPerFile.push(fragments.length);
    // Build per-file context once and share across every fragment of this
    // file — keeps `extractFeatures` from rebuilding type/regex ranges
    // (full-AST walks) per fragment.
    const fileCtx = buildFileFeatureContext(parsed.sourceFile);
    for (const fragment of fragments) {
      baseFragmentsByKind[fragment.kind] += 1;
      const features = extractFeatures(
        fragment,
        parsed.sourceFile,
        config,
        fileCtx,
      );
      internFeatureKeys(features, keyPool);
      const entry = { fragment, features };
      baseEntries.push(entry);
      baseEntryById.set(fragment.id, entry);
    }
  }

  const index = buildInvertedIndex(baseEntries);
  emitPhaseEnd(perfLog, "baseIndex", now() - t0);

  emitIndexStats(perfLog, index, baseEntries.length);
  emitFragmentsStats(
    perfLog,
    baseEntries.length,
    baseFragmentsByKind,
    fragmentsPerFile,
  );

  // ---- Head side: for each changed fragment, search + re-score.
  t0 = now();
  emitPhaseStart(perfLog, "headSearch");
  let candidatePairs = 0;
  let changedFragments = 0;
  const changedFragmentsByKind = { function: 0, block: 0, window: 0 };
  const scoredPairs: ScoredPair[] = [];
  const tracker = newPerHitTracker();
  const searchStats: SearchStats | undefined =
    perfLog !== undefined
      ? {
          uniqueKeys: { token: 0, statement: 0, call: 0 },
          postingsHit: 0,
          preCapCandidates: 0,
          truncatedAtCap: false,
        }
      : undefined;

  /** Score one candidate pair and, if it passes, push it into `scoredPairs`. */
  const scoreOne = (
    changedFragment: Fragment,
    changedFeatureSets: FragmentFeatureSets,
    candidate: Candidate,
  ): void => {
    const baseEntry = baseEntryById.get(candidate.baseFragmentId);
    if (baseEntry === undefined) return;
    const baseFragment = baseEntry.fragment;
    let baseFeatureSets = featureSetsById.get(baseFragment.id);
    if (baseFeatureSets === undefined) {
      baseFeatureSets = buildFeatureSets(baseEntry.features);
      featureSetsById.set(baseFragment.id, baseFeatureSets);
    }
    if (
      !meetsMinSize(
        changedFragment,
        baseFragment,
        config.scoring.thresholds.minLines,
      )
    ) {
      return;
    }

    const tsc = now();
    const score = scoreCandidateFromSets(
      {
        candidate,
        changedFragment,
        baseFragment,
        changedFeatureSets,
        baseFeatureSets,
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
    const intersections = buildIntersectionsFromSets(
      changedFeatureSets,
      baseFeatureSets,
    );
    if (perfLog !== undefined) {
      tracker.intersectionTokens.push(intersections.tokens.length);
      tracker.intersectionStatements.push(intersections.statements.length);
      tracker.intersectionCalls.push(intersections.calls.length);
    }
    scoredPairs.push({
      score,
      changedFragment,
      baseFragment,
      intersections,
    });
  };

  for (const file of diff.files) {
    const frags = diff.fragmentsByFile.get(file.filePath) ?? [];
    if (frags.length === 0) continue;
    const parsed = parseSource(file.filePath, file.text);
    changedTextByPath.set(file.filePath, file.text);
    const fileCtx = buildFileFeatureContext(parsed.sourceFile);
    for (const changedFragment of frags) {
      changedFragments += 1;
      changedFragmentsByKind[changedFragment.kind] += 1;
      const changedFeatures = extractFeatures(
        changedFragment,
        parsed.sourceFile,
        config,
        fileCtx,
      );
      const changedFeatureSets = buildFeatureSets(changedFeatures);

      const ts = now();
      const candidates = searchCandidates(
        changedFragment,
        changedFeatures,
        index,
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
        scoreOne(changedFragment, changedFeatureSets, candidate);
      }
    }
  }
  const tHeadSearch = now() - t0;
  emitPhaseEnd(perfLog, "headSearch", tHeadSearch);

  emitSearchSummary(
    perfLog,
    tracker.queries,
    tracker.tSearch,
    tracker.preCapList,
    config.search.maxCandidatesPerFragment,
    tracker.atCapCount,
  );
  emitScoringSummary(perfLog, candidatePairs, candidatePairs, tracker);
  emitDecideSummary(perfLog, tracker);

  const baseScope: ScopeStats = {
    files: baseSources.length,
    lines: baseLines,
    fragments: baseEntries.length,
    fragmentsByKind: baseFragmentsByKind,
    excludedFiles: baseList.excludedCount,
  };
  const changedScope: ScopeStats = {
    files: diff.files.length,
    lines: changedLines,
    fragments: changedFragments,
    fragmentsByKind: changedFragmentsByKind,
    excludedFiles: diff.excludedFiles,
  };

  t0 = now();
  emitPhaseStart(perfLog, "report");
  const report = buildJsonReport(
    {
      tool,
      diff: {
        baseSha: diff.baseSha,
        headSha: diff.headSha,
        threeDot,
        changedFiles: diff.files.length,
      },
      pairs: scoredPairs,
      config,
      summary: {
        mode: "diff",
        scope: { base: baseScope, changed: changedScope },
        pipeline: {
          candidatePairs,
          reportedPairs: scoredPairs.length,
        },
      },
      includeCode,
      getSourceFile: lazySourceFiles({
        base: baseTextByPath,
        changed: changedTextByPath,
      }),
      churnByFile,
    },
    perfLog,
  );
  emitPhaseEnd(perfLog, "report", now() - t0);

  return report;
}

function lazySourceFiles(
  textByPath: Readonly<Record<FragmentSide, ReadonlyMap<string, string>>>,
): (filePath: string, side: FragmentSide) => ts.SourceFile | undefined {
  const cache: Record<FragmentSide, Map<string, ts.SourceFile>> = {
    base: new Map(),
    changed: new Map(),
  };
  return (filePath, side) => {
    const cached = cache[side].get(filePath);
    if (cached !== undefined) return cached;
    const text = textByPath[side].get(filePath);
    if (text === undefined) return undefined;
    const sourceFile = parseSource(filePath, text).sourceFile;
    cache[side].set(filePath, sourceFile);
    return sourceFile;
  };
}
