import { describe, expect, test } from "vitest";
import type { ReportTool } from "../../schema.ts";
import type { PairMetrics } from "../metrics/computeMetrics.ts";
import type { Candidate } from "../ranking/types.ts";
import {
  computeCochangeClusterDismissalId,
  computeCochangePairDismissalId,
} from "./dismissalId.ts";
import type {
  SerializedCochangeReport,
  SerializedCochangeReportVerbose,
} from "./schema.ts";
import { type CochangeReportInput, serializeReport } from "./serializeJson.ts";

function asVerbose(
  out: SerializedCochangeReport | SerializedCochangeReportVerbose,
): SerializedCochangeReportVerbose {
  return out as SerializedCochangeReportVerbose;
}

const TOOL: ReportTool = { name: "ts-hotspots", version: "0.1.0" };

function metric(
  support: number,
  confidenceMax: number,
  lift: number,
  confidenceAtoB = confidenceMax,
  confidenceBtoA = confidenceMax,
): PairMetrics {
  return { support, confidenceAtoB, confidenceBtoA, confidenceMax, lift };
}

function candidate(
  pathA: string,
  pathB: string,
  m: PairMetrics,
  recent: string[] = [],
): Candidate {
  return {
    pairKey: `${pathA} ${pathB}`,
    pathA,
    pathB,
    metrics: m,
    recent,
  };
}

function baseInput(
  candidates: readonly Candidate[],
  perFileChanges = new Map<string, number>(),
): CochangeReportInput {
  return {
    candidates,
    perFileChanges,
    windowCommits: 200,
    analyzedFileCount: 50,
    pairCandidateCountBeforeGate: candidates.length + 5,
    pairsAfterGate: candidates.length,
    commitsSkippedAsLargeChange: 1,
    requestedWindow: 200,
    actualWindow: 200,
    tool: TOOL,
  };
}

