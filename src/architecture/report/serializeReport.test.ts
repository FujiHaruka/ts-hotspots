import { describe, expect, it } from "vitest";
import {
  type Component,
  type Edge,
  type Graph,
  makeComponentId,
} from "../graph/types.ts";
import type { ArchCandidate } from "../scoring/score.ts";
import { serializeReport } from "./serializeReport.ts";

const TOOL = { name: "ts-hotspots", version: "0.0.0-test" } as const;

function comp(file: string, name: string): Component {
  return {
    id: makeComponentId(file, name, "function"),
    filePath: file,
    exportName: name,
    exportKind: "function",
    line: 12,
    endLine: 12,
  };
}

function edge(
  fromFile: string,
  fromName: string,
  toFile: string,
  toName: string,
  kind: Edge["kind"] = "value",
): Edge {
  return {
    from: makeComponentId(fromFile, fromName, "function"),
    to: makeComponentId(toFile, toName, "function"),
    kind,
    uncertain: false,
  };
}

function graph(nodes: readonly Component[], edges: readonly Edge[]): Graph {
  const sorted = [...nodes].sort((a, b) => a.id.localeCompare(b.id));
  return { nodes: sorted, edges };
}

const SAMPLE_CANDIDATE: ArchCandidate = {
  nodeId: makeComponentId("src/a.ts", "A", "function"),
  primary: {
    smellType: "architectural_hub",
    composite: 0.92,
    contributing: [
      {
        axis: "fan_in_pct",
        weight: 0.4,
        value: 10,
        percentile: 1.0,
        rank: 1,
        thresholdDelta: 0.15,
        zScore: 2.1,
      },
    ],
  },
  secondary: [
    {
      smellType: "high_fanout_component",
      composite: 0.88,
      contributing: [
        {
          axis: "fan_out_pct",
          weight: 1.0,
          value: 8,
          percentile: 1.0,
          rank: 1,
          thresholdDelta: 0.15,
          zScore: 1.9,
        },
      ],
    },
  ],
};

describe("serializeReport — slim", () => {
  it("emits one hotspot per candidate with a file:line ref", () => {
    const g = graph(
      [comp("src/a.ts", "A"), comp("src/b.ts", "B")],
      [edge("src/b.ts", "B", "src/a.ts", "A")],
    );
    const report = serializeReport([SAMPLE_CANDIDATE], {
      tool: TOOL,
      verbose: false,
      ref: "HEAD",
      graph: g,
      sourceFileCount: 2,
    });
    expect(report.hotspots.length).toBe(1);
    const h = report.hotspots[0];
    expect(h?.ref).toEqual({
      location: "src/a.ts:12",
      kind: "function",
      name: "A",
    });
    expect(h?.kind).toBe("architecture");
    expect(h?.score).toEqual({ axis: "composite", value: 0.92 });
    expect(h?.smells).toEqual(["architectural_hub", "high_fanout_component"]);
    expect(h?.metrics).toEqual([
      {
        axis: "fan_in_pct",
        value: 10,
        percentile: 1.0,
        zScore: 2.1,
      },
    ]);
    expect(h?.dismissalId.startsWith("arch:")).toBe(true);
  });

  it("slim output drops summary and componentCount", () => {
    const g = graph([comp("src/a.ts", "A")], []);
    const report = serializeReport([SAMPLE_CANDIDATE], {
      tool: TOOL,
      verbose: false,
      ref: "HEAD",
      graph: g,
      sourceFileCount: 1,
    });
    expect(report.summary).toBeUndefined();
    expect(report.project.componentCount).toBeUndefined();
  });

  it("computes runtime share over fanIn + fanOut", () => {
    const g = graph(
      [comp("src/a.ts", "A"), comp("src/b.ts", "B"), comp("src/c.ts", "C")],
      [
        edge("src/b.ts", "B", "src/a.ts", "A"), // runtime
        edge("src/c.ts", "C", "src/a.ts", "A", "type"), // type-only
      ],
    );
    const report = serializeReport([SAMPLE_CANDIDATE], {
      tool: TOOL,
      verbose: false,
      ref: "HEAD",
      graph: g,
      sourceFileCount: 3,
    });
    const mix = report.hotspots[0]?.edgeMix;
    expect(mix?.fanIn).toBe(2);
    expect(mix?.fanOut).toBe(0);
    expect(mix?.runtimeShare).toBeCloseTo(0.5, 6);
  });
});

describe("serializeReport — verbose", () => {
  it("includes summary + componentCount", () => {
    const g = graph([comp("src/a.ts", "A")], []);
    const report = serializeReport([SAMPLE_CANDIDATE], {
      tool: TOOL,
      verbose: true,
      ref: "release/v2",
      graph: g,
      sourceFileCount: 1,
    });
    expect(report.summary?.ref).toBe("release/v2");
    expect(report.summary?.candidateCount).toBe(1);
    expect(report.summary?.smellCounts.architectural_hub).toBe(1);
    expect(report.summary?.smellCounts.bridge_component).toBe(0);
    expect(report.project.componentCount).toBe(1);
  });
});
