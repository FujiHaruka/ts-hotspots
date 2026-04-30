import { describe, expect, it } from "vitest";
import {
  STUB_PR_SUMMARY,
  STUB_WHOLE_REPO_SUMMARY,
} from "../../../test/dedup/helpers/stubSummary.ts";
import { RecordingPerfLogger } from "../cli/perfLog.ts";
import { defaultConfig } from "../config/index.ts";
import type { CandidateScore, ScoreBreakdown } from "../domain/candidate.ts";
import type { Fragment } from "../domain/fragment.ts";
import { parseSource } from "../indexer/parseSource.ts";
import { nonNull } from "../util/nonNull.ts";
import { buildEvidence } from "./evidence.ts";
import {
  buildJsonReport,
  type ReportInput,
  type ScoredPair,
} from "./jsonReport.ts";
import { deriveHint } from "./recommendationHint.ts";

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
    changedPath?: string;
    basePath?: string;
    intersections?: ScoredPair["intersections"];
    breakdown?: Partial<ScoreBreakdown>;
  } = {},
): ScoredPair {
  return {
    score: mkScore(changedId, baseId, combined, opts.breakdown),
    changedFragment: mkFragment(
      changedId,
      opts.changedPath ?? `${changedId}.ts`,
      1,
      10,
    ),
    baseFragment: mkFragment(baseId, opts.basePath ?? `${baseId}.ts`, 5, 20),
    intersections: opts.intersections ?? {
      tokens: [],
      statements: [],
      calls: [],
    },
  };
}

