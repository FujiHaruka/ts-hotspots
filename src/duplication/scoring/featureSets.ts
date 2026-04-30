import type { FragmentFeatures } from "../domain/feature.ts";

/**
 * Set form of `FragmentFeatures` used on the candidate-pair hot path.
 *
 * `scoreCandidateDetailed` would otherwise build `Set` views of the same
 * `tokens` / `statements` / `calls` arrays for every candidate pair (and
 * twice per axis — once for Jaccard, once for intersection). Pre-building
 * these once per fragment lets `scoreCandidateDetailedFromSets` reuse them
 * across all candidates that touch the fragment.
 */
export interface FragmentFeatureSets {
  tokens: Set<string>;
  statements: Set<string>;
  calls: Set<string>;
}

export function buildFeatureSets(
  features: FragmentFeatures,
): FragmentFeatureSets {
  return {
    tokens: new Set(features.tokens),
    statements: new Set(features.statements),
    calls: new Set(features.calls),
  };
}