describe("serializeReport (slim)", () => {
  test("empty result yields an empty hotspots array and no summary", () => {
    const out = serializeReport(baseInput([]), { verbose: false });
    expect(out.hotspots).toEqual([]);
    expect(out.summary).toBeUndefined();
    expect(out.project).toEqual({
      windowCommits: 200,
      analyzedFileCount: 50,
    });
    expect(out.diff).toBeUndefined();
    expect(out.dismissed).toBeUndefined();
  });

  test("single pair: members are lex-ordered, anchor omitted, score is supportConfidence", () => {
    const c = candidate("src/a.ts", "src/b.ts", metric(5, 0.5, 2.0, 0.5, 0.4), [
      "abc1234",
      "def5678",
    ]);
    const out = serializeReport(baseInput([c]), { verbose: false });
    expect(out.hotspots).toHaveLength(1);
    const h = out.hotspots[0];
    if (h === undefined) throw new Error("expected hotspot");
    expect(h.kind).toBe("cochange");
    expect(h.size).toBe(2);
    expect(h.anchor).toBeUndefined();
    expect(h.members).toEqual([
      { ref: { location: "src/a.ts", kind: "file" } },
      { ref: { location: "src/b.ts", kind: "file" } },
    ]);
    expect(h.score).toEqual({ axis: "supportConfidence", value: 5 * 0.5 });
    expect(h.metrics).toEqual({
      support: 5,
      confidenceAtoB: 0.5,
      confidenceBtoA: 0.4,
      confidenceMax: 0.5,
      lift: 2.0,
    });
    expect(h.evidence).toEqual({ recentCommits: ["abc1234", "def5678"] });
    expect(h.dismissalId).toBe(
      computeCochangePairDismissalId("src/a.ts", "src/b.ts"),
    );
  });

  test("slim output omits verbose fields (changesOfA/B, allCoChangeCommits)", () => {
    const c = candidate("src/a.ts", "src/b.ts", metric(5, 0.5, 2.0), [
      "abc1234",
    ]);
    const out = serializeReport(baseInput([c]), { verbose: false });
    const h = out.hotspots[0] as unknown as Record<string, unknown>;
    expect(h).toBeDefined();
    expect((h.metrics as Record<string, unknown>).changesOfA).toBeUndefined();
    expect((h.metrics as Record<string, unknown>).changesOfB).toBeUndefined();
    expect(
      (h.evidence as Record<string, unknown>).allCoChangeCommits,
    ).toBeUndefined();
    expect(
      (h.evidence as Record<string, unknown>).coChangeWindow,
    ).toBeUndefined();
  });

  test("multiple pairs: hotspots preserve input candidate order", () => {
    const candidates = [
      candidate("src/a.ts", "src/b.ts", metric(10, 0.8, 3.0), ["c1"]),
      candidate("src/c.ts", "src/d.ts", metric(5, 0.5, 1.5), ["c2"]),
      candidate("src/e.ts", "src/f.ts", metric(3, 0.3, 1.1), []),
    ];
    const out = serializeReport(baseInput(candidates), { verbose: false });
    expect(out.hotspots.map((h) => h.members[0]?.ref.location)).toEqual([
      "src/a.ts",
      "src/c.ts",
      "src/e.ts",
    ]);
  });

  test("slim caps recentCommits at 5 even when the walker kept more", () => {
    const recent = ["s0", "s1", "s2", "s3", "s4", "s5", "s6"];
    const c = candidate("src/a.ts", "src/b.ts", metric(7, 0.5, 2.0), recent);
    const out = serializeReport(baseInput([c]), { verbose: false });
    const h = out.hotspots[0];
    if (h === undefined) throw new Error("expected hotspot");
    expect(h.evidence.recentCommits).toEqual(["s0", "s1", "s2", "s3", "s4"]);
  });

  test("score.value is monotonically non-increasing along hotspots[] (matches sort key)", () => {
    // Candidates fed in sort order — `score.value` must mirror that order
    // so JSON readers see the same monotonicity as the ranking.
    const candidates = [
      candidate("src/a.ts", "src/b.ts", metric(10, 0.8, 3.0), ["c1"]),
      candidate("src/c.ts", "src/d.ts", metric(5, 0.5, 1.5), ["c2"]),
      candidate("src/e.ts", "src/f.ts", metric(3, 0.3, 1.1), []),
    ];
    const out = serializeReport(baseInput(candidates), { verbose: false });
    expect(
      out.hotspots.every(
        (h, i) =>
          i === 0 ||
          h.score.value <= (out.hotspots[i - 1]?.score.value ?? Infinity),
      ),
    ).toBe(true);
  });

  test("determinism: two runs over identical input produce bit-identical JSON", () => {
    const candidates = [
      candidate("src/a.ts", "src/b.ts", metric(10, 0.8, 3.0), ["c1", "c2"]),
      candidate("src/c.ts", "src/d.ts", metric(5, 0.5, 1.5), ["c3"]),
    ];
    const input = baseInput(candidates);
    const a = JSON.stringify(serializeReport(input, { verbose: false }));
    const b = JSON.stringify(serializeReport(input, { verbose: false }));
    expect(a).toBe(b);
  });
});

