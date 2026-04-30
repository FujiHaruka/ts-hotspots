import { describe, expect, it } from "vitest";
import {
  intersectionSorted,
  jaccardCount,
  jaccardWithIntersection,
} from "./jaccardWithIntersection.ts";

describe("jaccardWithIntersection", () => {
  it("returns 0 / [] when both sides are empty", () => {
    const r = jaccardWithIntersection(new Set(), new Set());
    expect(r.jaccard).toBe(0);
    expect(r.intersection).toEqual([]);
  });

  it("returns 1 / sorted intersection when sets are identical", () => {
    const r = jaccardWithIntersection(
      new Set(["b", "a", "c"]),
      new Set(["c", "a", "b"]),
    );
    expect(r.jaccard).toBe(1);
    expect(r.intersection).toEqual(["a", "b", "c"]);
  });

  it("computes ratio + intersection on partial overlap", () => {
    const r = jaccardWithIntersection(
      new Set(["a", "b", "c"]),
      new Set(["b", "c", "d"]),
    );
    expect(r.jaccard).toBeCloseTo(2 / 4, 12);
    expect(r.intersection).toEqual(["b", "c"]);
  });

  it("returns 0 / [] when sets are disjoint", () => {
    const r = jaccardWithIntersection(
      new Set(["a", "b"]),
      new Set(["c", "d"]),
    );
    expect(r.jaccard).toBe(0);
    expect(r.intersection).toEqual([]);
  });

  it("intersection order is independent of input argument order", () => {
    const a = new Set(["x", "y"]);
    const b = new Set(["y", "x", "z"]);
    const ab = jaccardWithIntersection(a, b);
    const ba = jaccardWithIntersection(b, a);
    expect(ab.intersection).toEqual(ba.intersection);
    expect(ab.jaccard).toBe(ba.jaccard);
  });

  it("matches the expected formula on a non-trivial example", () => {
    // |A ∩ B| = 3, |A ∪ B| = 7, jaccard = 3/7, overlapCoef = 3/5
    const a = new Set(["1", "2", "3", "4", "5"]);
    const b = new Set(["3", "4", "5", "6", "7"]);
    const r = jaccardWithIntersection(a, b);
    expect(r.intersection).toEqual(["3", "4", "5"]);
    expect(r.jaccard).toBeCloseTo(3 / 7, 12);
    expect(r.overlapCoefficient).toBeCloseTo(3 / 5, 12);
  });

  describe("overlap coefficient", () => {
    it("returns 0 when both sides are empty", () => {
      const r = jaccardWithIntersection(new Set(), new Set());
      expect(r.overlapCoefficient).toBe(0);
    });

    it("returns 0 when one side is empty (min-size 0 short-circuit)", () => {
      const r = jaccardWithIntersection(new Set(), new Set(["a", "b"]));
      expect(r.overlapCoefficient).toBe(0);
    });

    it("returns 1 when one set is fully contained in the other", () => {
      // A = {a, b}, B = {a, b, c, d, e}. Intersection = 2, min = 2 → 1.
      const r = jaccardWithIntersection(
        new Set(["a", "b"]),
        new Set(["a", "b", "c", "d", "e"]),
      );
      expect(r.jaccard).toBeCloseTo(2 / 5, 12);
      expect(r.overlapCoefficient).toBe(1);
    });

    it("returns 1 on identical sets (Jaccard = 1 too)", () => {
      const r = jaccardWithIntersection(
        new Set(["a", "b", "c"]),
        new Set(["a", "b", "c"]),
      );
      expect(r.jaccard).toBe(1);
      expect(r.overlapCoefficient).toBe(1);
    });
  });
});

describe("jaccardCount", () => {
  it("returns 0 / 0 / 0 when both sides are empty", () => {
    const r = jaccardCount(new Set(), new Set());
    expect(r.jaccard).toBe(0);
    expect(r.overlapCoefficient).toBe(0);
    expect(r.intersectionSize).toBe(0);
  });

  it("returns the same jaccard / overlap-coef as the materialising helper", () => {
    const samples: [Set<string>, Set<string>][] = [
      [new Set(["a", "b", "c"]), new Set(["b", "c", "d"])],
      [new Set(["x"]), new Set(["x", "y", "z"])],
      [new Set(["1", "2", "3"]), new Set(["4", "5", "6"])],
      [new Set(), new Set(["a"])],
    ];
    for (const [a, b] of samples) {
      const lazy = jaccardCount(a, b);
      const eager = jaccardWithIntersection(a, b);
      expect(lazy.jaccard).toBeCloseTo(eager.jaccard, 12);
      expect(lazy.overlapCoefficient).toBeCloseTo(eager.overlapCoefficient, 12);
      expect(lazy.intersectionSize).toBe(eager.intersection.length);
    }
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

  it("returns the ascending-sorted intersection", () => {
    const a = new Set(["c", "a", "b"]);
    const b = new Set(["b", "c", "d"]);
    expect(intersectionSorted(a, b)).toEqual(["b", "c"]);
  });

  it("agrees with jaccardWithIntersection on the materialised intersection", () => {
    const a = new Set(["1", "2", "3", "4", "5"]);
    const b = new Set(["3", "4", "5", "6", "7"]);
    expect(intersectionSorted(a, b)).toEqual(
      jaccardWithIntersection(a, b).intersection,
    );
  });
});
