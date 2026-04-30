import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import type { CandidateScore } from "../domain/candidate.ts";
import { shouldReport } from "./decide.ts";

const thresholds = defaultConfig.scoring.thresholds;

function score(partial: {
  combined?: number;
  tokenOverlap?: number;
  statementKindSimilarity?: number;
  callOverlap?: number;
  sizeCompatibility?: number;
  lengthScore?: number;
}): CandidateScore {
  return {
    changedFragmentId: "c",
    baseFragmentId: "b",
    combined: partial.combined ?? 0,
    breakdown: {
      tokenOverlap: partial.tokenOverlap ?? 0,
      statementKindSimilarity: partial.statementKindSimilarity ?? 0,
      callOverlap: partial.callOverlap ?? 0,
      sizeCompatibility: partial.sizeCompatibility ?? 0,
      lengthScore: partial.lengthScore ?? 0,
    },
  };
}

describe("shouldReport", () => {
  it("reports when combined is below but tokenOverlap >= threshold", () => {
    // combined 0.1 < 0.3 but tokenOverlap 0.5 > 0.35
    expect(
      shouldReport(score({ combined: 0.1, tokenOverlap: 0.5 }), thresholds),
    ).toBe(true);
  });

  it("does not report when every axis is below its threshold", () => {
    expect(
      shouldReport(
        score({
          combined: 0.29,
          tokenOverlap: 0.34,
          statementKindSimilarity: 0.44,
          callOverlap: 0.39,
        }),
        thresholds,
      ),
    ).toBe(false);
  });

  it("reports when multiple axes clear thresholds", () => {
    expect(
      shouldReport(
        score({
          combined: 0.9,
          tokenOverlap: 0.9,
          statementKindSimilarity: 0.9,
          callOverlap: 0.9,
        }),
        thresholds,
      ),
    ).toBe(true);
  });

  it("reports when a score equals a threshold exactly (inclusive >=)", () => {
    expect(
      shouldReport(
        score({
          combined: 0,
          tokenOverlap: thresholds.token,
        }),
        thresholds,
      ),
    ).toBe(true);
  });

  it("does not report when a score is just below a threshold", () => {
    expect(
      shouldReport(
        score({
          combined: thresholds.combined - 1e-9,
          tokenOverlap: thresholds.token - 1e-9,
          statementKindSimilarity: thresholds.statement - 1e-9,
          callOverlap: thresholds.call - 1e-9,
        }),
        thresholds,
      ),
    ).toBe(false);
  });

  it("reports when combined alone clears its threshold", () => {
    expect(
      shouldReport(score({ combined: thresholds.combined }), thresholds),
    ).toBe(true);
  });

  it("reports when statementKindSimilarity alone clears its threshold", () => {
    expect(
      shouldReport(
        score({ statementKindSimilarity: thresholds.statement }),
        thresholds,
      ),
    ).toBe(true);
  });

  it("reports when callOverlap alone clears its threshold", () => {
    expect(
      shouldReport(score({ callOverlap: thresholds.call }), thresholds),
    ).toBe(true);
  });

  describe("enabled flags", () => {
    it("skips tokenOverlap OR when token is disabled", () => {
      // tokenOverlap clears its threshold, but token stream is off —
      // decision must not be driven by a disabled axis.
      expect(
        shouldReport(
          score({ combined: 0, tokenOverlap: thresholds.token }),
          thresholds,
          { token: false, statement: true, call: true },
        ),
      ).toBe(false);
    });

    it("skips statementKindSimilarity OR when statement is disabled", () => {
      expect(
        shouldReport(
          score({
            combined: 0,
            statementKindSimilarity: thresholds.statement,
          }),
          thresholds,
          { token: true, statement: false, call: true },
        ),
      ).toBe(false);
    });

    it("skips callOverlap OR when call is disabled", () => {
      expect(
        shouldReport(
          score({ combined: 0, callOverlap: thresholds.call }),
          thresholds,
          { token: true, statement: true, call: false },
        ),
      ).toBe(false);
    });

    it("still reports via combined even if all feature streams are disabled", () => {
      // `combined` is computed from what axes remain enabled (size-only
      // in this case), but shouldReport only cares about the numeric value.
      expect(
        shouldReport(
          score({ combined: thresholds.combined }),
          thresholds,
          { token: false, statement: false, call: false },
        ),
      ).toBe(true);
    });

    it("still reports via enabled axes when other axes are disabled", () => {
      expect(
        shouldReport(
          score({ combined: 0, callOverlap: thresholds.call }),
          thresholds,
          { token: false, statement: false, call: true },
        ),
      ).toBe(true);
    });
  });
});