describe("serializeReport (verbose)", () => {
  test("attaches summary, project.pairCandidateCountBeforeGate, and per-pair denominators", () => {
    const c = candidate("src/a.ts", "src/b.ts", metric(5, 0.5, 2.0, 0.5, 0.4), [
      "abc1234",
      "def5678",
      "ffeeddc",
    ]);
    const perFileChanges = new Map<string, number>([
      ["src/a.ts", 10],
      ["src/b.ts", 12],
    ]);
    const input: CochangeReportInput = {
      ...baseInput([c], perFileChanges),
      pairCandidateCountBeforeGate: 7,
      pairsAfterGate: 1,
      commitsSkippedAsLargeChange: 2,
      requestedWindow: 200,
      actualWindow: 198,
    };
    const out = asVerbose(serializeReport(input, { verbose: true }));
    expect(out.project.pairCandidateCountBeforeGate).toBe(7);
    expect(out.summary).toEqual({
      requestedWindow: 200,
      actualWindow: 198,
      commitsSkippedAsLargeChange: 2,
      pairsBeforeGate: 7,
      pairsAfterGate: 1,
    });
    const h = out.hotspots[0];
    if (h === undefined) throw new Error("expected hotspot");
    expect(h.metrics.changesOfA).toBe(10);
    expect(h.metrics.changesOfB).toBe(12);
    expect(h.evidence.allCoChangeCommits).toEqual([
      "abc1234",
      "def5678",
      "ffeeddc",
    ]);
    expect(h.evidence.coChangeWindow).toEqual({
      firstSha: "abc1234",
      lastSha: "ffeeddc",
    });
  });

  test("verbose with empty recent[]: coChangeWindow is omitted", () => {
    const c = candidate("src/a.ts", "src/b.ts", metric(5, 0.5, 2.0), []);
    const out = asVerbose(serializeReport(baseInput([c]), { verbose: true }));
    const h = out.hotspots[0];
    if (h === undefined) throw new Error("expected hotspot");
    expect(h.evidence.coChangeWindow).toBeUndefined();
    expect(h.evidence.allCoChangeCommits).toEqual([]);
    expect(h.evidence.recentCommits).toEqual([]);
  });

  test("verbose with denominator missing falls back to 0", () => {
    const c = candidate("src/a.ts", "src/b.ts", metric(5, 0.5, 2.0), ["x"]);
    const out = asVerbose(serializeReport(baseInput([c]), { verbose: true }));
    const h = out.hotspots[0];
    if (h === undefined) throw new Error("expected hotspot");
    expect(h.metrics.changesOfA).toBe(0);
    expect(h.metrics.changesOfB).toBe(0);
  });

  test("verbose: allCoChangeCommits.length === metrics.support; recentCommits stays capped at 5", () => {
    const recent = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"];
    const c = candidate("src/a.ts", "src/b.ts", metric(8, 0.5, 2.0), recent);
    const out = asVerbose(serializeReport(baseInput([c]), { verbose: true }));
    const h = out.hotspots[0];
    if (h === undefined) throw new Error("expected hotspot");
    expect(h.evidence.allCoChangeCommits).toEqual(recent);
    expect(h.evidence.allCoChangeCommits.length).toBe(h.metrics.support);
    expect(h.evidence.recentCommits).toEqual(["s0", "s1", "s2", "s3", "s4"]);
    expect(h.evidence.coChangeWindow).toEqual({
      firstSha: "s0",
      lastSha: "s7",
    });
  });

  test("verbose determinism: two runs produce bit-identical JSON", () => {
    const c = candidate("src/a.ts", "src/b.ts", metric(5, 0.5, 2.0), [
      "c1",
      "c2",
    ]);
    const perFileChanges = new Map<string, number>([
      ["src/a.ts", 10],
      ["src/b.ts", 12],
    ]);
    const input = baseInput([c], perFileChanges);
    const a = JSON.stringify(serializeReport(input, { verbose: true }));
    const b = JSON.stringify(serializeReport(input, { verbose: true }));
    expect(a).toBe(b);
  });
});

