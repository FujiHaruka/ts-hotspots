import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { listRepoSources, NotAGitRepositoryError } from "./listRepoSources.ts";

function git(cwd: string, args: readonly string[]): void {
  const res = spawnSync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@example.com",
    },
    encoding: "utf8",
  });
  if (res.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${res.stderr || res.stdout}`,
    );
  }
}

function touch(root: string, relPath: string, body: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

describe("listRepoSources", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ts-hotspots-list-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("returns tracked .ts/.tsx/.mts/.cts files relative to rootDir, sorted", async () => {
    touch(tmp, "src/a.ts", "export const a = 1;\n");
    touch(tmp, "src/b.tsx", "export const b = <div />;\n");
    touch(tmp, "src/c.mts", "export const c = 3;\n");
    touch(tmp, "src/d.cts", "export const d = 4;\n");
    touch(tmp, "src/e.js", "export const e = 5;\n");
    touch(tmp, "README.md", "# x\n");
    git(tmp, ["init", "--initial-branch=main"]);
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "c1"]);

    const sources = await listRepoSources(tmp);
    expect(sources.map((s) => s.relative)).toEqual([
      "src/a.ts",
      "src/b.tsx",
      "src/c.mts",
      "src/d.cts",
    ]);
    expect(sources[0]?.absolute.endsWith("/src/a.ts")).toBe(true);
  });

  test("skips untracked files (git ls-files default)", async () => {
    touch(tmp, "src/tracked.ts", "export const a = 1;\n");
    git(tmp, ["init", "--initial-branch=main"]);
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "c1"]);
    touch(tmp, "src/untracked.ts", "export const b = 2;\n");

    const sources = await listRepoSources(tmp);
    expect(sources.map((s) => s.relative)).toEqual(["src/tracked.ts"]);
  });

  test("filters by exclude globs", async () => {
    touch(tmp, "src/keep.ts", "export const a = 1;\n");
    touch(tmp, "src/drop.test.ts", "export const b = 2;\n");
    git(tmp, ["init", "--initial-branch=main"]);
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "c1"]);

    const sources = await listRepoSources(tmp, {
      exclude: ["**/*.test.ts"],
    });
    expect(sources.map((s) => s.relative)).toEqual(["src/keep.ts"]);
  });

  test("throws NotAGitRepositoryError outside a working tree", async () => {
    touch(tmp, "src/a.ts", "export const a = 1;\n");
    await expect(listRepoSources(tmp)).rejects.toBeInstanceOf(
      NotAGitRepositoryError,
    );
  });
});
