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
import { nonNull } from "../util/nonNull.ts";
import { buildEvidence } from "./evidence.ts";
import { intersectIntersections } from "./internal/intersectIntersections.ts";
import type { ScoredPair } from "./jsonReport.ts";
import { deriveHint } from "./recommendationHint.ts";

/**
 * Pivot scored pairs by `changedFragment.id` to form clone groups.
 *
 * Each unique changed fragment becomes a group whose `anchor` is the
 * changed fragment itself and whose `members` are every base fragment that
 * paired with it. `aggregateScores`, `sharedEvidence`, and a group-level
 * `recommendationHint` are computed from the per-pair scores / evidence.
 *
 * Pair ordering (within a group's members) and group ordering across the
 * returned array are both fully deterministic.
 */
export function buildCloneGroups(
  pairs: readonly ScoredPair[],
  config: Config,
  includeCode: boolean,
  isThinById: ReadonlyMap<string, boolean>,
): CloneGroup[] {
  // Bucket pairs by changedFragment.id, preserving the input order so
  // members within a group inherit the upstream ranking before the
  // explicit member sort below.
  const buckets = new Map<string, ScoredPair[]>();
  for (const pair of pairs) {
    const id = pair.changedFragment.id;
    let bucket = buckets.get(id);
    if (bucket === undefined) {
      bucket = [];
      buckets.set(id, bucket);
    }
    bucket.push(pair);
  }

  const decorated: { anchorId: string; group: CloneGroup }[] = [];
  for (const [anchorId, bucket] of buckets) {
    if (bucket.length === 0) continue;
    decorated.push({
      anchorId,
      group: buildGroup(bucket, config, includeCode, isThinById),
    });
  }

  decorated.sort(compareDecorated);
  return decorated.map((d) => d.group);
}

function buildGroup(
  bucket: readonly ScoredPair[],
  config: Config,
  includeCode: boolean,
  isThinById: ReadonlyMap<string, boolean>,
): CloneGroup {
  const anchorPair = nonNull(bucket[0]);
  const anchor = fragmentView(anchorPair.changedFragment, includeCode);

  const members: GroupMember[] = bucket.map((pair) => ({
    fragment: fragmentView(pair.baseFragment, includeCode),
    scores: {
      combined: pair.score.combined,
      tokenOverlap: pair.score.breakdown.tokenOverlap,
      statementKindSimilarity: pair.score.breakdown.statementKindSimilarity,
      callOverlap: pair.score.breakdown.callOverlap,
      sizeCompatibility: pair.score.breakdown.sizeCompatibility,
      lengthScore: pair.score.breakdown.lengthScore,
    },
    evidence: buildEvidence(pair.intersections, config),
  }));

  // baseFragment id is preserved alongside the pair via a parallel array so
  // the member sort is deterministic without exposing fragment ids on the
  // public schema.
  const memberOrder = bucket.map((pair, idx) => ({ pair, idx }));
  memberOrder.sort((a, b) => {
    if (a.pair.score.combined !== b.pair.score.combined) {
      return b.pair.score.combined - a.pair.score.combined;
    }
    return a.pair.baseFragment.id < b.pair.baseFragment.id ? -1 : 1;
  });
  const sortedMembers = memberOrder.map(({ idx }) => nonNull(members[idx]));
  const sortedBucket = memberOrder.map(({ pair }) => pair);

  const aggregateScores = aggregate(sortedBucket);
  const sharedEvidence = buildEvidence(
    intersectIntersections(sortedBucket.map((p) => p.intersections)),
    config,
  );

  // Pick the weakest pair (lowest combined; lex-smallest baseFragment.id
  // wins ties so the choice is deterministic) and derive the group's hint
  // from it. Thin-wrapper flags are OR-aggregated across the anchor and
  // every member so an XOR triggers `thin-wrapper-side` regardless of
  // which member ends up weakest.
  const weakestPair = pickWeakest(sortedBucket);
  const anchorIsThin = isThinById.get(anchorPair.changedFragment.id) ?? false;
  let anyMemberIsThin = false;
  for (const pair of sortedBucket) {
    if (isThinById.get(pair.baseFragment.id) === true) {
      anyMemberIsThin = true;
      break;
    }
  }
  const recommendationHint: RecommendationHint = deriveHint({
    score: weakestPair.score,
    evidence: buildEvidence(weakestPair.intersections, config),
    changed: weakestPair.changedFragment,
    base: weakestPair.baseFragment,
    thresholds: config.scoring.thresholds,
    changedIsThinWrapper: anchorIsThin,
    baseIsThinWrapper: anyMemberIsThin,
  });

  return {
    anchor,
    members: sortedMembers,
    size: 1 + sortedMembers.length,
    aggregateScores,
    sharedEvidence,
    recommendationHint,
  };
}

function pickWeakest(bucket: readonly ScoredPair[]): ScoredPair {
  let weakest = nonNull(bucket[0]);
  for (let i = 1; i < bucket.length; i++) {
    const candidate = nonNull(bucket[i]);
    if (candidate.score.combined < weakest.score.combined) {
      weakest = candidate;
      continue;
    }
    if (
      candidate.score.combined === weakest.score.combined &&
      candidate.baseFragment.id < weakest.baseFragment.id
    ) {
      weakest = candidate;
    }
  }
  return weakest;
}

function aggregate(bucket: readonly ScoredPair[]): AggregateScores {
  const combined: number[] = [];
  const token: number[] = [];
  const statement: number[] = [];
  const call: number[] = [];
  for (const pair of bucket) {
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
  a: { anchorId: string; group: CloneGroup },
  b: { anchorId: string; group: CloneGroup },
): number {
  const ax = a.group.aggregateScores.combined.max;
  const bx = b.group.aggregateScores.combined.max;
  if (ax !== bx) return bx - ax;
  if (a.group.members.length !== b.group.members.length) {
    return b.group.members.length - a.group.members.length;
  }
  if (a.anchorId === b.anchorId) return 0;
  return a.anchorId < b.anchorId ? -1 : 1;
}

function fragmentView(f: Fragment, includeCode: boolean): FragmentView {
  const view: FragmentView = {
    filePath: f.filePath,
    startLine: f.startLine,
    endLine: f.endLine,
    kind: f.kind,
  };
  if (includeCode) {
    view.code = f.text;
  }
  return view;
}
