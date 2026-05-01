import { describe, expect, it } from "vitest";
import type { Component } from "../graph/types.ts";
import {
  buildLineCounts,
  collectSmallNodeIds,
  DEFAULT_SIZE_FLOOR_LINES,
} from "./sizeFloor.ts";

function comp(name: string, line: number, endLine: number): Component {
  return {
    id: `src/${name}.ts::${name}::function`,
    filePath: `src/${name}.ts`,
    exportName: name,
    exportKind: "function",
    line,
    endLine,
  };
}

describe("collectSmallNodeIds", () => {
  it("flags components below the default floor", () => {
    const nodes = [
      comp("tiny", 1, 3), // 3 lines
      comp("medium", 1, 15), // 15 lines
      comp("big", 1, 80), // 80 lines
    ];
    const result = collectSmallNodeIds(nodes);
    expect([...result]).toEqual(["src/tiny.ts::tiny::function"]);
  });

  it("uses an inclusive line span (endLine - line + 1)", () => {
    // exactly DEFAULT_SIZE_FLOOR_LINES (10) → not small
    const at = comp("at", 1, DEFAULT_SIZE_FLOOR_LINES);
    // one short of the floor → small
    const just = comp("just", 1, DEFAULT_SIZE_FLOOR_LINES - 1);
    const result = collectSmallNodeIds([at, just]);
    expect(result.has(at.id)).toBe(false);
    expect(result.has(just.id)).toBe(true);
  });

  it("respects an explicit floorLines override", () => {
    const ten = comp("ten", 1, 10);
    const fifty = comp("fifty", 1, 50);
    expect([...collectSmallNodeIds([ten, fifty], 50)]).toEqual([
      "src/ten.ts::ten::function",
    ]);
  });

  it("returns empty when floor disables filtering", () => {
    const nodes = [comp("a", 1, 1), comp("b", 5, 5)];
    expect(collectSmallNodeIds(nodes, 1).size).toBe(0);
    expect(collectSmallNodeIds(nodes, 0).size).toBe(0);
  });

  it("is empty for an empty node list", () => {
    expect(collectSmallNodeIds([]).size).toBe(0);
  });
});

describe("buildLineCounts", () => {
  it("maps each id to its inclusive declaration span", () => {
    const nodes = [comp("a", 1, 3), comp("b", 10, 25)];
    const counts = buildLineCounts(nodes);
    expect(counts.get("src/a.ts::a::function")).toBe(3);
    expect(counts.get("src/b.ts::b::function")).toBe(16);
  });
});