describe("buildJsonReport", () => {
  it("passes baseSha / headSha through verbatim", () => {
    const input: ReportInput = {
      pr: { baseSha: "deadbeef", headSha: "cafef00d" },
      pairs: [],
      config: defaultConfig,
      summary: STUB_PR_SUMMARY,
    };
    const report = buildJsonReport(input);
    expect(report.pr.baseSha).toBe("deadbeef");
    expect(report.pr.headSha).toBe("cafef00d");
  });

  it("emits one group per unique changed anchor", () => {
    const semanticIntersections = {
      tokens: [],
      statements: [],
      // A non-empty `calls` keeps the pair past `dropLowSemanticEvidence`,
      // which would otherwise drop low-combined evidence-less pairs.
      calls: ["call:CALL:foo"],
    };
    const pairs = [
      mkPair("c1", "b1", 0.5, { intersections: semanticIntersections }),
      mkPair("c2", "b2", 0.7, { intersections: semanticIntersections }),
      mkPair("c3", "b3", 0.3, { intersections: semanticIntersections }),
    ];
    const report = buildJsonReport({
      pr: { baseSha: "a", headSha: "b" },
      pairs,
      config: defaultConfig,
      summary: STUB_PR_SUMMARY,
    });
    expect(report.groups).toHaveLength(3);
  });

  it("collapses N pairs sharing an anchor into one group with N members", () => {
    const semanticIntersections = {
      tokens: [],
      statements: [],
      calls: ["call:CALL:foo"],
    };
    const pairs = [
      mkPair("c", "b1", 0.7, { intersections: semanticIntersections }),
      mkPair("c", "b2", 0.5, { intersections: semanticIntersections }),
      mkPair("c", "b3", 0.6, { intersections: semanticIntersections }),
    ];
    const report = buildJsonReport({
      pr: { baseSha: "a", headSha: "b" },
      pairs,
      config: defaultConfig,
      summary: STUB_PR_SUMMARY,
    });
    expect(report.groups).toHaveLength(1);
    const group = report.groups[0];
    if (group === undefined) throw new Error("expected group");
    expect(group.size).toBe(4);
    expect(group.members).toHaveLength(3);
    expect(group.members.map((m) => m.fragment.filePath)).toEqual([
      "b1.ts",
      "b3.ts",
      "b2.ts",
    ]);
  });

  it("populates anchor / member views with filePath / startLine / endLine / kind / code", () => {
    const changedText = "function foo() { return 1; }";
    const baseText = "function bar() { return 2; }";
    const pair: ScoredPair = {
      score: mkScore("c", "b", 0.5),
      changedFragment: {
        id: "c",
        filePath: "src/changed.ts",
        startLine: 12,
        endLine: 34,
        kind: "function",
        text: changedText,
        astNodeKind: "FunctionDeclaration",
      },
      baseFragment: {
        id: "b",
        filePath: "src/existing.ts",
        startLine: 5,
        endLine: 30,
        kind: "block",
        text: baseText,
        astNodeKind: "Block",
      },
      intersections: { tokens: [], statements: [], calls: [] },
    };
    const report = buildJsonReport({
      pr: { baseSha: "a", headSha: "b" },
      pairs: [pair],
      config: defaultConfig,
      summary: STUB_PR_SUMMARY,
    });
    const g = report.groups[0];
    expect(g).toBeDefined();
    if (!g) return;
    expect(g.anchor).toEqual({
      filePath: "src/changed.ts",
      startLine: 12,
      endLine: 34,
      kind: "function",
      code: changedText,
    });
    expect(g.members[0]?.fragment).toEqual({
      filePath: "src/existing.ts",
      startLine: 5,
      endLine: 30,
      kind: "block",
      code: baseText,
    });
  });

  it("populates member scores with combined + 5 breakdown axes", () => {
    const pair = mkPair("c", "b", 0.72, {
      breakdown: {
        tokenOverlap: 0.8,
        statementKindSimilarity: 0.9,
        callOverlap: 0.6,
        sizeCompatibility: 0.7,
        lengthScore: 0.4,
      },
    });
    const report = buildJsonReport({
      pr: { baseSha: "a", headSha: "b" },
      pairs: [pair],
      config: defaultConfig,
      summary: STUB_PR_SUMMARY,
    });
    const m = report.groups[0]?.members[0];
    expect(m).toBeDefined();
    if (!m) return;
    expect(m.scores).toEqual({
      combined: 0.72,
      tokenOverlap: 0.8,
      statementKindSimilarity: 0.9,
      callOverlap: 0.6,
      sizeCompatibility: 0.7,
      lengthScore: 0.4,
    });
  });

  it("member evidence matches buildEvidence on the pair's intersections", () => {
    const intersections = {
      tokens: ["token:A", "token:B"],
      statements: ["statement:IfStatement|ReturnStatement"],
      calls: ["call:CALL:findById", "call:PROP:user.id"],
    };
    const pair = mkPair("c", "b", 0.5, { intersections });
    const report = buildJsonReport({
      pr: { baseSha: "a", headSha: "b" },
      pairs: [pair],
      config: defaultConfig,
      summary: STUB_PR_SUMMARY,
    });
    const m = report.groups[0]?.members[0];
    expect(m).toBeDefined();
    if (!m) return;
    expect(m.evidence).toEqual(buildEvidence(intersections, defaultConfig));
  });

  it("recommendationHint matches deriveHint output for a single-member group", () => {
    const intersections = {
      tokens: [],
      statements: [],
      calls: ["call:CALL:foo"],
    };
    const pair = mkPair("c", "b", 0.8, {
      intersections,
      breakdown: {
        tokenOverlap: 0.8,
        statementKindSimilarity: 0.8,
        callOverlap: 0.8,
        sizeCompatibility: 0.8,
      },
    });
    const report = buildJsonReport({
      pr: { baseSha: "a", headSha: "b" },
      pairs: [pair],
      config: defaultConfig,
      summary: STUB_PR_SUMMARY,
    });
    const g = report.groups[0];
    expect(g).toBeDefined();
    if (!g) return;
    const evidence = buildEvidence(intersections, defaultConfig);
    const expected = deriveHint({
      score: pair.score,
      evidence,
      changed: pair.changedFragment,
      base: pair.baseFragment,
      thresholds: defaultConfig.scoring.thresholds,
    });
    expect(g.recommendationHint).toEqual(expected);
  });

  it("deduplicates pairs with the same (changedId, baseId)", () => {
    const pair = mkPair("c", "b", 0.5);
    const report = buildJsonReport({
      pr: { baseSha: "a", headSha: "b" },
      pairs: [pair, pair],
      config: defaultConfig,
      summary: STUB_PR_SUMMARY,
    });
    expect(report.groups).toHaveLength(1);
    expect(report.groups[0]?.members).toHaveLength(1);
  });

  it("orders groups by aggregate combined max desc", () => {
    const semanticIntersections = {
      tokens: [],
      statements: [],
      calls: ["call:CALL:foo"],
    };
    const pairs = [
      mkPair("c1", "b1", 0.3, { intersections: semanticIntersections }),
      mkPair("c2", "b2", 0.9, { intersections: semanticIntersections }),
      mkPair("c3", "b3", 0.6, { intersections: semanticIntersections }),
    ];
    const report = buildJsonReport({
      pr: { baseSha: "a", headSha: "b" },
      pairs,
      config: defaultConfig,
      summary: STUB_PR_SUMMARY,
    });
    expect(report.groups.map((g) => g.aggregateScores.combined.max)).toEqual([
      0.9, 0.6, 0.3,
    ]);
  });

  it("includes fragment source on anchor and member by default", () => {
    const intersections = {
      tokens: [],
      statements: [],
      calls: ["call:CALL:foo"],
    };
    const pairs = [mkPair("c1", "b1", 0.6, { intersections })];
    const report = buildJsonReport({
      pr: { baseSha: "a", headSha: "b" },
      pairs,
      config: defaultConfig,
      summary: STUB_PR_SUMMARY,
    });
    const g = report.groups[0];
    if (g === undefined) throw new Error("expected one group");
    expect(g.anchor?.code).toBe("// c1");
    expect(g.members[0]?.fragment.code).toBe("// b1");
  });

  it("omits fragment source when includeCode is false", () => {
    const intersections = {
      tokens: [],
      statements: [],
      calls: ["call:CALL:foo"],
    };
    const pairs = [mkPair("c1", "b1", 0.6, { intersections })];
    const report = buildJsonReport({
      pr: { baseSha: "a", headSha: "b" },
      pairs,
      config: defaultConfig,
      summary: STUB_PR_SUMMARY,
      includeCode: false,
    });
    const g = report.groups[0];
    if (g === undefined) throw new Error("expected one group");
    expect(g.anchor?.code).toBeUndefined();
    expect(g.members[0]?.fragment.code).toBeUndefined();
    expect(g.anchor?.filePath).toBe("c1.ts");
    expect(g.members[0]?.fragment.filePath).toBe("b1.ts");
  });

  it("does not serialise the code key when includeCode is false", () => {
    const intersections = {
      tokens: [],
      statements: [],
      calls: ["call:CALL:foo"],
    };
    const pairs = [mkPair("c1", "b1", 0.6, { intersections })];
    const report = buildJsonReport({
      pr: { baseSha: "a", headSha: "b" },
      pairs,
      config: defaultConfig,
      summary: STUB_PR_SUMMARY,
      includeCode: false,
    });
    const json = JSON.stringify(report);
    expect(json.includes('"code"')).toBe(false);
  });

  describe("dropThinWrapperPairs integration", () => {
    const thinSource = `function F() { return <X />; }`;
    const realSource = `function F() {
  const a = compute(input);
  const b = transform(a);
  if (b.length === 0) {
    return null;
  }
  return <Layout title={b}>{a.map((x) => render(x))}</Layout>;
}`;

    function thinFragment(id: string, filePath: string): Fragment {
      return {
        id,
        filePath,
        startLine: 1,
        endLine: thinSource.split("\n").length,
        kind: "function",
        text: thinSource,
        astNodeKind: "FunctionDeclaration",
      };
    }

    function realFragment(id: string, filePath: string): Fragment {
      return {
        id,
        filePath,
        startLine: 1,
        endLine: realSource.split("\n").length,
        kind: "function",
        text: realSource,
        astNodeKind: "FunctionDeclaration",
      };
    }

    function makePair(changed: Fragment, base: Fragment): ScoredPair {
      return {
        score: mkScore(changed.id, base.id, 0.95, {
          tokenOverlap: 1,
          statementKindSimilarity: 1,
          callOverlap: 1,
        }),
        changedFragment: changed,
        baseFragment: base,
        intersections: {
          tokens: [],
          statements: [],
          calls: ["call:CALL:foo"],
        },
      };
    }

    function buildSourceFileLookup(
      ...frags: Fragment[]
    ): NonNullable<ReportInput["getSourceFile"]> {
      const map = new Map<
        string,
        ReturnType<typeof parseSource>["sourceFile"]
      >();
      for (const f of frags) {
        if (!map.has(f.filePath)) {
          map.set(f.filePath, parseSource(f.filePath, f.text).sourceFile);
        }
      }
      return (filePath) => map.get(filePath);
    }

    it("drops both-side thin-wrapper pairs when getSourceFile is provided", () => {
      const a = thinFragment("a", "a.tsx");
      const b = thinFragment("b", "b.tsx");
      const report = buildJsonReport({
        pr: { baseSha: "x", headSha: "y" },
        pairs: [makePair(a, b)],
        config: defaultConfig,
        summary: STUB_PR_SUMMARY,
        getSourceFile: buildSourceFileLookup(a, b),
      });
      expect(report.groups).toHaveLength(0);
    });

    it("keeps both-side thin-wrapper pairs when getSourceFile is omitted (conservative fallback)", () => {
      const a = thinFragment("a", "a.tsx");
      const b = thinFragment("b", "b.tsx");
      const report = buildJsonReport({
        pr: { baseSha: "x", headSha: "y" },
        pairs: [makePair(a, b)],
        config: defaultConfig,
        summary: STUB_PR_SUMMARY,
      });
      expect(report.groups).toHaveLength(1);
    });

    it("keeps both-side thin-wrapper pairs when the filter is disabled via config", () => {
      const a = thinFragment("a", "a.tsx");
      const b = thinFragment("b", "b.tsx");
      const report = buildJsonReport({
        pr: { baseSha: "x", headSha: "y" },
        pairs: [makePair(a, b)],
        config: {
          ...defaultConfig,
          report: {
            ...defaultConfig.report,
            thinWrapper: {
              ...defaultConfig.report.thinWrapper,
              enabled: false,
            },
          },
        },
        summary: STUB_PR_SUMMARY,
        getSourceFile: buildSourceFileLookup(a, b),
      });
      expect(report.groups).toHaveLength(1);
    });

    it("keeps one-side thin-wrapper pairs and flags them via thin-wrapper-side", () => {
      const a = thinFragment("a", "a.tsx");
      const b = realFragment("b", "b.tsx");
      const report = buildJsonReport({
        pr: { baseSha: "x", headSha: "y" },
        pairs: [makePair(a, b)],
        config: defaultConfig,
        summary: STUB_PR_SUMMARY,
        getSourceFile: buildSourceFileLookup(a, b),
      });
      expect(report.groups).toHaveLength(1);
      const g = report.groups[0];
      if (g === undefined) throw new Error("expected one group");
      expect(g.recommendationHint.riskFlags).toContain("thin-wrapper-side");
    });

    it("emits dropThinWrapperPairs in perfLog summary", () => {
      const a = thinFragment("a", "a.tsx");
      const b = thinFragment("b", "b.tsx");
      const perfLog = new RecordingPerfLogger();
      buildJsonReport(
        {
          pr: { baseSha: "x", headSha: "y" },
          pairs: [makePair(a, b)],
          config: defaultConfig,
          summary: STUB_PR_SUMMARY,
          getSourceFile: buildSourceFileLookup(a, b),
        },
        perfLog,
      );
      const summary = perfLog.events.find((e) => e.name === "report.summary");
      expect(summary).toBeDefined();
      expect(summary?.payload).toMatchObject({ dropThinWrapperPairs: 0 });
    });

    it("emits reportedGroups in perfLog summary", () => {
      const a = realFragment("a", "a.ts");
      const b = realFragment("b", "b.ts");
      const perfLog = new RecordingPerfLogger();
      buildJsonReport(
        {
          pr: { baseSha: "x", headSha: "y" },
          pairs: [makePair(a, b)],
          config: defaultConfig,
          summary: STUB_PR_SUMMARY,
          getSourceFile: buildSourceFileLookup(a, b),
        },
        perfLog,
      );
      const summary = perfLog.events.find((e) => e.name === "report.summary");
      expect(summary?.payload).toMatchObject({ reportedGroups: 1 });
    });
  });

  describe("whole-repo cluster path", () => {
    const semanticIntersections = {
      tokens: [],
      statements: [],
      calls: ["call:CALL:foo"],
    };

    it("collapses a triangle {A,B,C} into a single anchor-less cluster", () => {
      const pairs = [
        mkPair("a", "b", 0.8, { intersections: semanticIntersections }),
        mkPair("a", "c", 0.7, { intersections: semanticIntersections }),
        mkPair("b", "c", 0.75, { intersections: semanticIntersections }),
      ];
      const report = buildJsonReport({
        pr: { baseSha: "x", headSha: "x" },
        pairs,
        config: defaultConfig,
        summary: STUB_WHOLE_REPO_SUMMARY,
      });
      expect(report.groups).toHaveLength(1);
      const g = nonNull(report.groups[0]);
      expect(g.anchor).toBeUndefined();
      expect(g.size).toBe(3);
      expect(g.members.map((m) => m.fragment.filePath).sort()).toEqual([
        "a.ts",
        "b.ts",
        "c.ts",
      ]);
    });

    it("splits a chain when minDensity strictly exceeds 2/3", () => {
      // Chain A-B-C-D: edges (A,B), (B,C), (C,D). With minDensity 0.7
      // no triple reaches the density gate, so the chain is sliced into
      // size-2 clusters that share no fragment.
      const pairs = [
        mkPair("a", "b", 0.8, { intersections: semanticIntersections }),
        mkPair("b", "c", 0.8, { intersections: semanticIntersections }),
        mkPair("c", "d", 0.8, { intersections: semanticIntersections }),
      ];
      const config = {
        ...defaultConfig,
        report: {
          ...defaultConfig.report,
          cluster: { ...defaultConfig.report.cluster, minDensity: 0.7 },
        },
      };
      const report = buildJsonReport({
        pr: { baseSha: "x", headSha: "x" },
        pairs,
        config,
        summary: STUB_WHOLE_REPO_SUMMARY,
      });
      expect(report.groups.length).toBeGreaterThanOrEqual(2);
      for (const g of report.groups) {
        expect(g.size).toBeLessThanOrEqual(2);
      }
    });

    it("PR mode keeps anchor-pivot output (cluster path off)", () => {
      const pairs = [
        mkPair("c", "b1", 0.7, { intersections: semanticIntersections }),
        mkPair("c", "b2", 0.6, { intersections: semanticIntersections }),
      ];
      const report = buildJsonReport({
        pr: { baseSha: "x", headSha: "y" },
        pairs,
        config: defaultConfig,
        summary: STUB_PR_SUMMARY,
      });
      expect(report.groups).toHaveLength(1);
      expect(report.groups[0]?.anchor?.filePath).toBe("c.ts");
      expect(report.groups[0]?.size).toBe(3);
    });
  });

  it("is deterministic: two runs produce identical JSON strings", () => {
    const intersections = {
      tokens: ["token:A", "token:B"],
      statements: ["statement:X"],
      calls: ["call:CALL:foo", "call:PROP:x.y"],
    };
    const pairs = [
      mkPair("c2", "b2", 0.5, { intersections }),
      mkPair("c1", "b1", 0.8, { intersections }),
      mkPair("c3", "b1", 0.5, { intersections }),
    ];
    const input: ReportInput = {
      pr: { baseSha: "a", headSha: "b" },
      pairs,
      config: defaultConfig,
      summary: STUB_PR_SUMMARY,
    };
    const a = JSON.stringify(buildJsonReport(input));
    const b = JSON.stringify(buildJsonReport(input));
    expect(a).toBe(b);
  });
});
