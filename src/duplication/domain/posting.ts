import type { FeatureKey } from "./feature.ts";
import type { Fragment } from "./fragment.ts";

export interface InvertedIndex {
  readonly postings: ReadonlyMap<FeatureKey, readonly Fragment[]>;
  /**
   * Distinct fragment count fed into `buildInvertedIndex`. Used at query
   * time to compute document frequency (`postings.length / totalFragments`)
   * for the hot-key DF cap in `searchCandidates`.
   */
  readonly totalFragments: number;
}
