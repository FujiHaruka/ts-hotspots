import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/defaults.ts";
import { buildCodebaseIndex, type SourceInput } from "./buildCodebaseIndex.ts";

describe("buildCodebaseIndex", () => {
  it("returns an empty array for empty input", () => {
    expect(buildCodebaseIndex([], defaultConfig)).toEqual([]);
  });

  it("concatenates fragments in input order and preserves per-file filePath", () => {
    const sources: SourceInput[] = [
      {
        path: "a.ts",
        text: `function a() { return 1; }\n`,
      },
      {
        path: "b.ts",
        text: `function b() { return 2; }\n`,
      },
    ];
    const fragments = buildCodebaseIndex(sources, defaultConfig);
    // First fragment(s) must be from a.ts, then b.ts.
    const filePathsInOrder = fragments.map((f) => f.filePath);
    const firstBIndex = filePathsInOrder.indexOf("b.ts");
    expect(firstBIndex).toBeGreaterThan(0);
    expect(
      filePathsInOrder.slice(0, firstBIndex).every((p) => p === "a.ts"),
    ).toBe(true);
    expect(filePathsInOrder.slice(firstBIndex).every((p) => p === "b.ts")).toBe(
      true,
    );
  });

  it("is deterministic across repeated runs", () => {
    const sources: SourceInput[] = [
      { path: "a.ts", text: `function a() { return 1; }\n` },
      { path: "b.ts", text: `function b() { return 2; }\n` },
    ];
    const first = buildCodebaseIndex(sources, defaultConfig);
    const second = buildCodebaseIndex(sources, defaultConfig);
    expect(first).toEqual(second);
    expect(first.map((f) => f.id)).toEqual(second.map((f) => f.id));
  });

  it("allows the same identifier range across files without id collision", () => {
    // Same text in two files → ids differ because filePath is part of the id.
    const sources: SourceInput[] = [
      { path: "a.ts", text: `function a() { return 1; }\n` },
      { path: "b.ts", text: `function a() { return 1; }\n` },
    ];
    const fragments = buildCodebaseIndex(sources, defaultConfig);
    const ids = fragments.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
