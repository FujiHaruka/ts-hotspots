import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { run } from "./cli.ts";

class StringSink {
  chunks: string[] = [];
  write(chunk: string): void {
    this.chunks.push(chunk);
  }
  get text(): string {
    return this.chunks.join("");
  }
}

const ARGV_PREFIX = ["node", "ts-hotspots", "complexity"];

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

// A function body with enough cognitive load (nested ifs, try/catch, awaits)
// to surface in `hotspots`. The bodies for `a.ts` and `b.ts`
// are nearly identical, so both functions are equally complex — the filter,
// not the score, is what scopes the output to one file.
function complexFn(name: string): string {
  return [
    "// biome-ignore-all lint/suspicious/noExplicitAny: fixture",
    `export async function ${name}(input: any): Promise<number> {`,
    "  let total = 0;",
    "  if (input != null) {",
    "    if (typeof input === 'object') {",
    "      try {",
    "        for (const k of Object.keys(input)) {",
    "          if (k.length > 0) {",
    "            const v = await Promise.resolve(input[k]);",
    "            if (typeof v === 'number') {",
    "              total += v;",
    "            } else if (typeof v === 'string') {",
    "              total += v.length;",
    "            }",
    "          }",
    "        }",
    "      } catch (e) {",
    "        total = -1;",
    "      }",
    "    }",
    "  }",
    "  return total;",
    "}",
    "",
  ].join("\n");
}

function buildFixtureRepo(repoRoot: string): void {
  touch(
    repoRoot,
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        target: "esnext",
        module: "nodenext",
        moduleResolution: "nodenext",
        strict: true,
      },
      include: ["src/**/*"],
    }),
  );
  touch(repoRoot, "src/a.ts", complexFn("processA"));
  touch(repoRoot, "src/b.ts", complexFn("processB"));
  // Third file with a simpler function so per-axis top-N has non-zero spread
  // and unique value count > 1. Without this, processA / processB tie on every
  // metric and every axis is degenerate under the candidate gate.
  touch(
    repoRoot,
    "src/c.ts",
    "export function tieBreaker(x: number): number { if (x > 0) return x + 1; return 0; }\n",
  );
  git(repoRoot, ["init", "--initial-branch=main"]);
  git(repoRoot, ["add", "."]);
  git(repoRoot, ["commit", "-m", "c1"]);

  // Modify only src/a.ts in the second commit. src/b.ts is unchanged.
  touch(
    repoRoot,
    "src/a.ts",
    `${complexFn("processA")}\nexport const x = 1;\n`,
  );
  git(repoRoot, ["add", "."]);
  git(repoRoot, ["commit", "-m", "c2"]);
}

interface PrEnvelope {
  pr?: {
    baseSha: string;
    headSha: string;
    threeDot: boolean;
    changedFiles: number;
  };
  hotspots: { ref: { location: string } }[];
  functionRankings?: Record<string, { ref: { location: string } }[]>;
  functionCoOccurrence?: { ref: { location: string } }[];
  notice?: { code: string; message: string };
}

