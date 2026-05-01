import { describe, expect, it } from "vitest";
import { churnAmplifier } from "./churnAmplifier.ts";

describe("churnAmplifier", () => {
  it("returns 1.0 for churnMax = 0 (current behaviour preserved)", () => {
    expect(churnAmplifier(0, 0.5, 20)).toBe(1);
  });

  it("returns 1.0 for negative churn (defensive)", () => {
    expect(churnAmplifier(-3, 0.5, 20)).toBe(1);
  });

  it("returns 1 + alpha at exactly the cap", () => {
    expect(churnAmplifier(20, 0.5, 20)).toBeCloseTo(1.5, 10);
  });

  it("clamps to 1 + alpha for churn beyond the cap", () => {
    expect(churnAmplifier(200, 0.5, 20)).toBeCloseTo(1.5, 10);
  });

  it("scales linearly between 0 and the cap", () => {
    expect(churnAmplifier(5, 0.5, 20)).toBeCloseTo(1.125, 10);
    expect(churnAmplifier(10, 0.5, 20)).toBeCloseTo(1.25, 10);
    expect(churnAmplifier(15, 0.5, 20)).toBeCloseTo(1.375, 10);
  });

  it("returns 1.0 when alpha is 0 (disabled)", () => {
    expect(churnAmplifier(20, 0, 20)).toBe(1);
  });

  it("returns 1.0 when cap is 0 or negative (disabled)", () => {
    expect(churnAmplifier(20, 0.5, 0)).toBe(1);
    expect(churnAmplifier(20, 0.5, -1)).toBe(1);
  });

  it("respects custom alpha", () => {
    expect(churnAmplifier(10, 1, 20)).toBeCloseTo(1.5, 10);
    expect(churnAmplifier(10, 0.25, 20)).toBeCloseTo(1.125, 10);
  });
});
