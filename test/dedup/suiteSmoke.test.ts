import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDetector } from "../src/cli/runDetector.ts";
import { defaultConfig } from "../src/config/index.ts";
import { groupsToPairs } from "../tools/bench/groupsToPairs.ts";
import { loadFixtures } from "../tools/bench/loadFixtures.ts";
import { matchReport } from "../tools/bench/matchReport.ts";
import { type SetupRepoResult, setupRepo } from "../tools/bench/setupRepo.ts";

/**
 * Smoke subset of the ts-dedup fixture suite. Picks one representative scenario
 * from each major bucket (type-1 copy, type-2 rename, type-3 small change, tsx,
 * negative precision). The full suite runs via `pnpm bench` on demand.
 */
const SMOKE_IDS = [
  "001-exact-fn-copy",
  "004-renamed-locals",
  "008-extra-log-stmt",
  "017-tsx-component-copy",
  "021-neg-shared-domain",
];

describe("fixture suite smoke", () => {
  const suiteRoot = resolve(__dirname, "fixtures/suite");
  const repos: SetupRepoResult[] = [];
  afterEach(() => {
    while (repos.length > 0) {
      const r = repos.pop();
      r?.cleanup();
    }
  });

  for (const id of SMOKE_IDS) {
    it(`${id}: positives matched, negatives respected`, async () => {
      const fixtures = loadFixtures(suiteRoot, id);
      expect(fixtures).toHaveLength(1);
      const fixture = fixtures[0];
      if (fixture === undefined) throw new Error("unreachable");

      const repo = setupRepo(
        fixture.baseFiles,
        fixture.headFiles,
        "ts-dedup-smoke-",
      );
      repos.push(repo);

      const report = await runDetector({
        repoPath: repo.path,
        baseRef: repo.baseSha,
        headRef: repo.headSha,
        threeDot: false,
        config: defaultConfig,
      });

      const match = matchReport(
        groupsToPairs(report.groups),
        fixture.expected.expectedPositive,
        fixture.expected.expectedNegative,
      );

      for (const p of match.positives) {
        expect(
          p.rank,
          `positive missed: ${p.expected.changed.filePath} ↔ ${p.expected.existing.filePath}`,
        ).not.toBeNull();
      }
      for (const n of match.negatives) {
        expect(
          n.violations,
          `negative violated: ${n.expected.changed.filePath} ↔ ${n.expected.existing.filePath}`,
        ).toBe(0);
      }
    });
  }
});
