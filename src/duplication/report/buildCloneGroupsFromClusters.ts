import { hashText, membersToDupDismissalId } from "../../dismissal/hash.ts";
import type { Config } from "../config/config.ts";
import type {
  AggregateAxis,
  AggregateScores,
  CloneGroup,
  Fragment,
  FragmentView,
  GroupMember,
  RecommendationHint,
} from "../domain/index.ts";
import { buildLocation } from "../util/location.ts";
import { nonNull } from "../util/nonNull.ts";
import type { Cluster } from "./clusterPairs.ts";
import { buildEvidence } from "./evidence.ts";
import { intersectIntersections } from "./internal/intersectIntersections.ts";
import type { ScoredPair } from "./jsonReport.ts";
import { deriveHint } from "./recommendationHint.ts";

/**
 * Convert whole-repo `Cluster`s into `CloneGroup`s. Each cluster becomes
 * one anchor-less group: members are the cluster fragments in
 * fragmentId-asc order, aggregate scores summarise every pair in the
 * cluster, shared evidence is the intersection across every pair, and
 * the recommendation hint is derived from the weakest pair.
 *
 * Per-member `scores` / `evidence` carry the strongest pair the member
 * participates in within the cluster. Whole-repo has no privileged
 * direction, so this "best buddy" view gives each member a concrete
 * connection to display while leaving the cluster-level summary
 * (aggregateScores / sharedEvidence) to describe the whole.
 *
 * Group ordering: `aggregateScores.combined.max` desc → cluster size
 * desc → first member's id asc (lex). All ties are deterministic.
 */
export function buildCloneGroupsFromClusters(
  clusters: readonly Cluster[],
  config: Config,
  includeCode: boolean,
  isThinById: ReadonlyMap<string, boolean>,
): CloneGroup[] {
  const decorated: { firstId: string; group: CloneGroup }[] = [];
  for (const cluster of clusters) {
    if (cluster.fragments.length < 2 || cluster.pairs.length === 0) continue;
    const group = buildOneGroup(cluster, config, includeCode, isThinById);
    decorated.push({ firstId: nonNull(cluster.fragments[0]).id, group });
  }
  decorated.sort(compareDecorated);
  return decorated.map((d) => d.group);
}

function buildOneGroup(
  cluster: Cluster,
  config: Config,
  includeCode: boolean,
  isThinById: ReadonlyMap<string, boolean>,
): CloneGroup {
  const sortedFragments = [...cluster.fragments].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );

  // Per-member: pick the strongest pair involving the member so the
  // GroupMember.scores/evidence fields carry a concrete pair view rather
  // than fabricated "anchor" data. Ties broken by partner id asc.
  const strongestByMember = new Map<string, ScoredPair>();
  for (const pair of cluster.pairs) {
    record(
      strongestByMember,
      pair.changedFragment.id,
      pair,
      pair.baseFragment.id,
    );
    record(
      strongestByMember,
      pair.baseFragment.id,
      pair,
      pair.changedFragment.id,
    );
  }

  const members: GroupMember[] = sortedFragments.map((fragment) => {
    const best = strongestByMember.get(fragment.id);
    if (best === undefined) {
      // Defensive: every member should appear in at least one pair, but if
      // a stray fragment slipped through carry zeroed scores instead of
      // throwing — clusters are best-effort and a missing pair shouldn't
      // crash the report.
      return {
        fragment: fragmentView(fragment, includeCode),
        scores: {
          combined: 0,
          tokenOverlap: 0,
          statementKindSimilarity: 0,
          callOverlap: 0,
          sizeCompatibility: 0,
          lengthScore: 0,
        },
        evidence: buildEvidence(
          { tokens: [], statements: [], calls: [] },
          config,
        ),
      };
    }
    return {
      fragment: fragmentView(fragment, includeCode),
      scores: {
        combined: best.score.combined,
        tokenOverlap: best.score.breakdown.tokenOverlap,
        statementKindSimilarity: best.score.breakdown.statementKindSimilarity,
        callOverlap: best.score.breakdown.callOverlap,
        sizeCompatibility: best.score.breakdown.sizeCompatibility,
        lengthScore: best.score.breakdown.lengthScore,
      },
      evidence: buildEvidence(best.intersections, config),
    };
  });

  const aggregateScores = aggregate(cluster.pairs);
  const sharedEvidence = buildEvidence(
    intersectIntersections(cluster.pairs.map((p) => p.intersections)),
    config,
  );

  const weakest = pickWeakestPair(cluster.pairs);
  const anyThin = sortedFragments.some((f) => isThinById.get(f.id) === true);
  const recommendationHint: RecommendationHint = deriveHint({
    score: weakest.score,
    evidence: buildEvidence(weakest.intersections, config),
    changed: weakest.changedFragment,
    base: weakest.baseFragment,
    thresholds: config.scoring.thresholds,
    // No anchor / member distinction in whole-repo mode — feed the OR
    // across every cluster member into both sides so the XOR check inside
    // `deriveHint` is symmetric.
    changedIsThinWrapper: anyThin,
    baseIsThinWrapper: anyThin,
  });

  const memberHashes = sortedFragments.map((f) => hashText(f.text));
  const dismissalId = membersToDupDismissalId(memberHashes);

  return {
    dismissalId,
    members,
    size: members.length,
    aggregateScores,
    sharedEvidence,
    recommendationHint,
  };
}

