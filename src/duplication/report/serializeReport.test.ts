import { describe, expect, it } from "vitest";
import {
  STUB_DIFF_SUMMARY,
  STUB_WHOLE_REPO_SUMMARY,
} from "../../../test/dedup/helpers/stubSummary.ts";
import { defaultConfig } from "../config/index.ts";
import type { CandidateScore, ScoreBreakdown } from "../domain/candidate.ts";
import type { Fragment } from "../domain/fragment.ts";
import { buildJsonReport, type ScoredPair } from "./jsonReport.ts";
import { serializeReport } from "./serializeReport.ts";

function mkFragment(
  id: string,
  filePath: string,
  startLine: number,
  endLine: number,
  text = `// ${id}`,
): Fragment {
  return {
    id,
    filePath,
    startLine,
    endLine,
    kind: "function",
    text,
    astNodeKind: "FunctionDeclaration",
  };
}

function mkScore(
  changedId: string,
  baseId: string,
  combined: number,
  breakdown: Partial<ScoreBreakdown> = {},
): CandidateScore {
  return {
    changedFragmentId: changedId,
    baseFragmentId: baseId,
    combined,
    breakdown: {
      tokenOverlap: 0.5,
      statementKindSimilarity: 0.5,
      callOverlap: 0.5,
      sizeCompatibility: 0.5,
      lengthScore: 0.5,
      ...breakdown,
    },
  };
}

function mkPair(
  changedId: string,
  baseId: string,
  combined: number,
  opts: {
    intersections?: ScoredPair["intersections"];
    breakdown?: Partial<ScoreBreakdown>;
  } = {},
): ScoredPair {
  return {
    score: mkScore(changedId, baseId, combined, opts.breakdown),
    changedFragment: mkFragment(changedId, `${changedId}.ts`, 1, 10),
    baseFragment: mkFragment(baseId, `${baseId}.ts`, 5, 20),
    intersections: opts.intersections ?? {
      tokens: [],
      statements: [],
      calls: [],
    },
  };
}

const SEMANTIC = {
  tokens: ["token:foo bar", "token:bar baz", "token:baz qux", "token:qux quux"],
  statements: ["statement:IfStatement|ReturnStatement"],
  calls: [
    "call:CALL:findById",
    "call:NEW:Cache",
    "call:AWAIT_CALL:save",
    "call:PROP:user.id",
  ],
};

