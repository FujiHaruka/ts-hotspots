import { afterEach, describe, expect, it } from "vitest";
import { runDetector } from "../../../src/duplication/cli/runDetector.ts";
import { defaultConfig } from "../../../src/duplication/config/defaults.ts";
import { createTempRepo, type TempRepo } from "./helpers/tempRepo.ts";

describe("e2e: identifier-renamed copy (Type-2 / Type-3)", () => {
  const repos: TempRepo[] = [];
  afterEach(() => {
    while (repos.length > 0) {
      const r = repos.pop();
      r?.cleanup();
    }
  });

  it("reports a candidate when identifiers differ but the structure matches", async () => {
    const r = createTempRepo("ts-dedup-e2e-rename-");
    repos.push(r);

    r.write(
      "src/validate.ts",
      `export function validateUser(user: { id: string; name: string }): boolean {
  if (user.id.length === 0) {
    return false;
  }
  if (user.name.length === 0) {
    return false;
  }
  return true;
}
`,
    );
    const base = r.commit("base");

    r.write(
      "src/check.ts",
      `export function checkAccount(acc: { key: string; label: string }): boolean {
  if (acc.key.length === 0) {
    return false;
  }
  if (acc.label.length === 0) {
    return false;
  }
  return true;
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
      .filter((g) => g.anchor?.location.startsWith("src/check.ts:"))
      .flatMap((g) =>
        g.members
          .filter((m) => m.fragment.location.startsWith("src/validate.ts:"))
          .map((m) => ({ scores: m.scores })),
      )[0];
    expect(match).toBeDefined();
    // After identifier normalisation the token stream and statement
    // structure should overlap heavily.
    expect(match?.scores.statementKindSimilarity).toBeGreaterThanOrEqual(0.5);
  });
});
