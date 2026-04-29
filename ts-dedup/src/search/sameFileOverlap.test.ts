import { describe, expect, it } from "vitest";
import { isSameFileOverlap } from "./sameFileOverlap.ts";

describe("isSameFileOverlap", () => {
  it("returns false for fragments in different files", () => {
    expect(
      isSameFileOverlap(
        { filePath: "a.ts", startLine: 1, endLine: 10 },
        { filePath: "b.ts", startLine: 1, endLine: 10 },
      ),
    ).toBe(false);
  });

  it("returns true for identical ranges in the same file", () => {
    expect(
      isSameFileOverlap(
        { filePath: "a.ts", startLine: 5, endLine: 20 },
        { filePath: "a.ts", startLine: 5, endLine: 20 },
      ),
    ).toBe(true);
  });

  it("returns true when one range fully contains the other", () => {
    expect(
      isSameFileOverlap(
        { filePath: "a.ts", startLine: 1, endLine: 100 },
        { filePath: "a.ts", startLine: 30, endLine: 40 },
      ),
    ).toBe(true);
  });

  it("returns true for a single-line touch at the boundary", () => {
    expect(
      isSameFileOverlap(
        { filePath: "a.ts", startLine: 1, endLine: 10 },
        { filePath: "a.ts", startLine: 10, endLine: 20 },
      ),
    ).toBe(true);
  });

  it("returns false for fully disjoint ranges in the same file", () => {
    expect(
      isSameFileOverlap(
        { filePath: "a.ts", startLine: 1, endLine: 10 },
        { filePath: "a.ts", startLine: 20, endLine: 30 },
      ),
    ).toBe(false);
  });

  it("returns false for adjacent ranges with a 1-line gap", () => {
    expect(
      isSameFileOverlap(
        { filePath: "a.ts", startLine: 1, endLine: 10 },
        { filePath: "a.ts", startLine: 12, endLine: 20 },
      ),
    ).toBe(false);
  });
});
