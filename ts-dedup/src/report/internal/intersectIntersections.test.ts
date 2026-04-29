import { describe, expect, it } from "vitest";
import type { Intersections } from "../evidence.ts";
import { intersectIntersections } from "./intersectIntersections.ts";

const empty: Intersections = { tokens: [], statements: [], calls: [] };

describe("intersectIntersections", () => {
  it("returns empty arrays when input list is empty", () => {
    expect(intersectIntersections([])).toEqual(empty);
  });

  it("returns the single input untouched (per axis) when given exactly one", () => {
    const single: Intersections = {
      tokens: ["a", "b"],
      statements: ["s1"],
      calls: ["c1", "c2"],
    };
    const result = intersectIntersections([single]);
    expect(result).toEqual(single);
    // Independent copy, not the same reference.
    expect(result.tokens).not.toBe(single.tokens);
  });

  it("keeps only keys present in every input, per axis", () => {
    const a: Intersections = {
      tokens: ["a", "b", "c"],
      statements: ["s1", "s2"],
      calls: ["c1", "c2"],
    };
    const b: Intersections = {
      tokens: ["b", "c", "d"],
      statements: ["s2", "s3"],
      calls: ["c2", "c3"],
    };
    const c: Intersections = {
      tokens: ["b", "c"],
      statements: ["s2"],
      calls: ["c2"],
    };
    expect(intersectIntersections([a, b, c])).toEqual({
      tokens: ["b", "c"],
      statements: ["s2"],
      calls: ["c2"],
    });
  });

  it("returns empty axis when one input has nothing for that axis", () => {
    const a: Intersections = {
      tokens: ["a", "b"],
      statements: ["s1"],
      calls: ["c1"],
    };
    const b: Intersections = {
      tokens: [],
      statements: ["s1"],
      calls: ["c1"],
    };
    expect(intersectIntersections([a, b])).toEqual({
      tokens: [],
      statements: ["s1"],
      calls: ["c1"],
    });
  });

  it("returns empty axis when inputs share no keys", () => {
    const a: Intersections = { tokens: ["a"], statements: [], calls: [] };
    const b: Intersections = { tokens: ["b"], statements: [], calls: [] };
    expect(intersectIntersections([a, b])).toEqual(empty);
  });

  it("preserves ascending sort order in the result", () => {
    const a: Intersections = {
      tokens: ["a", "b", "c", "d"],
      statements: [],
      calls: [],
    };
    const b: Intersections = {
      tokens: ["a", "c", "d"],
      statements: [],
      calls: [],
    };
    const result = intersectIntersections([a, b]);
    const sorted = [...result.tokens].sort();
    expect(result.tokens).toEqual(sorted);
  });
});