describe("serializeReport (slim default)", () => {
  it("renames `groups` to `hotspots`, omits `status`, drops the analysis summary", () => {
    const report = buildJsonReport({
      diff: { baseSha: "a", headSha: "b", threeDot: false, changedFiles: 1 },
      pairs: [mkPair("c", "b", 0.7, { intersections: SEMANTIC })],
      config: defaultConfig,
      summary: STUB_DIFF_SUMMARY,
    });
    const out = serializeReport(report, { verbose: false });
    expect(out).toMatchObject({ hotspots: expect.any(Array) as unknown });
    const raw = out as unknown as Record<string, unknown>;
    expect(raw.groups).toBeUndefined();
    // Success reports omit `status`; only error envelopes keep it.
    expect(raw.status).toBeUndefined();
    expect(out.summary).toBeUndefined();
  });

  it("trims `project` to `sourceFileCount` only", () => {
    const summary = {
      ...STUB_DIFF_SUMMARY,
      scope: {
        ...STUB_DIFF_SUMMARY.scope,
        base: { ...STUB_DIFF_SUMMARY.scope.base, files: 42 },
      },
    };
    const report = buildJsonReport({
      diff: { baseSha: "a", headSha: "b", threeDot: false, changedFiles: 1 },
      pairs: [],
      config: defaultConfig,
      summary,
    });
    const out = serializeReport(report, { verbose: false });
    expect(out.project).toEqual({ sourceFileCount: 42 });
  });

  it("keeps `diff` block in diff mode and drops it in whole-repo mode", () => {
    const diff = buildJsonReport({
      diff: {
        baseSha: "deadbeef",
        headSha: "cafef00d",
        threeDot: true,
        changedFiles: 3,
      },
      pairs: [],
      config: defaultConfig,
      summary: STUB_DIFF_SUMMARY,
    });
    const wr = buildJsonReport({
      diff: { baseSha: "x", headSha: "x", threeDot: false, changedFiles: 0 },
      pairs: [],
      config: defaultConfig,
      summary: STUB_WHOLE_REPO_SUMMARY,
    });
    expect(serializeReport(diff, { verbose: false }).diff).toEqual({
      baseSha: "deadbeef",
      headSha: "cafef00d",
      threeDot: true,
      changedFiles: 3,
    });
    expect(serializeReport(wr, { verbose: false }).diff).toBeUndefined();
  });

  it("emits a slim hotspot per group with anchor, members, score, evidence, dismissalId", () => {
    const report = buildJsonReport({
      diff: { baseSha: "a", headSha: "b", threeDot: false, changedFiles: 1 },
      pairs: [mkPair("c", "b", 0.7, { intersections: SEMANTIC })],
      config: defaultConfig,
      summary: STUB_DIFF_SUMMARY,
    });
    const out = serializeReport(report, { verbose: false });
    const h = out.hotspots[0];
    expect(h).toBeDefined();
    if (h === undefined) return;
    expect(h.kind).toBe("duplication");
    expect(h.size).toBe(2);
    expect(h.anchor).toEqual({
      ref: { location: "c.ts:1-10", kind: "function" },
    });
    expect(h.members).toEqual([
      { ref: { location: "b.ts:5-20", kind: "function" } },
    ]);
    expect(h.score.axis).toBe("combined");
    expect(h.score.value).toBeCloseTo(0.7);
    expect(h.dismissalId.startsWith("dup:")).toBe(true);
  });

  it("strips evidence prefixes and humanises NEW/AWAIT_CALL into `new X` / `await X`", () => {
    const report = buildJsonReport({
      diff: { baseSha: "a", headSha: "b", threeDot: false, changedFiles: 1 },
      pairs: [mkPair("c", "b", 0.7, { intersections: SEMANTIC })],
      config: defaultConfig,
      summary: STUB_DIFF_SUMMARY,
    });
    const evidence = serializeReport(report, { verbose: false }).hotspots[0]
      ?.evidence;
    expect(evidence).toBeDefined();
    if (evidence === undefined) return;
    expect(evidence.calls).toEqual(
      expect.arrayContaining(["findById", "new Cache", "await save"]),
    );
    expect(evidence.properties).toEqual(["user.id"]);
    // Internal prefixes must not leak into the slim output.
    for (const c of evidence.calls) {
      expect(c.startsWith("CALL:")).toBe(false);
      expect(c.startsWith("NEW:")).toBe(false);
      expect(c.startsWith("AWAIT_CALL:")).toBe(false);
    }
    for (const p of evidence.properties) {
      expect(p.startsWith("PROP:")).toBe(false);
    }
  });

  it("does not embed fragment source in slim output", () => {
    const report = buildJsonReport({
      diff: { baseSha: "a", headSha: "b", threeDot: false, changedFiles: 1 },
      pairs: [mkPair("c", "b", 0.7, { intersections: SEMANTIC })],
      config: defaultConfig,
      summary: STUB_DIFF_SUMMARY,
      includeCode: true,
    });
    const json = JSON.stringify(serializeReport(report, { verbose: false }));
    expect(json.includes('"code"')).toBe(false);
  });

  it("omits anchor in whole-repo cluster output", () => {
    const pairs = [
      mkPair("a", "b", 0.8, { intersections: SEMANTIC }),
      mkPair("a", "c", 0.7, { intersections: SEMANTIC }),
      mkPair("b", "c", 0.75, { intersections: SEMANTIC }),
    ];
    const report = buildJsonReport({
      diff: { baseSha: "x", headSha: "x", threeDot: false, changedFiles: 0 },
      pairs,
      config: defaultConfig,
      summary: STUB_WHOLE_REPO_SUMMARY,
    });
    const out = serializeReport(report, { verbose: false });
    const h = out.hotspots[0];
    expect(h).toBeDefined();
    if (h === undefined) return;
    expect(h.anchor).toBeUndefined();
    expect(h.members.length).toBe(3);
  });

  it("score equals the group's median combined", () => {
    // Three pairs with combined 0.4, 0.6, 0.8 → median 0.6.
    const intersections = SEMANTIC;
    const pairs = [
      mkPair("c", "b1", 0.4, { intersections }),
      mkPair("c", "b2", 0.6, { intersections }),
      mkPair("c", "b3", 0.8, { intersections }),
    ];
    const report = buildJsonReport({
      diff: { baseSha: "a", headSha: "b", threeDot: false, changedFiles: 1 },
      pairs,
      config: defaultConfig,
      summary: STUB_DIFF_SUMMARY,
    });
    const score = serializeReport(report, { verbose: false }).hotspots[0]
      ?.score;
    expect(score?.axis).toBe("combined");
    expect(score?.value).toBeCloseTo(0.6);
  });

  it("two runs produce identical JSON strings", () => {
    const pairs = [
      mkPair("c2", "b2", 0.5, { intersections: SEMANTIC }),
      mkPair("c1", "b1", 0.8, { intersections: SEMANTIC }),
    ];
    const report = buildJsonReport({
      diff: { baseSha: "a", headSha: "b", threeDot: false, changedFiles: 1 },
      pairs,
      config: defaultConfig,
      summary: STUB_DIFF_SUMMARY,
    });
    const a = JSON.stringify(serializeReport(report, { verbose: false }));
    const b = JSON.stringify(serializeReport(report, { verbose: false }));
    expect(a).toBe(b);
  });
});

describe("serializeReport (verbose)", () => {
  it("re-includes `summary`, per-member scores, full evidence, and recommendation hint", () => {
    const report = buildJsonReport({
      diff: { baseSha: "a", headSha: "b", threeDot: false, changedFiles: 1 },
      pairs: [mkPair("c", "b", 0.7, { intersections: SEMANTIC })],
      config: defaultConfig,
      summary: STUB_DIFF_SUMMARY,
      includeCode: true,
    });
    const out = serializeReport(report, { verbose: true });
    expect(out.summary).toBeDefined();
    const h = out.hotspots[0];
    expect(h).toBeDefined();
    if (h === undefined) return;
    // Verbose-only fields:
    if (!("aggregateScores" in h)) {
      throw new Error("expected verbose hotspot");
    }
    expect(h.aggregateScores.combined.median).toBeGreaterThan(0);
    expect(h.recommendationHint.confidence).toBeDefined();
    expect(h.evidenceFull.statementKinds.length).toBeGreaterThan(0);
    const member = h.members[0];
    expect(member).toBeDefined();
    if (member === undefined) return;
    expect(member.scores.combined).toBeCloseTo(0.7);
    expect(member.code).toBeDefined();
  });
});
