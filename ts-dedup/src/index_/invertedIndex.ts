import type {
  FeatureKey,
  FeatureKind,
  Fragment,
  FragmentFeatures,
  InvertedIndex,
  Posting,
} from "../domain/index.ts";

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
  const postings = new Map<FeatureKey, Posting[]>();
  // Per-key set of fragment ids already recorded, to dedupe postings.
  const seen = new Map<FeatureKey, Set<string>>();

  for (const { fragment, features } of inputs) {
    addKeys(postings, seen, fragment, features.tokens, "token");
    addKeys(postings, seen, fragment, features.statements, "statement");
    addKeys(postings, seen, fragment, features.calls, "call");
  }

  return { postings, totalFragments: inputs.length };
}

function addKeys(
  postings: Map<FeatureKey, Posting[]>,
  seen: Map<FeatureKey, Set<string>>,
  fragment: Fragment,
  keys: readonly FeatureKey[],
  featureKind: FeatureKind,
): void {
  for (const key of keys) {
    let fragmentIds = seen.get(key);
    if (fragmentIds === undefined) {
      fragmentIds = new Set<string>();
      seen.set(key, fragmentIds);
    }
    if (fragmentIds.has(fragment.id)) {
      continue;
    }
    fragmentIds.add(fragment.id);

    let list = postings.get(key);
    if (list === undefined) {
      list = [];
      postings.set(key, list);
    }
    list.push({
      fragmentId: fragment.id,
      filePath: fragment.filePath,
      startLine: fragment.startLine,
      endLine: fragment.endLine,
      featureKind,
    });
  }
}
