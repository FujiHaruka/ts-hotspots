import type { FeatureKey, FeatureKind } from "./feature.ts";

export interface Posting {
  fragmentId: string;
  filePath: string;
  startLine: number;
  endLine: number;
  featureKind: FeatureKind;
}

export interface InvertedIndex {
  readonly postings: ReadonlyMap<FeatureKey, readonly Posting[]>;
  /**
   * Distinct fragment count fed into `buildInvertedIndex`. Used at query
   * time to compute document frequency (`postings.length / totalFragments`)
   * for the hot-key DF cap in `searchCandidates`.
   */
  readonly totalFragments: number;
}
