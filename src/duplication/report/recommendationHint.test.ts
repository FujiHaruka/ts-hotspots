import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import type { CandidateScore, ScoreBreakdown } from "../domain/candidate.ts";
import type { Fragment } from "../domain/fragment.ts";
import type { Evidence } from "../domain/report.ts";
import { deriveHint } from "./recommendationHint.ts";

function mkBreakdown(partial: Partial<ScoreBreakdown> = {}): ScoreBreakdown {
  return {
    tokenOverlap: 0,
    statementKindSimilarity: 0,
    callOverlap: 0,
    sizeCompatibility: 0,
    lengthScore: 0,
    ...partial,
  };
}

function mkScore(
  combined: number,
  breakdown: Partial<ScoreBreakdown> = {},
): CandidateScore {
  return {
    changedFragmentId: "c",
    baseFragmentId: "b",
    combined,
    breakdown: mkBreakdown(breakdown),
  };
}

function mkFragment(id: string, filePath: string, lines = 10): Fragment {
  return {
    id,
    filePath,
    startLine: 1,
    endLine: lines,
    kind: "function",
    text: "",
    astNodeKind: "FunctionDeclaration",
  };
}

const emptyEvidence: Evidence = {
  sharedCalls: [],
  sharedProperties: [],
  matchedStatementKinds: [],
  matchedTokenNgramsSample: [],
};

const evidenceWithCalls: Evidence = {
  sharedCalls: ["CALL:findById"],
  sharedProperties: [],
  matchedStatementKinds: [],
  matchedTokenNgramsSample: [],
};

const thresholds = defaultConfig.scoring.thresholds;

describe("deriveHint — confidence", () => {
  it("combined >= 0.7 → high", () => {
    const hint = deriveHint({
      score: mkScore(0.75),
      evidence: evidenceWithCalls,
      changed: mkFragment("c", "a.ts"),
      base: mkFragment("b", "b.ts"),
      thresholds,
    });
    expect(hint.confidence).toBe("high");
  });

  it("combined in [0.4, 0.7) → medium", () => {
    const hint = deriveHint({
      score: mkScore(0.5),
      evidence: evidenceWithCalls,
      changed: mkFragment("c", "a.ts"),
      base: mkFragment("b", "b.ts"),
      thresholds,
    });
    expect(hint.confidence).toBe("medium");
  });

  it("combined at 0.4 boundary → medium", () => {
    const hint = deriveHint({
      score: mkScore(0.4),
      evidence: evidenceWithCalls,
      changed: mkFragment("c", "a.ts"),
      base: mkFragment("b", "b.ts"),
      thresholds,
    });
    expect(hint.confidence).toBe("medium");
  });

  it("combined < 0.4 → low", () => {
    const hint = deriveHint({
      score: mkScore(0.2),
      evidence: evidenceWithCalls,
      changed: mkFragment("c", "a.ts"),
      base: mkFragment("b", "b.ts"),
      thresholds,
    });
    expect(hint.confidence).toBe("low");
  });
});

describe("deriveHint — likelyRefactoring", () => {
  it("token>=0.7 & statement>=0.7 & size>=0.6 → extract-function", () => {
    const hint = deriveHint({
      score: mkScore(0.8, {
        tokenOverlap: 0.75,
        statementKindSimilarity: 0.8,
        sizeCompatibility: 0.7,
      }),
      evidence: evidenceWithCalls,
      changed: mkFragment("c", "a.ts"),
      base: mkFragment("b", "b.ts"),
      thresholds,
    });
    expect(hint.likelyRefactoring).toBe("extract-function");
  });

  it("call>=0.5 & statement>=0.5 (but not extract-function) → parameterize", () => {
    const hint = deriveHint({
      score: mkScore(0.55, {
        tokenOverlap: 0.3,
        statementKindSimilarity: 0.6,
        callOverlap: 0.6,
        sizeCompatibility: 0.2,
      }),
      evidence: evidenceWithCalls,
      changed: mkFragment("c", "a.ts"),
      base: mkFragment("b", "b.ts"),
      thresholds,
    });
    expect(hint.likelyRefactoring).toBe("parameterize");
  });

  it("extract-function takes priority when both rules match", () => {
    const hint = deriveHint({
      score: mkScore(0.9, {
        tokenOverlap: 0.9,
        statementKindSimilarity: 0.9,
        callOverlap: 0.9,
        sizeCompatibility: 0.9,
      }),
      evidence: evidenceWithCalls,
      changed: mkFragment("c", "a.ts"),
      base: mkFragment("b", "b.ts"),
      thresholds,
    });
    expect(hint.likelyRefactoring).toBe("extract-function");
  });

  it("no rule matches → manual-review", () => {
    const hint = deriveHint({
      score: mkScore(0.2, {
        tokenOverlap: 0.2,
        statementKindSimilarity: 0.2,
        callOverlap: 0.2,
        sizeCompatibility: 0.2,
      }),
      evidence: evidenceWithCalls,
      changed: mkFragment("c", "a.ts"),
      base: mkFragment("b", "b.ts"),
      thresholds,
    });
    expect(hint.likelyRefactoring).toBe("manual-review");
  });
});

