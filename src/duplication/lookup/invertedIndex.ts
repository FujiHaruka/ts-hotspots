import type { FeatureKey, FragmentFeatures } from "../domain/feature.ts";
import type { Fragment } from "../domain/fragment.ts";
import type { InvertedIndex } from "../domain/posting.ts";

export interface IndexInput {
  fragment: Fragment;
  features: FragmentFeatures;
}

/**
 * Build the inverted index from base-side fragments + their features.
 *
 * Pure / deterministic: identical `inputs` produce identical Map insertion
 * order. Same `(fragmentId, featureKey)` is emitted at most once — the index
 * answers "which fragments contain this feature", not bag multiplicity.
 */
export function buildInvertedIndex(
  inputs: readonly IndexInput[],
): InvertedIndex {
  const postings = new Map<FeatureKey, Fragment[]>();
  for (const { fragment, features } of inputs) {
    addKeys(postings, fragment, features.tokens);
    addKeys(postings, fragment, features.statements);
    addKeys(postings, fragment, features.calls);
  }
  return { postings, totalFragments: inputs.length };
}

function addKeys(
  postings: Map<FeatureKey, Fragment[]>,
  fragment: Fragment,
  keys: readonly FeatureKey[],
): void {
  for (const key of keys) {
    const list = postings.get(key);
    if (list === undefined) {
      postings.set(key, [fragment]);
    } else if (list.at(-1)?.id !== fragment.id) {
      list.push(fragment);
    }
  }
}
