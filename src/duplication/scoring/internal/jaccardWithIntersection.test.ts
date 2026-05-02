import { describe, expect, it } from "vitest";
import { intersectionSorted, jaccardCount } from "./jaccardWithIntersection.ts";

describe("jaccardCount", () => {
  it("returns 0 / 0 / 0 when both sides are empty", () => {
    const r = jaccardCount(new Set(), new Set());
    expect(r.jaccard).toBe(0);
    expect(r.overlapCoefficient).toBe(0);
    expect(r.intersectionSize).toBe(0);
  });

  it("returns 0 / 0 / 0 when one side is empty (min-size short-circuit)", () => {
    const r = jaccardCount(new Set(), new Set(["a", "b"]));
    expect(r.jaccard).toBe(0);
    expect(r.overlapCoefficient).toBe(0);
    expect(r.intersectionSize).toBe(0);
  });

  it("returns 1 / 1 / size when sets are identical", () => {
    const r = jaccardCount(new Set(["a", "b", "c"]), new Set(["a", "b", "c"]));
    expect(r.jaccard).toBe(1);
    expect(r.overlapCoefficient).toBe(1);
    expect(r.intersectionSize).toBe(3);
  });

  it("returns 0 / 0 / 0 when sets are disjoint", () => {
    const r = jaccardCount(new Set(["a", "b"]), new Set(["c", "d"]));
    expect(r.jaccard).toBe(0);
    expect(r.overlapCoefficient).toBe(0);
    expect(r.intersectionSize).toBe(0);
  });

  it("matches the expected formulas on a non-trivial example", () => {
    // |A ∩ B| = 3, |A ∪ B| = 7, jaccard = 3/7, overlapCoef = 3/5
    const a = new Set(["1", "2", "3", "4", "5"]);
    const b = new Set(["3", "4", "5", "6", "7"]);
    const r = jaccardCount(a, b);
    expect(r.intersectionSize).toBe(3);
    expect(r.jaccard).toBeCloseTo(3 / 7, 12);
    expect(r.overlapCoefficient).toBeCloseTo(3 / 5, 12);
  });

  it("overlap coefficient is 1 when one set is fully contained in the other", () => {
    // A = {a, b}, B = {a, b, c, d, e}. Intersection = 2, min = 2 → 1.
    const r = jaccardCount(
      new Set(["a", "b"]),
      new Set(["a", "b", "c", "d", "e"]),
    );
    expect(r.jaccard).toBeCloseTo(2 / 5, 12);
    expect(r.overlapCoefficient).toBe(1);
  });

  it("is symmetric in argument order", () => {
    const a = new Set(["x", "y"]);
    const b = new Set(["y", "x", "z"]);
    const ab = jaccardCount(a, b);
    const ba = jaccardCount(b, a);
    expect(ab.intersectionSize).toBe(ba.intersectionSize);
    expect(ab.jaccard).toBe(ba.jaccard);
    expect(ab.overlapCoefficient).toBe(ba.overlapCoefficient);
  });

  it("does not mutate the input sets", () => {
    const a = new Set(["a", "b"]);
    const b = new Set(["b", "c"]);
    jaccardCount(a, b);
    expect([...a]).toEqual(["a", "b"]);
    expect([...b]).toEqual(["b", "c"]);
  });
});

describe("intersectionSorted", () => {
  it("returns [] when either side is empty", () => {
    expect(intersectionSorted(new Set(), new Set(["a"]))).toEqual([]);
    expect(intersectionSorted(new Set(["a"]), new Set())).toEqual([]);
  });

  it("returns the ascending-sorted intersection on partial overlap", () => {
    const a = new Set(["c", "a", "b"]);
    const b = new Set(["b", "c", "d"]);
    expect(intersectionSorted(a, b)).toEqual(["b", "c"]);
  });

  it("returns the full sorted set when sets are identical", () => {
    const r = intersectionSorted(
      new Set(["b", "a", "c"]),
      new Set(["c", "a", "b"]),
    );
    expect(r).toEqual(["a", "b", "c"]);
  });

  it("is symmetric in argument order", () => {
    const a = new Set(["x", "y"]);
    const b = new Set(["y", "x", "z"]);
    expect(intersectionSorted(a, b)).toEqual(intersectionSorted(b, a));
  });

  it("agrees with jaccardCount on intersection size", () => {
    const a = new Set(["1", "2", "3", "4", "5"]);
    const b = new Set(["3", "4", "5", "6", "7"]);
    expect(intersectionSorted(a, b).length).toBe(
      jaccardCount(a, b).intersectionSize,
    );
  });
});