describe("deriveHint — riskFlags", () => {
  it("includes size-mismatch when size ratio < 1/3", () => {
    const hint = deriveHint({
      score: mkScore(0.5),
      evidence: evidenceWithCalls,
      // 2 lines vs 20 lines → ratio 0.1
      changed: mkFragment("c", "a.ts", 2),
      base: mkFragment("b", "b.ts", 20),
      thresholds,
    });
    expect(hint.riskFlags).toContain("size-mismatch");
  });

  it("does not include size-mismatch when ratio >= 1/3", () => {
    const hint = deriveHint({
      score: mkScore(0.5),
      evidence: evidenceWithCalls,
      // 10 lines vs 20 lines → ratio 0.5
      changed: mkFragment("c", "a.ts", 10),
      base: mkFragment("b", "b.ts", 20),
      thresholds,
    });
    expect(hint.riskFlags).not.toContain("size-mismatch");
  });

  it("includes low-semantic-evidence when calls and properties are both empty", () => {
    const hint = deriveHint({
      score: mkScore(0.5),
      evidence: emptyEvidence,
      changed: mkFragment("c", "a.ts"),
      base: mkFragment("b", "b.ts"),
      thresholds,
    });
    expect(hint.riskFlags).toContain("low-semantic-evidence");
  });

  it("does not include low-semantic-evidence when at least one call is shared", () => {
    const hint = deriveHint({
      score: mkScore(0.5),
      evidence: evidenceWithCalls,
      changed: mkFragment("c", "a.ts"),
      base: mkFragment("b", "b.ts"),
      thresholds,
    });
    expect(hint.riskFlags).not.toContain("low-semantic-evidence");
  });

  it("includes threshold-based when combined<0.3 but an individual axis passes", () => {
    const hint = deriveHint({
      score: mkScore(0.25, {
        tokenOverlap: 0.5, // > token threshold 0.35
        statementKindSimilarity: 0,
        callOverlap: 0,
      }),
      evidence: evidenceWithCalls,
      changed: mkFragment("c", "a.ts"),
      base: mkFragment("b", "b.ts"),
      thresholds,
    });
    expect(hint.riskFlags).toContain("threshold-based");
  });

  it("excludes threshold-based when combined>=0.3", () => {
    const hint = deriveHint({
      score: mkScore(0.35, {
        tokenOverlap: 0.5,
      }),
      evidence: evidenceWithCalls,
      changed: mkFragment("c", "a.ts"),
      base: mkFragment("b", "b.ts"),
      thresholds,
    });
    expect(hint.riskFlags).not.toContain("threshold-based");
  });

  it("includes same-file when changed and base share filePath", () => {
    const hint = deriveHint({
      score: mkScore(0.5),
      evidence: evidenceWithCalls,
      changed: mkFragment("c", "same.ts"),
      base: mkFragment("b", "same.ts"),
      thresholds,
    });
    expect(hint.riskFlags).toContain("same-file");
  });

  it("includes thin-wrapper-side when only the changed side is a thin wrapper", () => {
    const hint = deriveHint({
      score: mkScore(0.5),
      evidence: evidenceWithCalls,
      changed: mkFragment("c", "a.ts"),
      base: mkFragment("b", "b.ts"),
      thresholds,
      changedIsThinWrapper: true,
      baseIsThinWrapper: false,
    });
    expect(hint.riskFlags).toContain("thin-wrapper-side");
  });

  it("includes thin-wrapper-side when only the base side is a thin wrapper", () => {
    const hint = deriveHint({
      score: mkScore(0.5),
      evidence: evidenceWithCalls,
      changed: mkFragment("c", "a.ts"),
      base: mkFragment("b", "b.ts"),
      thresholds,
      changedIsThinWrapper: false,
      baseIsThinWrapper: true,
    });
    expect(hint.riskFlags).toContain("thin-wrapper-side");
  });

  it("does not include thin-wrapper-side when neither side is a thin wrapper", () => {
    const hint = deriveHint({
      score: mkScore(0.5),
      evidence: evidenceWithCalls,
      changed: mkFragment("c", "a.ts"),
      base: mkFragment("b", "b.ts"),
      thresholds,
    });
    expect(hint.riskFlags).not.toContain("thin-wrapper-side");
  });

  it("does not include thin-wrapper-side when both sides are thin wrappers (dropped upstream, but the hint must not push it either)", () => {
    const hint = deriveHint({
      score: mkScore(0.5),
      evidence: evidenceWithCalls,
      changed: mkFragment("c", "a.ts"),
      base: mkFragment("b", "b.ts"),
      thresholds,
      changedIsThinWrapper: true,
      baseIsThinWrapper: true,
    });
    expect(hint.riskFlags).not.toContain("thin-wrapper-side");
  });

  it("sorts riskFlags lexicographically", () => {
    // Trigger every flag at once: same-file, low-semantic-evidence,
    // size-mismatch, threshold-based, thin-wrapper-side.
    const hint = deriveHint({
      score: mkScore(0.25, {
        tokenOverlap: 0.5,
      }),
      evidence: emptyEvidence,
      changed: mkFragment("c", "same.ts", 2),
      base: mkFragment("b", "same.ts", 20),
      thresholds,
      changedIsThinWrapper: true,
      baseIsThinWrapper: false,
    });
    const sorted = [...hint.riskFlags].sort();
    expect(hint.riskFlags).toEqual(sorted);
    expect(hint.riskFlags).toEqual([
      "low-semantic-evidence",
      "same-file",
      "size-mismatch",
      "thin-wrapper-side",
      "threshold-based",
    ]);
  });
});
