import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createTempRepo, type TempRepo } from "../../../test/dedup/e2e/helpers/tempRepo.ts";
import { defaultConfig } from "../config/index.ts";
import { listBaseSources } from "./listBaseSources.ts";

describe("listBaseSources", () => {
  const repos: TempRepo[] = [];

  afterEach(() => {
    while (repos.length > 0) {
      const r = repos.pop();
      r?.cleanup();
    }
  });

  function newRepo(): TempRepo {
    const r = createTempRepo("ts-dedup-m7-baselist-");
    repos.push(r);
    return r;
  }

  it("returns only .ts / .tsx sources from the base tree", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const a = 1;\n");
    r.write("src/b.tsx", "export const b = <div/>;\n");
    r.write("src/c.js", "module.exports = 1;\n");
    r.write("README.md", "# hi\n");
    const sha = r.commit("base");

    const { sources } = await listBaseSources(r.path, sha, defaultConfig);
    expect(sources.map((s) => s.path)).toEqual(["src/a.ts", "src/b.tsx"]);
    expect(sources[0]?.text).toBe("export const a = 1;\n");
    expect(sources[1]?.text).toBe("export const b = <div/>;\n");
  });

  it("applies default exclude globs (node_modules, dist)", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const a = 1;\n");
    r.write("node_modules/foo/index.ts", "export const n = 1;\n");
    r.write("dist/a.ts", "export const d = 1;\n");
    const sha = r.commit("base");

    const { sources } = await listBaseSources(r.path, sha, defaultConfig);
    expect(sources.map((s) => s.path)).toEqual(["src/a.ts"]);
  });

  it("is deterministic: paths are ascending-sorted", async () => {
    const r = newRepo();
    r.write("src/z.ts", "export const z = 1;\n");
    r.write("src/a.ts", "export const a = 1;\n");
    r.write("src/m.ts", "export const m = 1;\n");
    const sha = r.commit("base");

    const { sources } = await listBaseSources(r.path, sha, defaultConfig);
    expect(sources.map((s) => s.path)).toEqual([
      "src/a.ts",
      "src/m.ts",
      "src/z.ts",
    ]);
  });

  it("excludes test files (*.test.ts, *.spec.tsx, __tests__/) by default", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const a = 1;\n");
    r.write("src/a.test.ts", "test('a', () => {});\n");
    r.write("src/comp.spec.tsx", "test('c', () => {});\n");
    r.write("src/__tests__/extra.ts", "export const t = 1;\n");
    const sha = r.commit("base");

    const { sources } = await listBaseSources(r.path, sha, defaultConfig);
    expect(sources.map((s) => s.path)).toEqual(["src/a.ts"]);
  });

  it("scopes the scan to repoPath when it points at a subdirectory, with repo-root-relative paths", async () => {
    // Regression: previously `git ls-tree` was invoked without `--full-tree`,
    // so when repoPath was a subdir the output was cwd-relative. `git show
    // <sha>:<path>` then interpreted those paths against the repo root and
    // failed for every file, silently producing an empty source list.
    //
    // Now we resolve the cwd prefix via `git rev-parse --show-prefix` and
    // pass it as a pathspec, so `--repo <subdir>` faithfully scopes the
    // scan to that subdirectory while still reporting paths from the repo
    // root (which is what `git show <sha>:<path>` expects).
    const r = newRepo();
    r.write("packages/workflow/src/a.ts", "export const a = 1;\n");
    r.write("packages/workflow/src/b.ts", "export const b = 2;\n");
    r.write("packages/other/src/c.ts", "export const c = 3;\n");
    const sha = r.commit("base");

    const subdir = join(r.path, "packages/workflow/src");
    const { sources } = await listBaseSources(subdir, sha, defaultConfig);
    expect(sources.map((s) => s.path)).toEqual([
      "packages/workflow/src/a.ts",
      "packages/workflow/src/b.ts",
    ]);
    expect(sources[0]?.text).toBe("export const a = 1;\n");
  });

  it("honours user-supplied exclude globs", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const a = 1;\n");
    r.write("src/generated/api.ts", "export const g = 1;\n");
    const sha = r.commit("base");

    const config = {
      ...defaultConfig,
      exclude: { globs: [...defaultConfig.exclude.globs, "src/generated/**"] },
    };
    const { sources } = await listBaseSources(r.path, sha, config);
    expect(sources.map((s) => s.path)).toEqual(["src/a.ts"]);
  });
});
