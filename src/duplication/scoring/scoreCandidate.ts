import type { Config } from "../config/config.ts";
import type { Candidate, CandidateScore } from "../domain/candidate.ts";
import { type Fragment, fragmentLineCount } from "../domain/fragment.ts";
import { combinedScore } from "./combinedScore.ts";
import type { FragmentFeatureSets } from "./featureSets.ts";
import {
  intersectionSorted,
  jaccardCount,
} from "./internal/jaccardWithIntersection.ts";
import { lengthScore } from "./lengthScore.ts";
import { sizeCompatibility } from "./sizeCompatibility.ts";

/**
 * Blend Jaccard with `alpha * overlapCoefficient` when both fragments are
 * long enough. Returns the larger of the two so a high Jaccard never gets
 * demoted by the blend.
 *
 * For shorter pairs we fall back to plain Jaccard — the overlap-coef on a
 * 3-key set saturates to 1 from 1-2 shared keys, which would flood the
 * report with noise.
 */
function blendSimilarity(
  jaccard: number,
  overlapCoefficient: number,
  useContainment: boolean,
  alpha: number,
): number {
  if (!useContainment) return jaccard;
  const blended = alpha * overlapCoefficient;
  return blended > jaccard ? blended : jaccard;
}

function shouldUseContainment(
  changed: Fragment,
  base: Fragment,
  cfg: Config["scoring"]["containment"],
): boolean {
  if (!cfg.enabled) return false;
  return (
    Math.min(fragmentLineCount(changed), fragmentLineCount(base)) >=
    cfg.minLines
  );
}

export interface ScoreIntersections {
  /** Ascending-sorted set of token n-grams present in both fragments. */
  tokens: string[];
  /** Ascending-sorted set of statement-kind n-grams present in both. */
  statements: string[];
  /** Ascending-sorted set of call / property keys present in both. */
  calls: string[];
}

export interface DetailedScore {
  score: CandidateScore;
  intersections: ScoreIntersections;
}

export interface ScoreInputsFromSets {
  candidate: Candidate;
  changedFragment: Fragment;
  baseFragment: Fragment;
  changedFeatureSets: FragmentFeatureSets;
  baseFeatureSets: FragmentFeatureSets;
}

/**
 * Score a candidate pair across the 4 v1 axes without materialising the
 * per-axis intersection arrays. Use this on the hot scoring loop and call
 * `buildIntersectionsFromSets` only for pairs that pass `shouldReport`.
 *
 * Jaccard ratios are computed via `jaccardCount`, which probes the larger
 * set once per element of the smaller set but never allocates or sorts.
 *
 * Pure / deterministic given fixed `inputs` and `config`.
 */
export function scoreCandidateFromSets(
  inputs: ScoreInputsFromSets,
  config: Config,
): CandidateScore {
  const tokens = jaccardCount(
    inputs.changedFeatureSets.tokens,
    inputs.baseFeatureSets.tokens,
  );
  const statements = jaccardCount(
    inputs.changedFeatureSets.statements,
    inputs.baseFeatureSets.statements,
  );
  const calls = jaccardCount(
    inputs.changedFeatureSets.calls,
    inputs.baseFeatureSets.calls,
  );
  const useContainment = shouldUseContainment(
    inputs.changedFragment,
    inputs.baseFragment,
    config.scoring.containment,
  );
  const alpha = config.scoring.containment.alpha;
  const breakdown = {
    tokenOverlap: blendSimilarity(
      tokens.jaccard,
      tokens.overlapCoefficient,
      useContainment,
      alpha,
    ),
    statementKindSimilarity: blendSimilarity(
      statements.jaccard,
      statements.overlapCoefficient,
      useContainment,
      alpha,
    ),
    callOverlap: blendSimilarity(
      calls.jaccard,
      calls.overlapCoefficient,
      useContainment,
      alpha,
    ),
    sizeCompatibility: sizeCompatibility(
      inputs.changedFragment,
      inputs.baseFragment,
    ),
    lengthScore: lengthScore(
      inputs.changedFragment,
      inputs.baseFragment,
      config.scoring.lengthSaturation,
    ),
  };
  const combined = combinedScore(
    breakdown,
    config.scoring.weights,
    config.features.enabled,
  );
  return {
    changedFragmentId: inputs.candidate.changedFragmentId,
    baseFragmentId: inputs.candidate.baseFragmentId,
    combined,
    breakdown,
  };
}

/**
 * Build the ascending-sorted per-axis intersections used as evidence in the
 * report. Only call this for pairs that have already passed `shouldReport`
 * — the sort cost is the bulk of what this function does, so it's the
 * inverse of the cheap path.
 */
export function buildIntersectionsFromSets(
  changedFeatureSets: FragmentFeatureSets,
  baseFeatureSets: FragmentFeatureSets,
): ScoreIntersections {
  return {
    tokens: intersectionSorted(
      changedFeatureSets.tokens,
      baseFeatureSets.tokens,
    ),
    statements: intersectionSorted(
      changedFeatureSets.statements,
      baseFeatureSets.statements,
    ),
    calls: intersectionSorted(changedFeatureSets.calls, baseFeatureSets.calls),
  };
}

/**
 * Score a single candidate pair across the 4 v1 axes, returning the
 * combined / per-axis scores **and** the per-axis intersection sets used
 * as evidence by the report generator.
 *
 * Convenience wrapper. Tests and other non-hot-path callers can keep
 * using this; the candidate-search / scoring loop should call
 * `scoreCandidateFromSets` directly and only invoke
 * `buildIntersectionsFromSets` for the ~4% of pairs that pass
 * `shouldReport`.
 *
 * Pure / deterministic given fixed `inputs` and `config`.
 */
export function scoreCandidateDetailedFromSets(
  inputs: ScoreInputsFromSets,
  config: Config,
): DetailedScore {
  return {
    score: scoreCandidateFromSets(inputs, config),
    intersections: buildIntersectionsFromSets(
      inputs.changedFeatureSets,
      inputs.baseFeatureSets,
    ),
  };
}
