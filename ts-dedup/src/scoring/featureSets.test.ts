import { describe, expect, it } from "vitest";
import type { FragmentFeatures } from "../domain/feature.ts";
import { buildFeatureSets } from "./featureSets.ts";

describe("buildFeatureSets", () => {
  it("converts each feature stream array into a Set", () => {
    const features: FragmentFeatures = {
      fragmentId: "frag1",
      tokens: ["a", "b", "a"],
      statements: ["IF", "RETURN"],
      calls: ["CALL:foo"],
    };
    const sets = buildFeatureSets(features);
    expect(sets.tokens).toBeInstanceOf(Set);
    expect([...sets.tokens]).toEqual(["a", "b"]);
    expect([...sets.statements]).toEqual(["IF", "RETURN"]);
    expect([...sets.calls]).toEqual(["CALL:foo"]);
  });

  it("handles empty streams", () => {
    const sets = buildFeatureSets({
      fragmentId: "frag2",
      tokens: [],
      statements: [],
      calls: [],
    });
    expect(sets.tokens.size).toBe(0);
    expect(sets.statements.size).toBe(0);
    expect(sets.calls.size).toBe(0);
  });
});
