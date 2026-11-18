import type { FeatureKey, FragmentFeatures } from "../domain/feature.ts";

export type FeatureKeyPool = Map<FeatureKey, FeatureKey>;

export function internFeatureKeys(
  features: FragmentFeatures,
  pool: FeatureKeyPool,
): void {
  internInPlace(features.tokens, pool);
  internInPlace(features.statements, pool);
  internInPlace(features.calls, pool);
}

function internInPlace(keys: FeatureKey[], pool: FeatureKeyPool): void {
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const pooled = pool.get(key);
    if (pooled === undefined) {
      pool.set(key, key);
    } else {
      keys[i] = pooled;
    }
  }
}