describe("complexity --pr (PR scope filter)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ts-hotspots-comp-pr-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("scopes hotspot candidates to functions in changed files", async () => {
    buildFixtureRepo(tmp);

    // Sanity: without --pr both files contribute candidates.
    const baselineStdout = new StringSink();
    const baselineStderr = new StringSink();
    const baselineCode = await run(
      [...ARGV_PREFIX, tmp, "--format", "json"],
      baselineStdout,
      baselineStderr,
    );
    expect(baselineCode).toBe(0);
    const baseline = JSON.parse(baselineStdout.text) as PrEnvelope;
    expect(baseline.pr).toBeUndefined();
    const baselineFiles = new Set(
      baseline.hotspots.map((c) => c.ref.location.split(":")[0]),
    );
    expect(baselineFiles.has("src/a.ts")).toBe(true);
    expect(baselineFiles.has("src/b.ts")).toBe(true);

    // With --pr, only the changed file (src/a.ts) should appear.
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, tmp, "--pr", "HEAD~1..HEAD", "--format", "json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as PrEnvelope;
    expect(report.pr).toBeDefined();
    expect(report.pr?.changedFiles).toBe(1);
    expect(report.pr?.threeDot).toBe(false);
    expect(report.pr?.baseSha).toMatch(/^[0-9a-f]{40}$/);
    expect(report.pr?.headSha).toMatch(/^[0-9a-f]{40}$/);
    expect(report.hotspots.length).toBeGreaterThan(0);
    for (const c of report.hotspots) {
      expect(c.ref.location.startsWith("src/a.ts:")).toBe(true);
    }
    expect(report.notice).toBeUndefined();
    expect(stderr.text).toMatch(/pr=1 changed files/);
  });

  test("--verbose filters rankings and co-occurrence to changed files", async () => {
    buildFixtureRepo(tmp);

    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...ARGV_PREFIX,
        tmp,
        "--pr",
        "HEAD~1..HEAD",
        "--verbose",
        "--format",
        "json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as PrEnvelope;
    expect(report.functionRankings).toBeDefined();
    for (const axis of Object.keys(report.functionRankings ?? {})) {
      const entries = report.functionRankings?.[axis] ?? [];
      for (const e of entries) {
        expect(e.ref.location.startsWith("src/a.ts:")).toBe(true);
      }
    }
    for (const e of report.functionCoOccurrence ?? []) {
      expect(e.ref.location.startsWith("src/a.ts:")).toBe(true);
    }
  });

  test("empty changed-set yields no candidates and changedFiles=0", async () => {
    buildFixtureRepo(tmp);

    const stdout = new StringSink();
    const stderr = new StringSink();
    // HEAD..HEAD: no files changed.
    const code = await run(
      [...ARGV_PREFIX, tmp, "--pr", "HEAD..HEAD", "--format", "json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as PrEnvelope;
    expect(report.pr?.changedFiles).toBe(0);
    expect(report.hotspots).toEqual([]);
    expect(report.notice?.code).toBe("PR_SCOPE_EMPTY");
    expect(report.notice?.message).toMatch(/no functions/i);
    expect(stderr.text).toMatch(/pr=0 changed files/);
  });

  test("PR_SCOPE_EMPTY notice also surfaces in --verbose mode", async () => {
    buildFixtureRepo(tmp);

    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...ARGV_PREFIX,
        tmp,
        "--pr",
        "HEAD..HEAD",
        "--verbose",
        "--format",
        "json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as PrEnvelope;
    expect(report.pr?.changedFiles).toBe(0);
    expect(report.notice?.code).toBe("PR_SCOPE_EMPTY");
  });

  test("rejects --pr combined with --file", async () => {
    buildFixtureRepo(tmp);

    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...ARGV_PREFIX,
        tmp,
        "--pr",
        "HEAD~1..HEAD",
        "--file",
        "src/a.ts",
        "--format",
        "json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(1);
    const errReport = JSON.parse(stdout.text) as {
      status: string;
      error: { code: string; message: string };
    };
    expect(errReport.status).toBe("error");
    expect(errReport.error.code).toBe("INVALID_ARGS");
    expect(errReport.error.message).toMatch(/--pr.*--file/);
  });

  test("invalid revrange surfaces commander's parse error", async () => {
    buildFixtureRepo(tmp);

    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, tmp, "--pr", "not-a-range", "--format", "json"],
      stdout,
      stderr,
    );
    expect(code).toBe(1);
    expect(stderr.text).toMatch(/revrange must contain/);
  });

  test("running outside a git repo emits NOT_A_GIT_REPO", async () => {
    // No git init; just a tsconfig + sources.
    touch(
      tmp,
      "tsconfig.json",
      JSON.stringify({
        compilerOptions: {
          target: "esnext",
          module: "nodenext",
          moduleResolution: "nodenext",
          strict: true,
        },
        include: ["src/**/*"],
      }),
    );
    touch(tmp, "src/a.ts", complexFn("processA"));

    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, tmp, "--pr", "HEAD~1..HEAD", "--format", "json"],
      stdout,
      stderr,
    );
    expect(code).toBe(1);
    // Streaming mode is JSON, so the error envelope is on stdout.
    const errReport = JSON.parse(stdout.text) as {
      status: string;
      error: { code: string; message: string };
    };
    expect(errReport.status).toBe("error");
    expect(errReport.error.code).toBe("NOT_A_GIT_REPO");
  });
});
