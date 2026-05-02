/**
 * Cochange CLI integration test. The git layer is injected via
 * `runPipeline`'s `deps` parameter, so tests pass hand-crafted
 * `git log` strings instead of spinning up a fixture repo (the
 * sandbox's git signing wrapper breaks `git commit`, which is what
 * a real fixture would need to produce non-trivial history).
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { CliIO } from "../../cli/streaming.ts";
import { COMMIT_MARKER } from "../../util/git/walkChurnLog.ts";
import type { CochangeParsedArgs } from "./args.ts";
import { type CochangeRunDeps, runPipeline } from "./main.ts";
import type { runGitLog as runGitLogReal } from "./runGitLog.ts";

interface CapturedIO {
  io: CliIO;
  stdout: () => string;
  stderr: () => string;
}

function captureIO(cwd: string): CapturedIO {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const io: CliIO = {
    stdout: {
      write: (chunk: string): boolean => {
        stdoutChunks.push(chunk);
        return true;
      },
    },
    stderr: {
      write: (chunk: string): boolean => {
        stderrChunks.push(chunk);
        return true;
      },
    },
    cwd: () => cwd,
  };
  return {
    io,
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join(""),
  };
}

function withSha(sha: string): string {
  return `${COMMIT_MARKER} ${sha}`;
}

interface FixtureRepo {
  path: string;
  cleanup: () => void;
}

/**
 * Make a directory look like a git repo to `findGitRoot` and create
 * the TypeScript files cochange's `git ls-files` filter would pick up.
 * We do NOT initialise an actual git history (`git commit` is broken in
 * the sandbox); instead we use `git init` + `git add` + `git update-index
 * --add` to register files in the index so `git ls-files` returns them.
 */
