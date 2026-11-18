import { describe, expect, it } from "vitest";
import type { HunkSpan } from "../domain/diff.ts";
import { headRangeToBase } from "./lineMap.ts";

const span = (
  baseStart: number,
  baseCount: number,
  headStart: number,
  headCount: number,
): HunkSpan => ({ baseStart, baseCount, headStart, headCount });

describe("headRangeToBase", () => {
  it("is the identity without hunks", () => {
    expect(headRangeToBase([], { startLine: 5, endLine: 9 })).toEqual({
      startLine: 5,
      endLine: 9,
    });
  });

  it("shifts unchanged lines below an insertion back up", () => {
    const spans = [span(10, 0, 11, 18)];
    expect(headRangeToBase(spans, { startLine: 40, endLine: 48 })).toEqual({
      startLine: 22,
      endLine: 30,
    });
  });

  it("shifts unchanged lines below a deletion down", () => {
    const spans = [span(3, 4, 2, 0)];
    expect(headRangeToBase(spans, { startLine: 10, endLine: 12 })).toEqual({
      startLine: 14,
      endLine: 16,
    });
  });

  it("leaves lines above every hunk untouched", () => {
    const spans = [span(50, 2, 50, 7)];
    expect(headRangeToBase(spans, { startLine: 1, endLine: 49 })).toEqual({
      startLine: 1,
      endLine: 49,
    });
  });

  it("widens a range ending inside a replaced hunk to the hunk's base lines", () => {
    const spans = [span(20, 3, 20, 6)];
    expect(headRangeToBase(spans, { startLine: 15, endLine: 22 })).toEqual({
      startLine: 15,
      endLine: 22,
    });
    expect(headRangeToBase(spans, { startLine: 21, endLine: 30 })).toEqual({
      startLine: 20,
      endLine: 27,
    });
  });

  it("maps a range made only of inserted lines to the empty gap it was inserted into", () => {
    const spans = [span(8, 0, 9, 5)];
    expect(headRangeToBase(spans, { startLine: 9, endLine: 13 })).toEqual({
      startLine: 9,
      endLine: 8,
    });
  });

  it("composes several hunks", () => {
    const spans = [span(5, 0, 6, 3), span(20, 2, 22, 0), span(40, 1, 41, 4)];
    expect(headRangeToBase(spans, { startLine: 30, endLine: 50 })).toEqual({
      startLine: 29,
      endLine: 46,
    });
  });
});
