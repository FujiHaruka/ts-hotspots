import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import { collectDiff } from "./collectDiff.ts";

interface Repo {
  path: string;
  git: (...args: string[]) => string;
  write: (relPath: string, content: string) => void;
  commit: (message: string) => string;
  rev: (ref: string) => string;
}

function makeRepo(): Repo {
  const path = mkdtempSync(join(tmpdir(), "ts-dedup-m5-"));
  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", path, ...args], {
      encoding: "utf-8",
    });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");

  const write = (relPath: string, content: string): void => {
    const full = join(path, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf-8");
  };
  const commit = (message: string): string => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD").trim();
  };
  const rev = (ref: string): string => git("rev-parse", ref).trim();

  return { path, git, write, commit, rev };
}

let repos: Repo[] = [];

beforeEach(() => {
  repos = [];
});

afterEach(() => {
  for (const r of repos) {
    rmSync(r.path, { recursive: true, force: true });
  }
});

function newRepo(): Repo {
  const r = makeRepo();
  repos.push(r);
  return r;
}

describe("collectDiff", () => {
  it("detects a TypeScript file change between two commits", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    const base = r.commit("base");
    r.write(
      "src/a.ts",
      "export const x = 1;\nexport const y = 2;\n",
    );
    const head = r.commit("head");

    const { files } = await collectDiff({
      repoPath: r.path,
      baseRef: base,
      headRef: head,
      threeDot: false,
      config: defaultConfig,
    });
    expect(files).toHaveLength(1);
    expect(files[0]?.filePath).toBe("src/a.ts");
    expect(files[0]?.baseSha).toBe(base);
    expect(files[0]?.headSha).toBe(head);
    expect(files[0]?.text).toContain("export const y = 2;");
    expect(files[0]?.hunks.length).toBeGreaterThanOrEqual(1);
  });

  it("does not include .js file changes", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    r.write("src/b.js", "module.exports = 1;\n");
    const base = r.commit("base");
    r.write("src/b.js", "module.exports = 2;\n");
    const head = r.commit("head");

    const { files } = await collectDiff({
      repoPath: r.path,
      baseRef: base,
      headRef: head,
      threeDot: false,
      config: defaultConfig,
    });
    expect(files).toEqual([]);
  });

  it("excludes node_modules/** by default", async () => {
    const r = newRepo();
    r.write("node_modules/foo/index.ts", "export const a = 1;\n");
    r.write("src/a.ts", "export const b = 1;\n");
    const base = r.commit("base");
    r.write("node_modules/foo/index.ts", "export const a = 2;\n");
    r.write("src/a.ts", "export const b = 2;\n");
    const head = r.commit("head");

    const { files } = await collectDiff({
      repoPath: r.path,
      baseRef: base,
      headRef: head,
      threeDot: false,
      config: defaultConfig,
    });
    const paths = files.map((f) => f.filePath).sort();
    expect(paths).toEqual(["src/a.ts"]);
  });

  it("excludes dist/** by default", async () => {
    const r = newRepo();
    r.write("dist/a.ts", "export const a = 1;\n");
    r.write("src/a.ts", "export const b = 1;\n");
    const base = r.commit("base");
    r.write("dist/a.ts", "export const a = 2;\n");
    r.write("src/a.ts", "export const b = 2;\n");
    const head = r.commit("head");

    const { files } = await collectDiff({
      repoPath: r.path,
      baseRef: base,
      headRef: head,
      threeDot: false,
      config: defaultConfig,
    });
    const paths = files.map((f) => f.filePath).sort();
    expect(paths).toEqual(["src/a.ts"]);
  });

  it("detects a brand-new file with hunks covering the head content", async () => {
    const r = newRepo();
    r.write("src/existing.ts", "export const x = 1;\n");
    const base = r.commit("base");
    const newContent = "export const y = 2;\nexport const z = 3;\n";
    r.write("src/new.ts", newContent);
    const head = r.commit("head");

    const { files } = await collectDiff({
      repoPath: r.path,
      baseRef: base,
      headRef: head,
      threeDot: false,
      config: defaultConfig,
    });
    expect(files).toHaveLength(1);
    const f = files[0];
    expect(f?.filePath).toBe("src/new.ts");
    // 2 lines in head, hunk should span 1..2.
    expect(f?.hunks).toEqual([{ startLine: 1, endLine: 2 }]);
    expect(f?.text).toBe(newContent);
  });

  it("does not include deleted files in the result", async () => {
    const r = newRepo();
    r.write("src/keep.ts", "export const x = 1;\n");
    r.write("src/gone.ts", "export const y = 2;\n");
    const base = r.commit("base");
    // Remove src/gone.ts via git rm.
    r.git("rm", "-q", "src/gone.ts");
    r.write("src/keep.ts", "export const x = 10;\n");
    const head = r.commit("head");

    const { files } = await collectDiff({
      repoPath: r.path,
      baseRef: base,
      headRef: head,
      threeDot: false,
      config: defaultConfig,
    });
    const paths = files.map((f) => f.filePath).sort();
    expect(paths).toEqual(["src/keep.ts"]);
  });

  it("is deterministic (same repo state → same output)", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    r.write("src/b.ts", "export const y = 1;\n");
    const base = r.commit("base");
    r.write("src/a.ts", "export const x = 10;\n");
    r.write("src/b.ts", "export const y = 20;\n");
    const head = r.commit("head");

    const runA = await collectDiff({
      repoPath: r.path,
      baseRef: base,
      headRef: head,
      threeDot: false,
      config: defaultConfig,
    });
    const runB = await collectDiff({
      repoPath: r.path,
      baseRef: base,
      headRef: head,
      threeDot: false,
      config: defaultConfig,
    });
    expect(runA).toEqual(runB);
  });

  it("three-dot mode excludes changes that only happened on the base branch", async () => {
    const r = newRepo();
    // shared ancestor
    r.write("src/shared.ts", "export const x = 1;\n");
    const ancestor = r.commit("ancestor");

    // feature branch: add src/feature.ts
    r.git("checkout", "-q", "-b", "feature");
    r.write("src/feature.ts", "export const f = 1;\n");
    r.commit("feature");

    // main diverges: edits src/shared.ts (not on feature branch)
    r.git("checkout", "-q", ancestor);
    r.git("checkout", "-q", "-B", "main");
    r.write("src/shared.ts", "export const x = 999;\n");
    r.commit("main-only");

    // Two-dot `main..feature` would surface src/shared.ts as a "deletion"
    // on feature. Three-dot must not — it diffs against merge-base.
    const { files: threeDotFiles } = await collectDiff({
      repoPath: r.path,
      baseRef: "main",
      headRef: "feature",
      threeDot: true,
      config: defaultConfig,
    });
    const threeDotPaths = threeDotFiles.map((f) => f.filePath).sort();
    expect(threeDotPaths).toEqual(["src/feature.ts"]);

    const { files: twoDotFiles } = await collectDiff({
      repoPath: r.path,
      baseRef: "main",
      headRef: "feature",
      threeDot: false,
      config: defaultConfig,
    });
    const twoDotPaths = twoDotFiles.map((f) => f.filePath).sort();
    // src/feature.ts is an add; src/shared.ts appears because feature
    // doesn't have main's edit. Three-dot is strictly cleaner for PR use.
    expect(twoDotPaths).toContain("src/feature.ts");
    expect(twoDotPaths).toContain("src/shared.ts");
  });
});
