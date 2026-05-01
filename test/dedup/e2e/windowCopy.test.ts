import { afterEach, describe, expect, it } from "vitest";
import { runDetector } from "../../../src/duplication/cli/runDetector.ts";
import { defaultConfig } from "../../../src/duplication/config/index.ts";
import { createTempRepo, type TempRepo } from "./helpers/tempRepo.ts";

describe("e2e: partial statement-window copy", () => {
  const repos: TempRepo[] = [];
  afterEach(() => {
    while (repos.length > 0) {
      const r = repos.pop();
      r?.cleanup();
    }
  });

  it("reports a candidate when a window of statements is reused in a different function", async () => {
    const r = createTempRepo("ts-dedup-e2e-window-");
    repos.push(r);

    // Base: a function whose middle statements form the reusable block.
    r.write(
      "src/pipeline.ts",
      `export function runPipeline(input: string[]): string[] {
  const out: string[] = [];
  for (const item of input) {
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("#")) {
      continue;
    }
    out.push(lower);
  }
  out.sort();
  return out;
}
`,
    );
    const base = r.commit("base");

    // Head: a new function with a different shell but the same inner
    // filter/normalise window.
    r.write(
      "src/normalize.ts",
      `export function normalize(input: string[]): number {
  let count = 0;
  for (const item of input) {
    const trimmed = item.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const lower = trimmed.toLowerCase();
    if (lower.startsWith("#")) {
      continue;
    }
    count += 1;
  }
  return count;
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

    const match = report.groups
      .filter((g) => g.anchor?.location.startsWith("src/normalize.ts:"))
      .flatMap((g) =>
        g.members
          .filter((m) => m.fragment.location.startsWith("src/pipeline.ts:"))
          .map((m) => ({ scores: m.scores })),
      )[0];
    expect(match).toBeDefined();
    // The shared middle window should drive at least one strong signal —
    // either token overlap, statement-kind similarity, or call overlap.
    const scores = match?.scores;
    const strongest = Math.max(
      scores?.tokenOverlap ?? 0,
      scores?.statementKindSimilarity ?? 0,
      scores?.callOverlap ?? 0,
    );
    expect(strongest).toBeGreaterThanOrEqual(0.35);
  });
});
