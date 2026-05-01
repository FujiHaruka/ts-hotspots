import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { run } from "./cli.ts";
import { registryPath } from "./dismissal/store.ts";
import type {
  AxisMeta,
  DismissedSummary,
  FunctionAxisId,
  FunctionCoOccurrenceEntry,
  HotspotCandidate,
  RankedFunctionEntry,
} from "./schema.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, "../test/fixtures/sample-project");

function initGitRepo(repoRoot: string): void {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@example.com",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@example.com",
  };
  for (const args of [
    ["init", "--initial-branch=main"],
    ["add", "."],
    ["commit", "-m", "init"],
  ] as const) {
    const res = spawnSync("git", args, {
      cwd: repoRoot,
      env,
      encoding: "utf8",
    });
    if (res.status !== 0) {
      throw new Error(
        `git ${args.join(" ")} failed: ${res.stderr || res.stdout}`,
      );
    }
  }
}

class StringSink {
  chunks: string[] = [];
  write(chunk: string): void {
    this.chunks.push(chunk);
  }
  get text(): string {
    return this.chunks.join("");
  }
}

const ARGV_PREFIX = ["node", "ts-hotspots"];
const COMPLEXITY_PREFIX = [...ARGV_PREFIX, "complexity"];

interface ParsedFunctionReport {
  tool: { name: string; version: string };
  project: {
    sourceFileCount: number;
    /** `--verbose` only. */
    functionCount?: number;
  };
  hotspots: HotspotCandidate[];
  functionRankings?: Partial<Record<FunctionAxisId, RankedFunctionEntry[]>>;
  functionAxisMeta?: Record<FunctionAxisId, AxisMeta>;
  functionCoOccurrence?: FunctionCoOccurrenceEntry[];
  functions?: {
    location: string;
    name: string;
    kind: string;
    metrics: Record<string, number>;
  }[];
  dismissed?: DismissedSummary;
}

