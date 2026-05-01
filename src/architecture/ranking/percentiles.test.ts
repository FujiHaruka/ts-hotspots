import { describe, expect, it } from "vitest";
import { buildPercentileLookup } from "./percentiles.ts";

describe("buildPercentileLookup", () => {
  it("top value gets percentile 1.0", () => {
    const lookup = buildPercentileLookup({ population: [1, 2, 3, 4, 5] });
    expect(lookup(5).percentile).toBeCloseTo(1, 6);
    expect(lookup(5).rank).toBe(5);
    expect(lookup(1).percentile).toBeCloseTo(0.2, 6);
  });

  it("ties land at the same (high-end) rank", () => {
    const lookup = buildPercentileLookup({ population: [1, 1, 2, 2, 3] });
    // Both 2s share the high-end rank of the tied block: 4.
    expect(lookup(2).rank).toBe(4);
    expect(lookup(2).percentile).toBeCloseTo(0.8, 6);
  });

  it("z-score is 0 when stddev is 0", () => {
    const lookup = buildPercentileLookup({ population: [3, 3, 3] });
    expect(lookup(3).zScore).toBe(0);
  });

  it("z-score is positive for above-mean values", () => {
    const lookup = buildPercentileLookup({ population: [1, 2, 3, 4, 5] });
    expect(lookup(5).zScore).toBeGreaterThan(1);
  });

  it("empty population returns zeros", () => {
    const lookup = buildPercentileLookup({ population: [] });
    expect(lookup(42)).toEqual({ value: 0, percentile: 0, rank: 0, zScore: 0 });
  });
});