function createFixtureRepo(files: readonly string[]): FixtureRepo {
  const dir = mkdtempSync(join(tmpdir(), "ts-hotspots-coch-cli-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  for (const f of files) {
    const abs = join(dir, f);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, `// ${f}\nexport const x = 1;\n`);
  }
  if (files.length > 0) {
    execFileSync("git", ["add", "--", ...files], { cwd: dir });
  }
  return {
    path: dir,
    cleanup: () => {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

function makeArgs(
  overrides: Partial<CochangeParsedArgs> = {},
): CochangeParsedArgs {
  return {
    kind: "run",
    path: undefined,
    format: "json",
    excludeGlobs: [],
    ref: "HEAD",
    diff: undefined,
    window: 200,
    minSupport: 3,
    maxFilesPerCommit: 50,
    limit: 20,
    verbose: false,
    ...overrides,
  };
}

interface DiffStubOptions {
  baseSha: string;
  headSha: string;
  changedFiles: readonly string[];
}

function makeDeps(
  rawLog: string | undefined,
  isShallow = false,
  diffStub?: DiffStubOptions,
): CochangeRunDeps {
  const runGitLog: typeof runGitLogReal = () => rawLog;
  return {
    runGitLog,
    runGitShowPrefix: () => "",
    runGitIsShallow: () => isShallow,
    resolveDiffEndpoints: (_cwd, _baseRef, _headRef, _threeDot) => {
      if (diffStub === undefined) {
        return Promise.reject(
          new Error("resolveDiffEndpoints called but no diff stub provided"),
        );
      }
      return Promise.resolve({
        baseSha: diffStub.baseSha,
        headSha: diffStub.headSha,
      });
    },
    listChangedFilePaths: (_repoPath, _baseSha, _headSha) => {
      if (diffStub === undefined) {
        return Promise.reject(
          new Error("listChangedFilePaths called but no diff stub provided"),
        );
      }
      return Promise.resolve([...diffStub.changedFiles]);
    },
  };
}

describe("cochange CLI: runPipeline", () => {
  const cleanups: (() => void)[] = [];
  beforeEach(() => {
    cleanups.length = 0;
  });
  afterEach(() => {
    while (cleanups.length > 0) cleanups.pop()?.();
  });

  test("returns intact JSON envelope with empty hotspots when no pairs survive the gate", async () => {
    const repo = createFixtureRepo(["src/a.ts", "src/b.ts"]);
    cleanups.push(repo.cleanup);
    const cap = captureIO(repo.path);
    // One co-change is below the default min-support of 3, so the pair
    // is filtered by the gate.
    const rawLog = [withSha("aaaaaaa"), "M\tsrc/a.ts", "M\tsrc/b.ts"].join(
      "\n",
    );
    const code = await runPipeline(
      makeArgs({ path: repo.path }),
      cap.io,
      makeDeps(rawLog),
    );
    expect(code).toBe(0);
    const out = JSON.parse(cap.stdout()) as {
      tool: { name: string };
      project: { windowCommits: number; analyzedFileCount: number };
      hotspots: unknown[];
    };
    expect(out.tool.name).toBe("ts-hotspots");
    expect(out.project.analyzedFileCount).toBe(2);
    expect(out.project.windowCommits).toBe(1);
    expect(out.hotspots).toEqual([]);
  });

  test("emits a hotspot with coch: dismissalId when a pair clears the gate", async () => {
    const repo = createFixtureRepo(["src/a.ts", "src/b.ts", "src/c.ts"]);
    cleanups.push(repo.cleanup);
    const cap = captureIO(repo.path);
    // Default gate: support >= 3, lift > 1, confidenceMax >= 0.30.
    // 3 co-change commits on (A, B); 2 padding commits that touch only
    // an unrelated file C so window grows without inflating
    // changes(A) / changes(B).
    // changesA = changesB = 3, support = 3, actualWindow = 5.
    // confidenceMax = 3/3 = 1.0; lift = (3 * 5) / (3 * 3) = 1.667 > 1.
    const rawLog = [
      withSha("aaa1111"),
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
      withSha("aaa2222"),
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
      withSha("aaa3333"),
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
      withSha("padddd1"),
      "M\tsrc/c.ts",
      withSha("padddd2"),
      "M\tsrc/c.ts",
    ].join("\n");
    const code = await runPipeline(
      makeArgs({ path: repo.path }),
      cap.io,
      makeDeps(rawLog),
    );
    expect(code).toBe(0);
    const out = JSON.parse(cap.stdout()) as {
      hotspots: {
        kind: string;
        size: number;
        score: { axis: string; value: number };
        members: { ref: { location: string; kind: string } }[];
        metrics: { support: number; lift: number };
        dismissalId: string;
      }[];
    };
    expect(out.hotspots).toHaveLength(1);
    const h = out.hotspots[0];
    if (h === undefined) throw new Error("expected one hotspot");
    expect(h.kind).toBe("cochange");
    expect(h.size).toBe(2);
    expect(h.score.axis).toBe("confidenceMax");
    expect(h.members.map((m) => m.ref.location).sort()).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
    expect(h.metrics.support).toBeGreaterThanOrEqual(3);
    expect(h.metrics.lift).toBeGreaterThan(1.0);
    expect(h.dismissalId).toMatch(/^coch:[0-9a-f]{16}$/);
  });

  test("graceful skip on git-log failure: empty hotspots, intact envelope, stderr warning", async () => {
    const repo = createFixtureRepo(["src/a.ts"]);
    cleanups.push(repo.cleanup);
    const cap = captureIO(repo.path);
    const code = await runPipeline(
      makeArgs({ path: repo.path }),
      cap.io,
      makeDeps(undefined),
    );
    expect(code).toBe(0);
    const out = JSON.parse(cap.stdout()) as { hotspots: unknown[] };
    expect(out.hotspots).toEqual([]);
    expect(cap.stderr()).toContain("git log failed");
  });

  test("graceful skip on non-git path: error envelope (NOT_A_GIT_REPO)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ts-hotspots-coch-nogit-"));
    cleanups.push(() => {
      rmSync(dir, { recursive: true, force: true });
    });
    const cap = captureIO(dir);
    const code = await runPipeline(
      makeArgs({ path: dir }),
      cap.io,
      makeDeps(undefined),
    );
    expect(code).toBe(1);
    const out = JSON.parse(cap.stdout()) as {
      status: string;
      error: { code: string };
    };
    expect(out.status).toBe("error");
    expect(out.error.code).toBe("NOT_A_GIT_REPO");
  });

  test("--diff filters out pairs that don't touch any changed file and emits the diff envelope", async () => {
    const repo = createFixtureRepo([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
      "src/d.ts",
    ]);
    cleanups.push(repo.cleanup);
    const cap = captureIO(repo.path);
    // Two pairs clear the gate independently:
    //   (a, b) — three co-change commits
    //   (c, d) — three co-change commits
    // Padding commits keep both pairs distinct in window stats.
    const rawLog = [
      withSha("aaa1111"),
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
      withSha("aaa2222"),
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
      withSha("aaa3333"),
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
      withSha("ccc1111"),
      "M\tsrc/c.ts",
      "M\tsrc/d.ts",
      withSha("ccc2222"),
      "M\tsrc/c.ts",
      "M\tsrc/d.ts",
      withSha("ccc3333"),
      "M\tsrc/c.ts",
      "M\tsrc/d.ts",
    ].join("\n");
    const diffStub = {
      baseSha: "0".repeat(40),
      headSha: "1".repeat(40),
      // Only src/a.ts is in the changed-file set; (a, b) survives the
      // filter, (c, d) is dropped.
      changedFiles: ["src/a.ts"],
    };
    const code = await runPipeline(
      makeArgs({
        path: repo.path,
        diff: { baseRef: "origin/main", headRef: "HEAD", threeDot: true },
      }),
      cap.io,
      makeDeps(rawLog, false, diffStub),
    );
    expect(code).toBe(0);
    const out = JSON.parse(cap.stdout()) as {
      diff?: {
        baseSha: string;
        headSha: string;
        threeDot: boolean;
        changedFiles: number;
      };
      hotspots: {
        members: { ref: { location: string } }[];
      }[];
    };
    expect(out.diff).toBeDefined();
    expect(out.diff?.baseSha).toBe(diffStub.baseSha);
    expect(out.diff?.headSha).toBe(diffStub.headSha);
    expect(out.diff?.threeDot).toBe(true);
    expect(out.diff?.changedFiles).toBe(1);
    // Only the (a, b) pair survives; (c, d) is dropped.
    expect(out.hotspots).toHaveLength(1);
    const locations = out.hotspots[0]?.members
      .map((m) => m.ref.location)
      .sort();
    expect(locations).toEqual(["src/a.ts", "src/b.ts"]);
  });

  test("--diff keeps a pair when at least one side is in the changed-file set", async () => {
    const repo = createFixtureRepo(["src/a.ts", "src/b.ts", "src/c.ts"]);
    cleanups.push(repo.cleanup);
    const cap = captureIO(repo.path);
    const rawLog = [
      withSha("aaa1111"),
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
      withSha("aaa2222"),
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
      withSha("aaa3333"),
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
      withSha("padddd1"),
      "M\tsrc/c.ts",
      withSha("padddd2"),
      "M\tsrc/c.ts",
    ].join("\n");
    const diffStub = {
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      // Neither pathA nor pathB is here directly — only the OTHER side
      // of the pair (b) is in the set. Asserts the OR-logic: any
      // member matching keeps the pair.
      changedFiles: ["src/b.ts"],
    };
    const code = await runPipeline(
      makeArgs({
        path: repo.path,
        diff: { baseRef: "main", headRef: "HEAD", threeDot: false },
      }),
      cap.io,
      makeDeps(rawLog, false, diffStub),
    );
    expect(code).toBe(0);
    const out = JSON.parse(cap.stdout()) as {
      diff?: { changedFiles: number };
      hotspots: { members: { ref: { location: string } }[] }[];
    };
    expect(out.diff?.changedFiles).toBe(1);
    expect(out.hotspots).toHaveLength(1);
  });

  test("--ref and --diff are orthogonal: both can be passed simultaneously", async () => {
    const repo = createFixtureRepo(["src/a.ts", "src/b.ts", "src/c.ts"]);
    cleanups.push(repo.cleanup);
    const cap = captureIO(repo.path);
    const rawLog = [
      withSha("aaa1111"),
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
      withSha("aaa2222"),
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
      withSha("aaa3333"),
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
      withSha("padddd1"),
      "M\tsrc/c.ts",
      withSha("padddd2"),
      "M\tsrc/c.ts",
    ].join("\n");
    let observedRef: string | undefined;
    const runGitLog: typeof runGitLogReal = (opts) => {
      observedRef = opts.ref;
      return rawLog;
    };
    const diffStub = {
      baseSha: "0".repeat(40),
      headSha: "1".repeat(40),
      changedFiles: ["src/a.ts"],
    };
    const code = await runPipeline(
      makeArgs({
        path: repo.path,
        ref: "release/v2",
        diff: { baseRef: "origin/main", headRef: "HEAD", threeDot: true },
      }),
      cap.io,
      {
        runGitLog,
        runGitShowPrefix: () => "",
        runGitIsShallow: () => false,
        resolveDiffEndpoints: () =>
          Promise.resolve({
            baseSha: diffStub.baseSha,
            headSha: diffStub.headSha,
          }),
        listChangedFilePaths: () => Promise.resolve([...diffStub.changedFiles]),
      },
    );
    expect(code).toBe(0);
    // --ref selected the window endpoint passed to git log...
    expect(observedRef).toBe("release/v2");
    const out = JSON.parse(cap.stdout()) as {
      diff?: { changedFiles: number };
      hotspots: unknown[];
    };
    // ...while --diff still produced the display filter and envelope.
    expect(out.diff?.changedFiles).toBe(1);
    expect(out.hotspots).toHaveLength(1);
  });
});