describe("run (complexity subcommand: function-axis ranking)", () => {
  test("emits a slim JSON FunctionReport with --format json", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...COMPLEXITY_PREFIX, FIXTURE_DIR, "--format", "json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    expect(stderr.text).toMatch(/^ts-hotspots complexity: [^\n]+\n$/);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    expect(report.tool.name).toBe("ts-hotspots");
    expect(report.project.sourceFileCount).toBeGreaterThan(0);
    // Slim default trims `functionCount` from the envelope — it remains
    // on the stderr stats line and surfaces only under `--verbose`.
    expect(report.project.functionCount).toBeUndefined();

    // Slim default: only hotspot candidates remain as the primary signal.
    expect(Array.isArray(report.hotspots)).toBe(true);
    expect(report.functionRankings).toBeUndefined();
    expect(report.functionAxisMeta).toBeUndefined();
    expect(report.functions).toBeUndefined();
    expect(report.functionCoOccurrence).toBeUndefined();
  });

  test("--limit caps hotspots only, not the per-axis rankings", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...COMPLEXITY_PREFIX,
        FIXTURE_DIR,
        "--limit",
        "1",
        "--verbose",
        "--format",
        "json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    expect(report.hotspots.length).toBeLessThanOrEqual(1);
    // --limit must NOT shrink per-axis rankings: the discriminative axes in
    // the fixture should still emit more than one ranked entry.
    const sloc = report.functionRankings?.sloc ?? [];
    expect(sloc.length).toBeGreaterThan(1);
  });

  test("--limit all keeps every candidate", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...COMPLEXITY_PREFIX, FIXTURE_DIR, "--limit", "all", "--format", "json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    // Sanity: a non-zero number of candidates exist so 'all' is observable.
    expect(report.hotspots.length).toBeGreaterThan(0);
  });

  test("--limit is ignored in --file mode and warns on stderr", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...COMPLEXITY_PREFIX,
        FIXTURE_DIR,
        "--file",
        "src/a.ts",
        "--limit",
        "3",
        "--format",
        "json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    expect(stderr.text).toContain("--limit is ignored in --file mode");
  });

  test("--top is no longer accepted (removed from public CLI)", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...COMPLEXITY_PREFIX, FIXTURE_DIR, "-t", "2"],
      stdout,
      stderr,
    );
    expect(code).toBe(1);
    expect(stderr.text).toContain("unknown option");
  });

  test("--json is no longer accepted (use --format json)", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...COMPLEXITY_PREFIX, FIXTURE_DIR, "--json"],
      stdout,
      stderr,
    );
    expect(code).toBe(1);
    expect(stderr.text).toContain("unknown option");
  });

  test("--metrics filters axes under --verbose; unspecified axes are empty", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...COMPLEXITY_PREFIX,
        FIXTURE_DIR,
        "-m",
        "sloc",
        "--verbose",
        "--format",
        "json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    expect((report.functionRankings?.sloc ?? []).length).toBeGreaterThan(0);
    expect(report.functionRankings?.parameterCount).toEqual([]);
    expect(report.functionRankings?.cognitiveComplexity).toEqual([]);
  });

  test("--metrics accepts new v0.3.0 axes without errors (under --verbose)", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...COMPLEXITY_PREFIX,
        FIXTURE_DIR,
        "-m",
        "mutationSiteCount,tryCatchCount,awaitCount,calleeCount",
        "--verbose",
        "--format",
        "json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    expect(stderr.text).toMatch(/^ts-hotspots complexity: [^\n]+\n$/);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    // Meta is emitted for every axis under --verbose.
    expect(report.functionAxisMeta?.calleeCount).toBeDefined();
    expect(report.functionAxisMeta?.tryCatchCount).toBeDefined();
    expect(report.functionAxisMeta?.awaitCount).toBeDefined();
    expect(report.functionAxisMeta?.mutationSiteCount).toBeDefined();
    // Unrequested axes yield empty rankings under --verbose.
    expect(report.functionRankings?.cognitiveComplexity).toEqual([]);
  });

  test("--metrics rejects callerCount (axis was removed)", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...COMPLEXITY_PREFIX,
        FIXTURE_DIR,
        "-m",
        "callerCount",
        "--format",
        "json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(1);
    const err = JSON.parse(stdout.text) as {
      error: { code: string; message: string };
    };
    expect(err.error.code).toBe("INVALID_METRIC");
    expect(err.error.message).toContain("callerCount");
  });

  test("--metrics rejects unknown axis ids", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...COMPLEXITY_PREFIX,
        FIXTURE_DIR,
        "-m",
        "notARealAxis",
        "--format",
        "json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(1);
    const err = JSON.parse(stdout.text) as {
      error: { code: string; message: string };
    };
    expect(err.error.code).toBe("INVALID_METRIC");
    expect(err.error.message).toContain("notARealAxis");
  });

  test("--file drill-down: returns functions in file, no rankings", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...COMPLEXITY_PREFIX,
        FIXTURE_DIR,
        "--file",
        "src/a.ts",
        "--format",
        "json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    expect(report.functions?.length ?? 0).toBeGreaterThan(0);
    expect(
      (report.functions ?? []).every((f) => f.location.startsWith("src/a.ts:")),
    ).toBe(true);
    expect(report.functionRankings).toBeUndefined();
    expect(report.functionAxisMeta).toBeUndefined();
  });

  test("positional directory analyzes that directory's tracked sources", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...COMPLEXITY_PREFIX, FIXTURE_DIR, "--verbose", "--format", "json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    expect(report.project.sourceFileCount).toBeGreaterThan(0);
    // All collected functions live in the fixture's `src/` tree (test files
    // are dropped by the default exclude globs).
    for (const f of report.functions ?? []) {
      expect(f.location.startsWith("src/")).toBe(true);
    }
  });

  test("missing path with --json: stdout is error JSON, stderr has human message, exit 1", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const missing = resolve(FIXTURE_DIR, "no-such-dir");
    const code = await run(
      [...COMPLEXITY_PREFIX, missing, "--format", "json"],
      stdout,
      stderr,
    );
    expect(code).toBe(1);
    const err = JSON.parse(stdout.text) as {
      error: { code: string; message: string };
    };
    expect(err.error.code).toBe("INVALID_ARGS");
    expect(err.error.message).toContain(missing);
    expect(stderr.text.length).toBeGreaterThan(0);
  });

  test("default exclude drops *.test.ts files", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...COMPLEXITY_PREFIX, FIXTURE_DIR, "--verbose", "--format", "json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    const locations = [
      ...report.hotspots.map((c) => c.ref.location),
      ...Object.values(report.functionRankings ?? {}).flatMap((list) =>
        list.map((e) => e.ref.location),
      ),
    ];
    const names = [
      ...report.hotspots.map((c) => c.ref.name),
      ...Object.values(report.functionRankings ?? {}).flatMap((list) =>
        list.map((e) => e.ref.name),
      ),
    ];
    expect(locations.some((loc) => loc.includes(".test.ts:"))).toBe(false);
    expect(names.some((name) => name === "testOnly")).toBe(false);
  });

  test("--exclude is additive: user globs add to the built-in defaults, default test exclusion still applies", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...COMPLEXITY_PREFIX,
        FIXTURE_DIR,
        "--file",
        "src/a.test.ts",
        "--exclude",
        "nothing-matches",
        "--format",
        "json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    // Default test exclusion is still in effect, so a.test.ts is excluded
    // even though `nothing-matches` is added on top.
    expect((report.functions ?? []).some((f) => f.name === "testOnly")).toBe(
      false,
    );
  });

  test("--exclude additive globs drop matching source files", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...COMPLEXITY_PREFIX,
        FIXTURE_DIR,
        "--exclude",
        "**/a.ts",
        "--verbose",
        "--format",
        "json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    const locations = (report.functions ?? []).map((f) => f.location);
    expect(locations.some((loc) => loc.startsWith("src/a.ts:"))).toBe(false);
  });

  test("--exclude is repeatable: each invocation contributes one glob", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...COMPLEXITY_PREFIX,
        FIXTURE_DIR,
        "--exclude",
        "**/a.ts",
        "--exclude",
        "**/b.ts",
        "--verbose",
        "--format",
        "json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    const locations = (report.functions ?? []).map((f) => f.location);
    expect(locations.some((loc) => loc.startsWith("src/a.ts:"))).toBe(false);
    expect(locations.some((loc) => loc.startsWith("src/b.ts:"))).toBe(false);
    // Sanity: other source files survive — the two flags excluded only a.ts and b.ts.
    expect(locations.some((loc) => loc.startsWith("src/c.ts:"))).toBe(true);
  });

  test("functionCoOccurrence is omitted from slim default output", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...COMPLEXITY_PREFIX, FIXTURE_DIR, "--format", "json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    expect(report.functionCoOccurrence).toBeUndefined();
  });

  test("--metrics still drops functionCoOccurrence from slim default", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...COMPLEXITY_PREFIX,
        FIXTURE_DIR,
        "-m",
        "cognitiveComplexity,sloc",
        "--format",
        "json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    expect(report.functionCoOccurrence).toBeUndefined();
    // Candidates must stay confined to the requested axes.
    const allowed = new Set(["cognitiveComplexity", "sloc"]);
    for (const c of report.hotspots) {
      for (const key of Object.keys(c.metrics)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
  });

  test("--file drill-down omits functionCoOccurrence", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...COMPLEXITY_PREFIX,
        FIXTURE_DIR,
        "--file",
        "src/a.ts",
        "--format",
        "json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    expect(report.functionCoOccurrence).toBeUndefined();
  });

  test("functionAxisMeta under --verbose is present for every function axis", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...COMPLEXITY_PREFIX, FIXTURE_DIR, "--verbose", "--format", "json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    const meta = report.functionAxisMeta;
    expect(meta).toBeDefined();
    if (meta === undefined) throw new Error("unreachable");
    expect(meta.cognitiveComplexity).toBeDefined();
    expect(meta.tryCatchCount).toBeDefined();
    for (const axis of Object.values(meta)) {
      expect(axis.nonZeroCount).toBeGreaterThanOrEqual(0);
      expect(axis.maxTieLength).toBeGreaterThanOrEqual(0);
      expect(axis.topNSpread).toBeGreaterThanOrEqual(0);
      expect(axis.uniqueTopNValues).toBeGreaterThanOrEqual(0);
    }
  });

  test("--verbose restores rankings, axisMeta, coOccurrence, and functions[]", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...COMPLEXITY_PREFIX, FIXTURE_DIR, "--verbose", "--format", "json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    expect(stderr.text).toMatch(/^ts-hotspots complexity: [^\n]+\n$/);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;

    expect(Array.isArray(report.functionCoOccurrence)).toBe(true);
    expect(Array.isArray(report.functions)).toBe(true);
    expect((report.functions ?? []).length).toBeGreaterThan(0);

    // Full output: every axis (including non-discriminative) is present.
    const rankings = report.functionRankings;
    expect(rankings).toBeDefined();
    if (rankings === undefined) throw new Error("unreachable");
    const axes = Object.keys(rankings) as FunctionAxisId[];
    expect(axes).toContain("cognitiveComplexity");
    expect(axes).toContain("tryCatchCount");
    expect(rankings.tryCatchCount).toEqual([]);

    expect(Array.isArray(report.hotspots)).toBe(true);
    expect(report.functionAxisMeta?.cognitiveComplexity).toBeDefined();
  });

  test("--verbose and slim default agree on hotspots", async () => {
    const fullStdout = new StringSink();
    const fullStderr = new StringSink();
    const fullCode = await run(
      [...COMPLEXITY_PREFIX, FIXTURE_DIR, "--verbose", "--format", "json"],
      fullStdout,
      fullStderr,
    );
    expect(fullCode).toBe(0);

    const slimStdout = new StringSink();
    const slimStderr = new StringSink();
    const slimCode = await run(
      [...COMPLEXITY_PREFIX, FIXTURE_DIR, "--format", "json"],
      slimStdout,
      slimStderr,
    );
    expect(slimCode).toBe(0);

    const fullReport = JSON.parse(fullStdout.text) as ParsedFunctionReport;
    const slimReport = JSON.parse(slimStdout.text) as ParsedFunctionReport;
    expect(slimReport.hotspots).toEqual(fullReport.hotspots);
  });

  test("emits a `ts-hotspots complexity:` stats line on stderr after a successful run", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...COMPLEXITY_PREFIX, FIXTURE_DIR, "--format", "json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    expect(stderr.text).toMatch(
      /^ts-hotspots complexity: files=\d+, functions=\d+, candidates=\d+\n$/,
    );
  });

  test("--file mode stats line names the inspected file", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...COMPLEXITY_PREFIX,
        FIXTURE_DIR,
        "--file",
        "src/a.ts",
        "--format",
        "json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    expect(stderr.text).toMatch(
      /ts-hotspots complexity: file=src\/a\.ts, functions=\d+/,
    );
  });

  test("default invocation emits Markdown with the Claude prompt and fenced JSON", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run([...COMPLEXITY_PREFIX, FIXTURE_DIR], stdout, stderr);
    expect(code).toBe(0);
    expect(stderr.text).toMatch(/^ts-hotspots complexity: [^\n]+\n$/);
    expect(stdout.text.startsWith("# ts-hotspots report")).toBe(true);
    const match = /```json\n([\s\S]*?)\n```/.exec(stdout.text);
    expect(match).not.toBeNull();
    const body = match?.[1] ?? "";
    const parsed = JSON.parse(body) as ParsedFunctionReport;
    expect(parsed.tool.name).toBe("ts-hotspots");
    expect(Array.isArray(parsed.hotspots)).toBe(true);
  });

  test("--json default invocation emits pure JSON (no Markdown header)", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...COMPLEXITY_PREFIX, FIXTURE_DIR, "--format", "json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    expect(stdout.text.startsWith("#")).toBe(false);
    expect(() => {
      JSON.parse(stdout.text);
    }).not.toThrow();
  });

  test("missing path without --json emits Markdown error block", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const missing = resolve(FIXTURE_DIR, "no-such-dir");
    const code = await run([...COMPLEXITY_PREFIX, missing], stdout, stderr);
    expect(code).toBe(1);
    expect(stdout.text.startsWith("# ts-hotspots error")).toBe(true);
    expect(stdout.text).toContain(missing);
    expect(stderr.text.length).toBeGreaterThan(0);
  });

  test("--format is now accepted (markdown is the default, json is also valid)", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...COMPLEXITY_PREFIX, FIXTURE_DIR, "--format", "markdown"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    expect(stdout.text.startsWith("# ts-hotspots report")).toBe(true);
  });

  test("--format rejects unknown values", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...COMPLEXITY_PREFIX, FIXTURE_DIR, "--format", "yaml"],
      stdout,
      stderr,
    );
    expect(code).toBe(1);
    expect(stderr.text.toLowerCase()).toContain("--format");
  });

  test("--no-churn skips git collection (no stderr warning)", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...COMPLEXITY_PREFIX,
        FIXTURE_DIR,
        "--no-churn",
        "--verbose",
        "--format",
        "json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    expect(stderr.text).toMatch(/^ts-hotspots complexity: [^\n]+\n$/);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    for (const f of report.functions ?? []) {
      expect(f.metrics.commitCount).toBeUndefined();
    }
  });

  test("--churn-window rejects non-positive integers", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...COMPLEXITY_PREFIX, FIXTURE_DIR, "--churn-window", "0"],
      stdout,
      stderr,
    );
    expect(code).toBe(1);
    expect(stderr.text).toContain("--churn-window");
  });

  // The Markdown preamble is written to stdout BEFORE the heavy analysis runs,
  // so downstream consumers with short stdin timeouts (e.g. `claude`'s 3s
  // detection window) see data immediately.
  test("Markdown mode streams the preamble as a separate first write", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run([...COMPLEXITY_PREFIX, FIXTURE_DIR], stdout, stderr);
    expect(code).toBe(0);
    expect(stdout.chunks.length).toBeGreaterThanOrEqual(2);
    const head = stdout.chunks[0] ?? "";
    expect(head.startsWith("# ts-hotspots report")).toBe(true);
    // Head contains only the fence opener, not the JSON body.
    expect(head.endsWith("```json\n")).toBe(true);
    expect(head).not.toContain('"tool"');
    // Body appears in a later chunk and closes the fence.
    expect(stdout.text.endsWith("```\n")).toBe(true);
  });

  test("--json mode remains a single stdout write (no streaming head)", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...COMPLEXITY_PREFIX, FIXTURE_DIR, "--format", "json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    expect(stdout.chunks.length).toBe(1);
    expect(stdout.chunks[0]?.startsWith("#")).toBe(false);
  });

  test("mid-analysis failure closes the Markdown code fence with an error body", async () => {
    // Construct a directory that passes the pre-stream existsSync check
    // but is not a git repo, so `listRepoSources` throws after the
    // streaming preamble has been emitted. This exercises the post-head
    // error path and must still produce a well-formed fenced-JSON
    // Markdown document.
    const tmp = mkdtempSync(join(tmpdir(), "ts-hotspots-mid-err-"));
    try {
      const stdout = new StringSink();
      const stderr = new StringSink();
      const code = await run([...COMPLEXITY_PREFIX, tmp], stdout, stderr);
      expect(code).toBe(1);
      expect(stdout.text.startsWith("# ts-hotspots report")).toBe(true);
      const match = /```json\n([\s\S]*?)\n```/.exec(stdout.text);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match?.[1] ?? "") as {
        status: string;
        error: { code: string; message: string };
      };
      expect(parsed.status).toBe("error");
      expect(parsed.error.code).toBe("NOT_A_GIT_REPO");
      expect(stderr.text.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("dismissal registry subcommands", () => {
  let projectDir: string;
  let tmpXdg: string;
  let savedXdg: string | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "ts-hotspots-cli-"));
    cpSync(FIXTURE_DIR, projectDir, { recursive: true });
    initGitRepo(projectDir);
    tmpXdg = mkdtempSync(join(tmpdir(), "ts-hotspots-xdg-"));
    savedXdg = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = tmpXdg;
  });

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true });
    rmSync(tmpXdg, { recursive: true, force: true });
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
  });

  async function analyze(): Promise<ParsedFunctionReport> {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...COMPLEXITY_PREFIX, projectDir, "--format", "json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    return JSON.parse(stdout.text) as ParsedFunctionReport;
  }

  test("every candidate carries a comp:<hex> dismissalId", async () => {
    const report = await analyze();
    expect(report.hotspots.length).toBeGreaterThan(0);
    for (const c of report.hotspots) {
      expect(c.dismissalId.startsWith("comp:")).toBe(true);
    }
  });

  test("empty registry omits dismissed summary", async () => {
    const report = await analyze();
    expect(report.dismissed).toBeUndefined();
  });

  test("dismiss writes registry, next run filters candidate and reports summary", async () => {
    const first = await analyze();
    const target = first.hotspots[0];
    if (target === undefined) throw new Error("fixture has no candidates");

    const dismissOut = new StringSink();
    const dismissErr = new StringSink();
    const dismissCode = await run(
      [
        ...ARGV_PREFIX,
        "dismiss",
        target.dismissalId,
        "--reason",
        "intentional pattern",
        "--path",
        projectDir,
      ],
      dismissOut,
      dismissErr,
    );
    expect(dismissCode).toBe(0);

    const registryFile = registryPath(projectDir);
    expect(registryFile.startsWith(join(tmpXdg, "ts-hotspots"))).toBe(true);
    expect(existsSync(registryFile)).toBe(true);
    const saved = JSON.parse(readFileSync(registryFile, "utf8")) as {
      projectPath?: string;
      entries: { id: string; reason: string; display?: unknown }[];
    };
    expect(saved.projectPath).toBe(projectDir);
    expect(saved.entries).toHaveLength(1);
    expect(saved.entries[0]?.id).toBe(target.dismissalId);
    expect(saved.entries[0]?.reason).toBe("intentional pattern");
    expect(saved.entries[0]?.display).toBeDefined();

    const second = await analyze();
    expect(
      second.hotspots.find((c) => c.dismissalId === target.dismissalId),
    ).toBeUndefined();
    expect(second.dismissed).toEqual({
      active: 1,
      filteredThisRun: 1,
      prunedThisRun: 0,
    });
  });

  test("stale entries get pruned automatically on next analyze", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const dismissCode = await run(
      [
        ...ARGV_PREFIX,
        "dismiss",
        "sha256:ghostnotinproject",
        "--reason",
        "stale",
        "--path",
        projectDir,
      ],
      stdout,
      stderr,
    );
    expect(dismissCode).toBe(0);

    const registryFile = registryPath(projectDir);
    const before = JSON.parse(readFileSync(registryFile, "utf8")) as {
      entries: unknown[];
    };
    expect(before.entries).toHaveLength(1);

    const analyzeOut = new StringSink();
    const analyzeErr = new StringSink();
    const analyzeCode = await run(
      [...COMPLEXITY_PREFIX, projectDir, "--format", "json"],
      analyzeOut,
      analyzeErr,
    );
    expect(analyzeCode).toBe(0);
    const report = JSON.parse(analyzeOut.text) as ParsedFunctionReport;
    expect(report.dismissed).toEqual({
      active: 0,
      filteredThisRun: 0,
      prunedThisRun: 1,
    });
    expect(analyzeErr.text).toContain(
      "ts-hotspots complexity: pruned 1 expired dismissal (function changed since dismiss)",
    );

    const after = JSON.parse(readFileSync(registryFile, "utf8")) as {
      entries: unknown[];
    };
    expect(after.entries).toHaveLength(0);
  });

  test("dismiss is idempotent for an already-dismissed id", async () => {
    const first = await analyze();
    const target = first.hotspots[0];
    if (target === undefined) throw new Error("fixture has no candidates");

    for (let i = 0; i < 2; i += 1) {
      const stdout = new StringSink();
      const stderr = new StringSink();
      const code = await run(
        [
          ...ARGV_PREFIX,
          "dismiss",
          target.dismissalId,
          "--reason",
          "first",
          "--path",
          projectDir,
        ],
        stdout,
        stderr,
      );
      expect(code).toBe(0);
    }

    const registryFile = registryPath(projectDir);
    const saved = JSON.parse(readFileSync(registryFile, "utf8")) as {
      entries: unknown[];
    };
    expect(saved.entries).toHaveLength(1);
  });

  test("list-dismissed --json prints the registry", async () => {
    const first = await analyze();
    const target = first.hotspots[0];
    if (target === undefined) throw new Error("fixture has no candidates");

    await run(
      [
        ...ARGV_PREFIX,
        "dismiss",
        target.dismissalId,
        "--reason",
        "r",
        "--path",
        projectDir,
      ],
      new StringSink(),
      new StringSink(),
    );

    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, "list-dismissed", "--json", "--path", projectDir],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout.text) as {
      entries: { id: string }[];
    };
    expect(parsed.entries.map((e) => e.id)).toEqual([target.dismissalId]);
  });

  test("undismiss removes an entry and errors when id absent", async () => {
    const first = await analyze();
    const target = first.hotspots[0];
    if (target === undefined) throw new Error("fixture has no candidates");

    await run(
      [
        ...ARGV_PREFIX,
        "dismiss",
        target.dismissalId,
        "--reason",
        "r",
        "--path",
        projectDir,
      ],
      new StringSink(),
      new StringSink(),
    );

    const ok = await run(
      [...ARGV_PREFIX, "undismiss", target.dismissalId, "--path", projectDir],
      new StringSink(),
      new StringSink(),
    );
    expect(ok).toBe(0);

    const stderr = new StringSink();
    const miss = await run(
      [...ARGV_PREFIX, "undismiss", target.dismissalId, "--path", projectDir],
      new StringSink(),
      stderr,
    );
    expect(miss).toBe(1);
    expect(stderr.text).toContain("not found");
  });
});

