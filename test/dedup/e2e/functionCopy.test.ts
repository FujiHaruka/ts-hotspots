import { afterEach, describe, expect, it } from "vitest";
import { runDetector } from "../../../src/duplication/cli/runDetector.ts";
import { defaultConfig } from "../../../src/duplication/config/index.ts";
import { nonNull } from "../../../src/duplication/util/nonNull.ts";
import { createTempRepo, type TempRepo } from "./helpers/tempRepo.ts";

describe("e2e: whole-function copy", () => {
  const repos: TempRepo[] = [];
  afterEach(() => {
    while (repos.length > 0) {
      const r = repos.pop();
      r?.cleanup();
    }
  });

  it("surfaces a copy-pasted function as a reported candidate", async () => {
    const r = createTempRepo("ts-dedup-e2e-fn-");
    repos.push(r);

    r.write(
      "src/math.ts",
      `export function computeDiscount(price: number, ratio: number): number {
  if (price <= 0) {
    throw new Error("invalid price");
  }
  if (ratio < 0 || ratio > 1) {
    throw new Error("invalid ratio");
  }
  const discounted = price * (1 - ratio);
  return Math.round(discounted);
}
`,
    );
    const base = r.commit("base");

    r.write(
      "src/util.ts",
      `export function applyPromo(price: number, ratio: number): number {
  if (price <= 0) {
    throw new Error("invalid price");
  }
  if (ratio < 0 || ratio > 1) {
    throw new Error("invalid ratio");
  }
  const discounted = price * (1 - ratio);
  return Math.round(discounted);
}
`,
    );
    const head = r.commit("head");

    const report = await runDetector({
      repoPath: r.path,
      baseRef: base,
      headRef: head,
      threeDot: false,
      config: defaultConfig,
    });

    const matches = report.groups.flatMap((g) =>
      g.anchor?.location.startsWith("src/util.ts:")
        ? g.members
            .filter((m) => m.fragment.location.startsWith("src/math.ts:"))
            .map((m) => ({
              left: nonNull(g.anchor),
              right: m.fragment,
              scores: m.scores,
            }))
        : [],
    );
    // Cross-granularity echoes (function / block / window for the same
    // clone) must be collapsed down to a single function-level pair.
    expect(matches).toHaveLength(1);
    const match = matches[0];
    expect(match?.left.kind).toBe("function");
    expect(match?.right.kind).toBe("function");
    // Whole-function clone: token overlap should be high and statement
    // structure should match strongly.
    expect(match?.scores.tokenOverlap).toBeGreaterThan(0.5);
    expect(match?.scores.statementKindSimilarity).toBeGreaterThan(0.5);
  });
});
