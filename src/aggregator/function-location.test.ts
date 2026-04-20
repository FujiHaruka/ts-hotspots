import { describe, expect, test } from "vitest";
import {
  buildFunctionLocation,
  compareFunctionByLocation,
  splitFunctionLocation,
} from "./function-location.ts";

describe("buildFunctionLocation", () => {
  test("multi-line function emits path:start-end", () => {
    expect(buildFunctionLocation("src/a.ts", 42, 87)).toBe("src/a.ts:42-87");
  });

  test("single-line function collapses to path:start", () => {
    expect(buildFunctionLocation("src/a.ts", 42, 42)).toBe("src/a.ts:42");
  });
});

describe("splitFunctionLocation", () => {
  test("parses path:line form", () => {
    expect(splitFunctionLocation("src/a.ts:42")).toEqual(["src/a.ts", 42]);
  });

  test("parses path:start-end form and returns only the start line", () => {
    expect(splitFunctionLocation("src/a.ts:42-87")).toEqual(["src/a.ts", 42]);
  });

  test("round-trips single-line locations", () => {
    const loc = buildFunctionLocation("src/a.ts", 5, 5);
    expect(splitFunctionLocation(loc)).toEqual(["src/a.ts", 5]);
  });

  test("round-trips multi-line locations (start line only)", () => {
    const loc = buildFunctionLocation("src/a.ts", 10, 99);
    expect(splitFunctionLocation(loc)).toEqual(["src/a.ts", 10]);
  });
});

describe("compareFunctionByLocation", () => {
  const at = (location: string, name = "f", kind = "function") => ({
    location,
    name,
    kind,
  });

  test("orders by file first", () => {
    expect(
      compareFunctionByLocation(at("src/a.ts:10"), at("src/b.ts:1")),
    ).toBeLessThan(0);
  });

  test("orders by start line numerically, not lexicographically", () => {
    // Lexicographic would put "10" before "9"; numeric must put 9 first.
    expect(
      compareFunctionByLocation(at("src/a.ts:9"), at("src/a.ts:10")),
    ).toBeLessThan(0);
  });

  test("falls back to name, then kind", () => {
    expect(
      compareFunctionByLocation(at("src/a.ts:1", "a"), at("src/a.ts:1", "b")),
    ).toBeLessThan(0);
    expect(
      compareFunctionByLocation(
        at("src/a.ts:1", "f", "arrow"),
        at("src/a.ts:1", "f", "function"),
      ),
    ).toBeLessThan(0);
  });

  test("returns 0 for identical identity", () => {
    expect(compareFunctionByLocation(at("src/a.ts:1"), at("src/a.ts:1"))).toBe(
      0,
    );
  });
});
