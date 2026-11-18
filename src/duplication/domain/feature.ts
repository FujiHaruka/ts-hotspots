export type FeatureKey = string;

export interface FragmentFeatures {
  fragmentId: string;
  tokens: FeatureKey[];
  statements: FeatureKey[];
  calls: FeatureKey[];
}
