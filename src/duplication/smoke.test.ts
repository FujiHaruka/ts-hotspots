import { describe, expect, it } from "vitest";
import { defaultConfig } from "./config/defaults.ts";

describe("smoke", () => {
  it("defaultConfig has expected weights summing to 1", () => {
    const { token, statement, call, size, length } =
      defaultConfig.scoring.weights;
    expect(token + statement + call + size + length).toBeCloseTo(1.0, 6);
  });

  it("defaultConfig has exclude globs populated", () => {
    expect(defaultConfig.exclude.globs.length).toBeGreaterThan(0);
  });
});
