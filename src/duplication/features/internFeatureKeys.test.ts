import { describe, expect, it } from "vitest";
import type { FragmentFeatures } from "../domain/feature.ts";
import { type FeatureKeyPool, internFeatureKeys } from "./internFeatureKeys.ts";

function features(tokens: string[], statements: string[], calls: string[]): FragmentFeatures {
  return { fragmentId: "f", tokens, statements, calls };
}

describe("internFeatureKeys", () => {
  it("keeps every key value and order while pooling one entry per distinct key", () => {
    const pool: FeatureKeyPool = new Map();
    const a = features(["token:x", "token:y"], ["statement:s"], ["call:c"]);
    const b = features(["token:y", "token:x", "token:y"], ["statement:s"], []);
    internFeatureKeys(a, pool);
    internFeatureKeys(b, pool);

    expect(b.tokens).toEqual(["token:y", "token:x", "token:y"]);
    expect(b.statements).toEqual(["statement:s"]);
    expect(a.tokens).toEqual(["token:x", "token:y"]);
    expect([...pool.keys()]).toEqual(["token:x", "token:y", "statement:s", "call:c"]);
  });
});
