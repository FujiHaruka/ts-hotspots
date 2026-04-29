import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runDetector } from "../src/cli/runDetector.ts";
import { runWholeRepoDetector } from "../src/cli/runWholeRepoDetector.ts";
import { defaultConfig } from "../src/config/index.ts";
import { loadFixtures } from "../tools/bench/loadFixtures.ts";
import { setupRepo, type SetupRepoResult } from "../tools/bench/setupRepo.ts";

/**
 * End-to-end determinism tripwire. Runs `runDetector` twice against the same
 * repo for a representative subset and asserts byte-identical JSON reports.
 * The pipeline is pure data transformation and per-module determinism tests
 * already guard each stage, so this suite is intentionally small — its job is
 * to catch accidental parallelism or missing tie-breaks introduced during
 * future refactors, not to re-verify what unit tests already cover.
 */
const SUBSET_IDS = [
  "001-exact-fn-copy",
  "004-renamed-locals",
  "008-extra-log-stmt",
  "017-tsx-component-copy",
  "021-neg-shared-domain",
];

const suiteRoot = resolve(__dirname, "fixtures/suite");
const fixtures = loadFixtures(suiteRoot).filter((f) =>
  SUBSET_IDS.includes(f.id),
);

describe("fixture suite determinism", () => {
  const repos: SetupRepoResult[] = [];
  afterEach(() => {
    while (repos.length > 0) {
      const r = repos.pop();
      r?.cleanup();
    }
  });

  for (const fixture of fixtures) {
    it(`${fixture.id}: two runs produce identical JSON`, async () => {
      const repo = setupRepo(
        fixture.baseFiles,
        fixture.headFiles,
        "ts-dedup-det-",
      );
      repos.push(repo);

      const first = await runDetector({
        repoPath: repo.path,
        baseRef: repo.baseSha,
        headRef: repo.headSha,
        threeDot: false,
        config: defaultConfig,
      });
      const second = await runDetector({
        repoPath: repo.path,
        baseRef: repo.baseSha,
        headRef: repo.headSha,
        threeDot: false,
        config: defaultConfig,
      });

      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });
  }

  for (const fixture of fixtures) {
    it(`${fixture.id}: whole-repo two runs produce identical JSON`, async () => {
      const repo = setupRepo(
        fixture.baseFiles,
        fixture.headFiles,
        "ts-dedup-det-whole-",
      );
      repos.push(repo);

      const first = await runWholeRepoDetector({
        repoPath: repo.path,
        ref: repo.headSha,
        config: defaultConfig,
      });
      const second = await runWholeRepoDetector({
        repoPath: repo.path,
        ref: repo.headSha,
        config: defaultConfig,
      });

      expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });
  }
});