describe("serializeReport (cluster rollup)", () => {
  test("triangle of pairs collapses to a single cluster row", () => {
    const candidates = [
      candidate("src/a.ts", "src/b.ts", metric(6, 0.8, 3.0), ["sha1"]),
      candidate("src/b.ts", "src/c.ts", metric(4, 0.6, 2.0), ["sha2"]),
      candidate("src/a.ts", "src/c.ts", metric(3, 1.0, 1.5), ["sha3"]),
    ];
    const out = serializeReport(baseInput(candidates), { verbose: false });
    expect(out.hotspots).toHaveLength(1);
    const h = out.hotspots[0];
    if (h === undefined) throw new Error("expected hotspot");
    expect(h.size).toBe(3);
    expect(h.members.map((m) => m.ref.location)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
    // scoreMax = max(6*0.8, 4*0.6, 3*1.0) = 4.8
    expect(h.score.axis).toBe("supportConfidence");
    expect(h.score.value).toBeCloseTo(4.8);
    // Median support [3, 4, 6] = 4; max confidenceMax = 1.0; median lift [1.5, 2.0, 3.0] = 2.0
    expect(h.metrics.support).toBe(4);
    expect(h.metrics.confidenceMax).toBe(1.0);
    expect(h.metrics.lift).toBe(2.0);
    expect(h.evidence.recentCommits).toEqual(["sha1", "sha2", "sha3"]);
    expect(h.dismissalId).toBe(
      computeCochangeClusterDismissalId(["src/a.ts", "src/b.ts", "src/c.ts"]),
    );
  });

  test("cluster verbose: allCoChangeCommits is the SHA union, changesOf{A,B} omitted", () => {
    const candidates = [
      candidate("src/a.ts", "src/b.ts", metric(4, 0.8, 3.0), [
        "sha1",
        "shared",
      ]),
      candidate("src/b.ts", "src/c.ts", metric(3, 0.6, 2.0), [
        "shared",
        "sha2",
      ]),
      candidate("src/a.ts", "src/c.ts", metric(3, 1.0, 1.5), ["sha3"]),
    ];
    const out = asVerbose(
      serializeReport(baseInput(candidates), { verbose: true }),
    );
    expect(out.hotspots).toHaveLength(1);
    const h = out.hotspots[0];
    if (h === undefined) throw new Error("expected hotspot");
    // SHA union dedupes "shared" first-occurrence.
    expect(h.evidence.allCoChangeCommits).toEqual([
      "sha1",
      "shared",
      "sha2",
      "sha3",
    ]);
    expect(h.evidence.coChangeWindow).toEqual({
      firstSha: "sha1",
      lastSha: "sha3",
    });
    // No canonical A/B side at the cluster level.
    expect(h.metrics.changesOfA).toBeUndefined();
    expect(h.metrics.changesOfB).toBeUndefined();
  });

  test("anchor-mode preserves pair shape (no cluster rollup)", () => {
    // Three pairs all sharing the anchor — would form a star (density
    // < 0.5) anyway, but the test point is that anchor mode is a hard
    // bypass regardless of the underlying graph.
    const candidates = [
      {
        ...candidate("src/anchor.ts", "src/a.ts", metric(5, 0.8, 2.0)),
        anchor: "src/anchor.ts",
      },
      {
        ...candidate("src/anchor.ts", "src/b.ts", metric(4, 0.7, 1.8)),
        anchor: "src/anchor.ts",
      },
      {
        ...candidate("src/anchor.ts", "src/c.ts", metric(3, 0.6, 1.5)),
        anchor: "src/anchor.ts",
      },
    ];
    const out = serializeReport(baseInput(candidates), { verbose: false });
    expect(out.hotspots).toHaveLength(3);
    for (const h of out.hotspots) {
      expect(h.size).toBe(2);
      expect(h.anchor?.ref.location).toBe("src/anchor.ts");
    }
  });

  test("disjoint pair next to a cluster: each renders independently in input order", () => {
    // (d, e) is a higher-scored disjoint pair. (a, b, c) form a triangle.
    const candidates = [
      candidate("src/d.ts", "src/e.ts", metric(8, 0.9, 4.0), ["px1"]),
      candidate("src/a.ts", "src/b.ts", metric(6, 0.8, 3.0), ["sha1"]),
      candidate("src/b.ts", "src/c.ts", metric(4, 0.6, 2.0), ["sha2"]),
      candidate("src/a.ts", "src/c.ts", metric(3, 1.0, 1.5), ["sha3"]),
    ];
    const out = serializeReport(baseInput(candidates), { verbose: false });
    expect(out.hotspots).toHaveLength(2);
    expect(out.hotspots[0]?.size).toBe(2);
    expect(out.hotspots[0]?.members.map((m) => m.ref.location)).toEqual([
      "src/d.ts",
      "src/e.ts",
    ]);
    expect(out.hotspots[1]?.size).toBe(3);
    expect(out.hotspots[1]?.members.map((m) => m.ref.location)).toEqual([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
    // Sort monotonicity preserved: pair score 7.2 > cluster scoreMax 4.8.
    expect(
      (out.hotspots[0]?.score.value ?? 0) >=
        (out.hotspots[1]?.score.value ?? 0),
    ).toBe(true);
  });
});
