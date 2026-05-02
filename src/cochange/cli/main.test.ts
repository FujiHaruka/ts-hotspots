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
    window: 200,
    minSupport: 3,
    maxFilesPerCommit: 50,
    limit: 20,
    verbose: false,
    ...overrides,
  };
}

function makeDeps(
  rawLog: string | undefined,
  isShallow = false,
): CochangeRunDeps {
  const runGitLog: typeof runGitLogReal = () => rawLog;
  return {
    runGitLog,
    runGitShowPrefix: () => "",
    runGitIsShallow: () => isShallow,
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
});
