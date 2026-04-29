import { describe, expect, it } from "vitest";
import { parseRevRange, RevRangeParseError } from "./parseRevRange.ts";

describe("parseRevRange", () => {
  it("parses two-dot A..B", () => {
    expect(parseRevRange("main..feature")).toEqual({
      baseRef: "main",
      headRef: "feature",
      threeDot: false,
    });
  });

  it("parses three-dot A...B", () => {
    expect(parseRevRange("main...feature")).toEqual({
      baseRef: "main",
      headRef: "feature",
      threeDot: true,
    });
  });

  it("defaults missing head to HEAD in A..", () => {
    expect(parseRevRange("main..")).toEqual({
      baseRef: "main",
      headRef: "HEAD",
      threeDot: false,
    });
  });

  it("defaults missing head to HEAD in A...", () => {
    expect(parseRevRange("main...")).toEqual({
      baseRef: "main",
      headRef: "HEAD",
      threeDot: true,
    });
  });

  it("defaults missing base to HEAD in ..B", () => {
    expect(parseRevRange("..feature")).toEqual({
      baseRef: "HEAD",
      headRef: "feature",
      threeDot: false,
    });
  });

  it("defaults missing base to HEAD in ...B", () => {
    expect(parseRevRange("...feature")).toEqual({
      baseRef: "HEAD",
      headRef: "feature",
      threeDot: true,
    });
  });

  it("accepts refs that contain slashes and dots", () => {
    expect(parseRevRange("origin/main...v1.2.3")).toEqual({
      baseRef: "origin/main",
      headRef: "v1.2.3",
      threeDot: true,
    });
  });

  it("rejects a bare ref with no separator", () => {
    expect(() => parseRevRange("main")).toThrow(RevRangeParseError);
  });

  it("rejects empty input", () => {
    expect(() => parseRevRange("")).toThrow(RevRangeParseError);
  });

  it("rejects both sides empty (.. / ...)", () => {
    expect(() => parseRevRange("..")).toThrow(RevRangeParseError);
    expect(() => parseRevRange("...")).toThrow(RevRangeParseError);
  });

  it("rejects more than one separator", () => {
    expect(() => parseRevRange("a..b..c")).toThrow(RevRangeParseError);
    expect(() => parseRevRange("a...b...c")).toThrow(RevRangeParseError);
  });
});
