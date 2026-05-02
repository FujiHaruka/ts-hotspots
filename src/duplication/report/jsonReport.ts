import type ts from "typescript";
import { TOOL_NAME } from "../../cli-defaults.ts";
import type { PerfLogger } from "../cli/perfLog.ts";
import type { Config } from "../config/config.ts";
import type { CandidateScore } from "../domain/candidate.ts";
import type { Fragment } from "../domain/fragment.ts";
import type {
  AnalysisSummary,
  CloneCandidateReport,
  DuplicationDiffInfo,
  ReportTool,
} from "../domain/report.ts";
import { isThinWrapperFragment } from "../features/internal/isThinWrapper.ts";
import { buildCloneGroups } from "./buildCloneGroups.ts";
import { buildCloneGroupsFromClusters } from "./buildCloneGroupsFromClusters.ts";
import { capPerFragmentPairs } from "./capPerFragmentPairs.ts";
import { type ClusterStats, clusterPairs } from "./clusterPairs.ts";
import { collapsePairs } from "./collapsePairs.ts";
import { dropLowSemanticEvidence } from "./dropLowSemanticEvidence.ts";
import { dropThinWrapperPairs } from "./dropThinWrapperPairs.ts";
import type { Intersections } from "./evidence.ts";
import { sortCandidates } from "./ranking.ts";

export interface ScoredPair {
  score: CandidateScore;
  changedFragment: Fragment;
  baseFragment: Fragment;
  intersections: Intersections;
}

export interface ReportInput {
  /**
   * Stamped onto the report's `tool` field so consumers can branch on
   * version. Defaults to a placeholder when omitted (suitable for tests
   * that ignore the field).
   */
  tool?: ReportTool;
  diff: DuplicationDiffInfo;
  pairs: readonly ScoredPair[];
  config: Config;
  summary: AnalysisSummary;
  /**
   * When `false`, fragment source is omitted from each group's
   * anchor/member views. Defaults to `true` so AI readers get actionable
   * context out of the box.
   */
  includeCode?: boolean;
  /**
   * Resolve a fragment's parsed `SourceFile`. The pipeline uses it to
   * judge whether a fragment is a "thin wrapper" before applying
   * `dropThinWrapperPairs`. When the hook is omitted (e.g. tests) or
   * returns `undefined`, the filter conservatively treats the fragment
   * as not-thin and the pair survives.
   */
  getSourceFile?: (filePath: string) => ts.SourceFile | undefined;
  /**
   * Map from project-relative POSIX path to the file's recent commit
   * count. Used to compute each group's churn-amplified ranking score
   * and to surface `aggregateChurn` metadata. When omitted (e.g.
   * `--no-churn`, non-git env, shallow clone), groups are sorted by
   * raw `combined.max` and `aggregateChurn` is left off the report.
   */
  churnByFile?: ReadonlyMap<string, number>;
}

/**
 * Materialise a `CloneCandidateReport` from a set of scored pairs.
 *
 * Pipeline:
 * 1. Deduplicate on the `(changedId, baseId)` tuple — defensive, since
 *    upstream is expected to emit each pair at most once.
 * 2. Drop pairs with no shared call or property access whose combined
 *    score sits below the medium-confidence floor — without semantic
 *    evidence the OR-based decision otherwise admits a lot of shape-only
 *    structural noise. See `dropLowSemanticEvidence`.
 * 3. Collapse cross-granularity echoes via `collapsePairs`: when a larger
 *    pair line-contains a smaller one on both sides, only the larger is
 *    retained. This trims the function/block/window redundancy emitted by
 *    M1 so one logical clone maps to one report candidate.
 * 4. Sort the remaining pairs with the deterministic ranking in
 *    `ranking.ts`.
 * 5. Cap each fragment's reported associates via `capPerFragmentPairs` so
 *    hot file-header windows and tiny structural blocks can't drag in a
 *    long tail of weak partners.
 * 6. Build `CloneGroup`s. Diff mode pivots on `changedFragment.id` via
 *    `buildCloneGroups`. Whole-repo mode hands the symmetric pair set to
 *    `clusterPairs` (graph clustering with edge prune → connected
 *    components → quasi-clique extraction → intra-cluster collapse) and
 *    converts each cluster via `buildCloneGroupsFromClusters`. The
 *    branch lives at the very end of the pipeline so every upstream
 *    filter (dedup, semantic-evidence drop, thin-wrapper drop, cap)
 *    runs identically in both modes.
 */
export function buildJsonReport(
  input: ReportInput,
  perfLog?: PerfLogger,
): CloneCandidateReport {
  const seen = new Set<string>();
  const unique: ScoredPair[] = [];
  for (const pair of input.pairs) {
    const key = `${pair.changedFragment.id}|${pair.baseFragment.id}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    unique.push(pair);
  }

  const semanticallyFiltered = dropLowSemanticEvidence(unique);
  const collapsed = collapsePairs(semanticallyFiltered);
  const isThinById = buildThinWrapperMap(collapsed, input);
  const thinFiltered = input.config.report.thinWrapper.enabled
    ? dropThinWrapperPairs(collapsed, isThinById)
    : collapsed;
  const sorted = sortCandidates(thinFiltered);
  const capped = capPerFragmentPairs(sorted);
  const includeCode = input.includeCode !== false;

  const useClusterPath =
    input.summary.mode === "whole-repo" && input.config.report.cluster.enabled;
  const clusterStats: ClusterStats | undefined =
    useClusterPath && perfLog !== undefined
      ? { components: 0, clusters: 0, droppedByDensity: 0 }
      : undefined;
  const groups = useClusterPath
    ? buildCloneGroupsFromClusters(
        clusterPairs(capped, input.config.report.cluster, clusterStats),
        input.config,
        includeCode,
        isThinById,
        input.churnByFile,
      )
    : buildCloneGroups(
        capped,
        input.config,
        includeCode,
        isThinById,
        input.churnByFile,
      );

  if (perfLog !== undefined) {
    perfLog.emit("report.summary", {
      before: { afterDecide: input.pairs.length },
      afterUnique: unique.length,
      dropLowSemanticEvidence: semanticallyFiltered.length,
      collapsePairs: collapsed.length,
      dropThinWrapperPairs: thinFiltered.length,
      capPerFragmentPairs: capped.length,
      reportedPairs: capped.length,
      reportedGroups: groups.length,
      ...(clusterStats !== undefined ? { cluster: clusterStats } : {}),
    });
  }

  return {
    status: "ok",
    tool: input.tool ?? { name: TOOL_NAME, version: "0.0.0" },
    diff: input.diff,
    summary: input.summary,
    groups,
  };
}

function buildThinWrapperMap(
  pairs: readonly ScoredPair[],
  input: ReportInput,
): ReadonlyMap<string, boolean> {
  const map = new Map<string, boolean>();
  if (
    !input.config.report.thinWrapper.enabled ||
    input.getSourceFile === undefined
  ) {
    return map;
  }
  const thinCfg = input.config.report.thinWrapper;
  const judge = (fragment: Fragment): void => {
    if (map.has(fragment.id)) return;
    const sourceFile = input.getSourceFile?.(fragment.filePath);
    if (sourceFile === undefined) {
      map.set(fragment.id, false);
      return;
    }
    map.set(fragment.id, isThinWrapperFragment(fragment, sourceFile, thinCfg));
  };
  for (const pair of pairs) {
    judge(pair.changedFragment);
    judge(pair.baseFragment);
  }
  return map;
}