describe("duplication subcommand routing", () => {
  test("`duplication --help` shows usage and returns 0", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, "duplication", "--help"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    expect(stdout.text).toBe("");
    expect(stderr.text).toContain("Usage:");
    expect(stderr.text).toContain("--diff <revrange>");
  });

  test("`duplication` forwards unknown flags to its parser (commander does not reject them)", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, "duplication", "--no-such-flag"],
      stdout,
      stderr,
    );
    // The duplication parser raises ArgParseError for unknown flag, not
    // commander. The stderr message therefore comes from duplication,
    // prefixed with "ts-hotspots duplication:" and ending with its USAGE.
    expect(code).toBe(1);
    expect(stderr.text).toContain("ts-hotspots duplication:");
    expect(stderr.text).toContain("Usage:");
  });

  test("`dup` alias routes to the same handler as `duplication`", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run([...ARGV_PREFIX, "dup", "--help"], stdout, stderr);
    expect(code).toBe(0);
    expect(stderr.text).toContain("--diff <revrange>");
  });
});

describe("complexity subcommand routing", () => {
  test("running with no subcommand prints help on stderr and exits non-zero", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run([...ARGV_PREFIX], stdout, stderr);
    expect(code).toBe(1);
    expect(stdout.text).toBe("");
    expect(stderr.text).toContain("Usage: ts-hotspots");
    expect(stderr.text).toContain("complexity|comp");
    expect(stderr.text).toContain("duplication|dup");
    expect(stderr.text).not.toContain("(outputHelp)");
  });

  test("`comp` alias routes to the complexity handler", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      ["node", "ts-hotspots", "comp", FIXTURE_DIR, "--format", "json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    expect(stderr.text).toMatch(/^ts-hotspots complexity: [^\n]+\n$/);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    expect(report.tool.name).toBe("ts-hotspots");
    expect(report.project.sourceFileCount).toBeGreaterThan(0);
  });
});
