import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { SourceFileInfo } from "../../loader/types.ts";
import { collectChurn } from "./commit-count.ts";

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
  const dir = full.slice(0, full.lastIndexOf("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(full, body);
}

function fakeFiles(paths: readonly string[]): SourceFileInfo[] {
  return paths.map((p) => ({
    path: p,
    sourceFile: undefined as unknown as SourceFileInfo["sourceFile"],
  }));
}

describe("collectChurn (integration)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ts-hotspots-churn-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("counts first-parent commits per tracked file", () => {
    git(tmp, ["init", "--initial-branch=main"]);
    touch(tmp, "src/foo.ts", "export const a = 1;\n");
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "c1"]);

    touch(tmp, "src/foo.ts", "export const a = 2;\n");
    touch(tmp, "src/bar.ts", "export const b = 1;\n");
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "c2"]);

    touch(tmp, "src/foo.ts", "export const a = 3;\n");
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "c3"]);

    const counts = collectChurn({
      rootDir: tmp,
      files: fakeFiles(["src/foo.ts", "src/bar.ts"]),
      window: 200,
      ref: "HEAD",
    });
    expect(counts.get("src/foo.ts")).toBe(3);
    expect(counts.get("src/bar.ts")).toBe(1);
  });

  test("--first-parent folds merge-based PRs into a single commit", () => {
    git(tmp, ["init", "--initial-branch=main"]);
    touch(tmp, "src/foo.ts", "v0\n");
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "init"]);

    git(tmp, ["checkout", "-b", "feat"]);
    touch(tmp, "src/foo.ts", "v1\n");
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "feat-1"]);
    touch(tmp, "src/foo.ts", "v2\n");
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "feat-2"]);

    git(tmp, ["checkout", "main"]);
    git(tmp, ["merge", "--no-ff", "feat", "-m", "merge feat"]);

    const counts = collectChurn({
      rootDir: tmp,
      files: fakeFiles(["src/foo.ts"]),
      window: 200,
      ref: "HEAD",
    });
    // initial commit (1) + merge commit (1) — feat-1 / feat-2 are folded away.
    expect(counts.get("src/foo.ts")).toBe(2);
  });

  test("--churn-window caps the number of scanned commits", () => {
    git(tmp, ["init", "--initial-branch=main"]);
    for (let i = 0; i < 5; i += 1) {
      touch(tmp, "src/foo.ts", `v${String(i)}\n`);
      git(tmp, ["add", "."]);
      git(tmp, ["commit", "-m", `c${String(i)}`]);
    }

    const counts = collectChurn({
      rootDir: tmp,
      files: fakeFiles(["src/foo.ts"]),
      window: 2,
      ref: "HEAD",
    });
    expect(counts.get("src/foo.ts")).toBe(2);
  });

  test("non-git directory is skipped gracefully (returns an empty map)", () => {
    const counts = collectChurn({
      rootDir: tmp,
      files: fakeFiles(["src/foo.ts"]),
      window: 200,
      ref: "HEAD",
    });
    expect(counts.size).toBe(0);
  });

  test("empty repo (no HEAD yet) is skipped gracefully (returns an empty map)", () => {
    git(tmp, ["init", "--initial-branch=main"]);

    const counts = collectChurn({
      rootDir: tmp,
      files: fakeFiles(["src/foo.ts"]),
      window: 200,
      ref: "HEAD",
    });
    expect(counts.size).toBe(0);
  });

  test("rename history is followed back to the pre-rename path", () => {
    git(tmp, ["init", "--initial-branch=main"]);
    touch(tmp, "src/old.ts", "v1\n");
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "c1"]);

    touch(tmp, "src/old.ts", "v2\n");
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "c2"]);

    git(tmp, ["mv", "src/old.ts", "src/new.ts"]);
    git(tmp, ["commit", "-m", "rename"]);

    touch(tmp, "src/new.ts", "v3\n");
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "c3"]);

    const counts = collectChurn({
      rootDir: tmp,
      files: fakeFiles(["src/new.ts"]),
      window: 200,
      ref: "HEAD",
    });
    // c1 + c2 (as src/old.ts) + rename + c3 = 4
    expect(counts.get("src/new.ts")).toBe(4);
  });

  test("non-ASCII filename is counted (core.quotepath override)", () => {
    git(tmp, ["init", "--initial-branch=main"]);
    const relPath = "src/日本語.ts";
    touch(tmp, relPath, "export const a = 1;\n");
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "c1"]);

    touch(tmp, relPath, "export const a = 2;\n");
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "c2"]);

    const counts = collectChurn({
      rootDir: tmp,
      files: fakeFiles([relPath]),
      window: 200,
      ref: "HEAD",
    });
    expect(counts.get(relPath)).toBe(2);
  });
});