function record(
  map: Map<string, ScoredPair>,
  memberId: string,
  pair: ScoredPair,
  partnerId: string,
): void {
  const existing = map.get(memberId);
  if (existing === undefined) {
    map.set(memberId, pair);
    return;
  }
  if (pair.score.combined > existing.score.combined) {
    map.set(memberId, pair);
    return;
  }
  if (pair.score.combined === existing.score.combined) {
    const existingPartner =
      existing.changedFragment.id === memberId
        ? existing.baseFragment.id
        : existing.changedFragment.id;
    if (partnerId < existingPartner) {
      map.set(memberId, pair);
    }
  }
}

function pickWeakestPair(pairs: readonly ScoredPair[]): ScoredPair {
  let weakest = nonNull(pairs[0]);
  for (let i = 1; i < pairs.length; i++) {
    const candidate = nonNull(pairs[i]);
    if (candidate.score.combined < weakest.score.combined) {
      weakest = candidate;
      continue;
    }
    if (candidate.score.combined === weakest.score.combined) {
      const candidateKey = canonicalEdgeKey(
        candidate.changedFragment.id,
        candidate.baseFragment.id,
      );
      const weakestKey = canonicalEdgeKey(
        weakest.changedFragment.id,
        weakest.baseFragment.id,
      );
      if (candidateKey < weakestKey) weakest = candidate;
    }
  }
  return weakest;
}

function canonicalEdgeKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function aggregate(pairs: readonly ScoredPair[]): AggregateScores {
  const combined: number[] = [];
  const token: number[] = [];
  const statement: number[] = [];
  const call: number[] = [];
  for (const pair of pairs) {
    combined.push(pair.score.combined);
    token.push(pair.score.breakdown.tokenOverlap);
    statement.push(pair.score.breakdown.statementKindSimilarity);
    call.push(pair.score.breakdown.callOverlap);
  }
  return {
    combined: axis(combined),
    tokenOverlap: axis(token),
    statementKindSimilarity: axis(statement),
    callOverlap: axis(call),
  };
}

function axis(values: readonly number[]): AggregateAxis {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const min = sorted[0] ?? 0;
  const max = sorted[n - 1] ?? 0;
  let median = 0;
  if (n > 0) {
    if (n % 2 === 1) {
      median = nonNull(sorted[(n - 1) / 2]);
    } else {
      const lo = nonNull(sorted[n / 2 - 1]);
      const hi = nonNull(sorted[n / 2]);
      median = (lo + hi) / 2;
    }
  }
  return { min, median, max };
}

function compareDecorated(
  a: { firstId: string; group: CloneGroup },
  b: { firstId: string; group: CloneGroup },
): number {
  const ax = a.group.aggregateScores.combined.max;
  const bx = b.group.aggregateScores.combined.max;
  if (ax !== bx) return bx - ax;
  if (a.group.size !== b.group.size) return b.group.size - a.group.size;
  if (a.firstId === b.firstId) return 0;
  return a.firstId < b.firstId ? -1 : 1;
}

function fragmentView(f: Fragment, includeCode: boolean): FragmentView {
  const view: FragmentView = {
    location: buildLocation(f.filePath, f.startLine, f.endLine),
    kind: f.kind,
  };
  if (includeCode) view.code = f.text;
  return view;
}
