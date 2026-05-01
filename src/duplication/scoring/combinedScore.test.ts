import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import type { ScoreBreakdown } from "../domain/candidate.ts";
import { combinedScore } from "./combinedScore.ts";

describe("combinedScore", () => {
  it("returns 1.0 when all per-axis scores are 1 under default weights", () => {
    const breakdown: ScoreBreakdown = {
      tokenOverlap: 1,
      statementKindSimilarity: 1,
      callOverlap: 1,
      sizeCompatibility: 1,
      lengthScore: 1,
    };
    expect(combinedScore(breakdown, defaultConfig.scoring.weights)).toBeCloseTo(
      1,
      10,
    );
  });

  it("normalizes weights so unscaled weights still yield [0, 1]", () => {
    const breakdown: ScoreBreakdown = {
      tokenOverlap: 1,
      statementKindSimilarity: 1,
      callOverlap: 1,
      sizeCompatibility: 1,
      lengthScore: 1,
    };
    // All weights doubled — sum becomes 2 instead of 1.
    const doubled = {
      token: 0.7,
      statement: 0.3,
      call: 0.5,
      size: 0.1,
      length: 0.4,
    };
    expect(combinedScore(breakdown, doubled)).toBeCloseTo(1, 10);
  });

  it("linearly combines mixed breakdowns under default weights", () => {
    const breakdown: ScoreBreakdown = {
      tokenOverlap: 0.5,
      statementKindSimilarity: 0,
      callOverlap: 1,
      sizeCompatibility: 0,
      lengthScore: 0,
    };
    // 0.35*0.5 + 0.15*0 + 0.25*1 + 0.05*0 + 0.20*0 = 0.425
    expect(combinedScore(breakdown, defaultConfig.scoring.weights)).toBeCloseTo(
      0.425,
      10,
    );
  });

  it("returns 0 when all weights are 0", () => {
    const breakdown: ScoreBreakdown = {
      tokenOverlap: 1,
      statementKindSimilarity: 1,
      callOverlap: 1,
      sizeCompatibility: 1,
      lengthScore: 1,
    };
    expect(
      combinedScore(breakdown, {
        token: 0,
        statement: 0,
        call: 0,
        size: 0,
        length: 0,
      }),
    ).toBe(0);
  });

  it("respects non-default weight shapes", () => {
    const breakdown: ScoreBreakdown = {
      tokenOverlap: 1,
      statementKindSimilarity: 0,
      callOverlap: 0,
      sizeCompatibility: 0,
      lengthScore: 0,
    };
    // Only token weight is non-zero → combined = tokenOverlap.
    const weights = {
      token: 1,
      statement: 0,
      call: 0,
      size: 0,
      length: 0,
    };
    expect(combinedScore(breakdown, weights)).toBe(1);
  });

  it("includes lengthScore axis under default weights", () => {
    const breakdown: ScoreBreakdown = {
      tokenOverlap: 0,
      statementKindSimilarity: 0,
      callOverlap: 0,
      sizeCompatibility: 0,
      lengthScore: 1,
    };
    // Only length axis active: 0.20 / 1.0 = 0.20.
    expect(combinedScore(breakdown, defaultConfig.scoring.weights)).toBeCloseTo(
      0.2,
      10,
    );
  });

  describe("enabled flags", () => {
    it("drops a disabled axis from numerator and denominator", () => {
      const breakdown: ScoreBreakdown = {
        tokenOverlap: 1,
        statementKindSimilarity: 0,
        callOverlap: 0,
        sizeCompatibility: 0,
        lengthScore: 0,
      };
      // token off — token weight (0.35) drops out of both num and denom.
      // All remaining axes are 0, so combined is 0.
      const combined = combinedScore(breakdown, defaultConfig.scoring.weights, {
        token: false,
        statement: true,
        call: true,
      });
      expect(combined).toBe(0);
    });

    it("renormalizes over enabled axes so remaining weights keep proportions", () => {
      const breakdown: ScoreBreakdown = {
        tokenOverlap: 0,
        statementKindSimilarity: 1,
        callOverlap: 1,
        sizeCompatibility: 1,
        lengthScore: 1,
      };
      // token off → denominator = 0.15 + 0.25 + 0.05 + 0.20 = 0.65.
      // numerator = 0.15*1 + 0.25*1 + 0.05*1 + 0.20*1 = 0.65.
      // combined = 1.0 (all remaining axes at max).
      const combined = combinedScore(breakdown, defaultConfig.scoring.weights, {
        token: false,
        statement: true,
        call: true,
      });
      expect(combined).toBeCloseTo(1, 10);
    });

    it("statement disabled gives correct weighted average", () => {
      const breakdown: ScoreBreakdown = {
        tokenOverlap: 0.5,
        statementKindSimilarity: 1, // disabled — must not influence result
        callOverlap: 0,
        sizeCompatibility: 0,
        lengthScore: 0,
      };
      // denominator = 0.35 + 0.25 + 0.05 + 0.20 = 0.85.
      // numerator = 0.35*0.5 = 0.175.
      // combined = 0.175 / 0.85.
      const combined = combinedScore(breakdown, defaultConfig.scoring.weights, {
        token: true,
        statement: false,
        call: true,
      });
      expect(combined).toBeCloseTo(0.175 / 0.85, 10);
    });

    it("all 3 feature streams disabled leaves size + length as sole contributors", () => {
      const breakdown: ScoreBreakdown = {
        tokenOverlap: 1,
        statementKindSimilarity: 1,
        callOverlap: 1,
        sizeCompatibility: 0.5,
        lengthScore: 0.5,
      };
      // denominator = size + length = 0.05 + 0.20 = 0.25.
      // numerator = 0.05*0.5 + 0.20*0.5 = 0.125.
      // combined = 0.5.
      const combined = combinedScore(breakdown, defaultConfig.scoring.weights, {
        token: false,
        statement: false,
        call: false,
      });
      expect(combined).toBeCloseTo(0.5, 10);
    });

    it("defaults to all-enabled when enabled arg is omitted", () => {
      const breakdown: ScoreBreakdown = {
        tokenOverlap: 1,
        statementKindSimilarity: 1,
        callOverlap: 1,
        sizeCompatibility: 1,
        lengthScore: 1,
      };
      expect(
        combinedScore(breakdown, defaultConfig.scoring.weights),
      ).toBeCloseTo(1, 10);
    });
  });
});
