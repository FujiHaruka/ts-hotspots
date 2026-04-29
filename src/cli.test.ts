import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
const FIXTURE_TSCONFIG = resolve(FIXTURE_DIR, "tsconfig.json");

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

interface ParsedFunctionReport {
  tool: { name: string; version: string };
  project: {
    tsconfigPath: string;
    sourceFileCount: number;
    functionCount: number;
  };
  functionHotspotCandidates: HotspotCandidate[];
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

describe("run (default: function-axis command)", () => {
  test("emits a slim JSON FunctionReport with --json", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, FIXTURE_TSCONFIG, "--json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    expect(stderr.text).toBe("");
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    expect(report.tool.name).toBe("ts-hotspots");
    expect(report.project.tsconfigPath).toBe(FIXTURE_TSCONFIG);
    expect(report.project.sourceFileCount).toBeGreaterThan(0);
    expect(report.project.functionCount).toBeGreaterThan(0);

    // Slim default: only hotspot candidates remain as the primary signal.
    expect(Array.isArray(report.functionHotspotCandidates)).toBe(true);
    expect(report.functionRankings).toBeUndefined();
    expect(report.functionAxisMeta).toBeUndefined();
    expect(report.functions).toBeUndefined();
    expect(report.functionCoOccurrence).toBeUndefined();
  });

  test("--top limits axis size (under --full)", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, FIXTURE_TSCONFIG, "-t", "2", "--full", "--json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    for (const axis of Object.values(report.functionRankings ?? {})) {
      expect(axis.length).toBeLessThanOrEqual(2);
    }
  });

  test("--metrics filters axes under --full; unspecified axes are empty", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, FIXTURE_TSCONFIG, "-m", "sloc", "--full", "--json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    expect((report.functionRankings?.sloc ?? []).length).toBeGreaterThan(0);
    expect(report.functionRankings?.parameterCount).toEqual([]);
    expect(report.functionRankings?.cognitiveComplexity).toEqual([]);
  });

  test("--metrics accepts new v0.3.0 axes without errors (under --full)", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...ARGV_PREFIX,
        FIXTURE_TSCONFIG,
        "-m",
        "callerCount,mutationSiteCount,tryCatchCount,awaitCount,calleeCount",
        "--full",
        "--json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    expect(stderr.text).toBe("");
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    // Meta is emitted for every axis under --full.
    expect(report.functionAxisMeta?.callerCount).toBeDefined();
    expect(report.functionAxisMeta?.calleeCount).toBeDefined();
    expect(report.functionAxisMeta?.tryCatchCount).toBeDefined();
    expect(report.functionAxisMeta?.awaitCount).toBeDefined();
    expect(report.functionAxisMeta?.mutationSiteCount).toBeDefined();
    // Unrequested axes yield empty rankings under --full.
    expect(report.functionRankings?.cognitiveComplexity).toEqual([]);
  });

  test("--metrics rejects unknown axis ids", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, FIXTURE_TSCONFIG, "-m", "notARealAxis", "--json"],
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
      [...ARGV_PREFIX, FIXTURE_TSCONFIG, "--file", "src/a.ts", "--json"],
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

  test("positional directory resolves to <dir>/tsconfig.json", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, FIXTURE_DIR, "--json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    expect(report.project.tsconfigPath).toBe(FIXTURE_TSCONFIG);
  });

  test("missing tsconfig with --json: stdout is error JSON, stderr has human message, exit 1", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const missing = resolve(FIXTURE_DIR, "nope.json");
    const code = await run([...ARGV_PREFIX, missing, "--json"], stdout, stderr);
    expect(code).toBe(1);
    const err = JSON.parse(stdout.text) as {
      error: { code: string; message: string };
    };
    expect(err.error.code).toBe("TSCONFIG_NOT_FOUND");
    expect(err.error.message).toContain(missing);
    expect(stderr.text.length).toBeGreaterThan(0);
  });

  test("default exclude drops *.test.ts files", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, FIXTURE_TSCONFIG, "--full", "--json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    const locations = [
      ...report.functionHotspotCandidates.map((c) => c.ref.location),
      ...Object.values(report.functionRankings ?? {}).flatMap((list) =>
        list.map((e) => e.ref.location),
      ),
    ];
    const names = [
      ...report.functionHotspotCandidates.map((c) => c.ref.name),
      ...Object.values(report.functionRankings ?? {}).flatMap((list) =>
        list.map((e) => e.ref.name),
      ),
    ];
    expect(locations.some((loc) => loc.includes(".test.ts:"))).toBe(false);
    expect(names.some((name) => name === "testOnly")).toBe(false);
  });

  test("--exclude replaces the default so test files are included", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [
        ...ARGV_PREFIX,
        FIXTURE_TSCONFIG,
        "--file",
        "src/a.test.ts",
        "--exclude",
        "nothing-matches",
        "--json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    expect((report.functions ?? []).some((f) => f.name === "testOnly")).toBe(
      true,
    );
  });

  test("functionCoOccurrence is omitted from slim default output", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, FIXTURE_TSCONFIG, "--json"],
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
        ...ARGV_PREFIX,
        FIXTURE_TSCONFIG,
        "-m",
        "cognitiveComplexity,sloc",
        "--json",
      ],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    expect(report.functionCoOccurrence).toBeUndefined();
    // Candidates must stay confined to the requested axes.
    const allowed = new Set(["cognitiveComplexity", "sloc"]);
    for (const c of report.functionHotspotCandidates) {
      for (const key of Object.keys(c.metrics)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
  });

  test("--file drill-down omits functionCoOccurrence", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, FIXTURE_TSCONFIG, "--file", "src/a.ts", "--json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    expect(report.functionCoOccurrence).toBeUndefined();
  });

  test("functionAxisMeta under --full is present for every function axis", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, FIXTURE_TSCONFIG, "--full", "--json"],
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

  test("--full restores rankings, axisMeta, coOccurrence, and functions[]", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, FIXTURE_TSCONFIG, "--full", "--json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    expect(stderr.text).toBe("");
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

    expect(Array.isArray(report.functionHotspotCandidates)).toBe(true);
    expect(report.functionAxisMeta?.cognitiveComplexity).toBeDefined();
  });

  test("--full and slim default agree on functionHotspotCandidates", async () => {
    const fullStdout = new StringSink();
    const fullStderr = new StringSink();
    const fullCode = await run(
      [...ARGV_PREFIX, FIXTURE_TSCONFIG, "--full", "--json"],
      fullStdout,
      fullStderr,
    );
    expect(fullCode).toBe(0);

    const slimStdout = new StringSink();
    const slimStderr = new StringSink();
    const slimCode = await run(
      [...ARGV_PREFIX, FIXTURE_TSCONFIG, "--json"],
      slimStdout,
      slimStderr,
    );
    expect(slimCode).toBe(0);

    const fullReport = JSON.parse(fullStdout.text) as ParsedFunctionReport;
    const slimReport = JSON.parse(slimStdout.text) as ParsedFunctionReport;
    expect(slimReport.functionHotspotCandidates).toEqual(
      fullReport.functionHotspotCandidates,
    );
  });

  test("default invocation emits Markdown with the Claude prompt and fenced JSON", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run([...ARGV_PREFIX, FIXTURE_TSCONFIG], stdout, stderr);
    expect(code).toBe(0);
    expect(stderr.text).toBe("");
    expect(stdout.text.startsWith("# ts-hotspots report")).toBe(true);
    const match = /```json\n([\s\S]*?)\n```/.exec(stdout.text);
    expect(match).not.toBeNull();
    const body = match?.[1] ?? "";
    const parsed = JSON.parse(body) as ParsedFunctionReport;
    expect(parsed.tool.name).toBe("ts-hotspots");
    expect(Array.isArray(parsed.functionHotspotCandidates)).toBe(true);
  });

  test("--json default invocation emits pure JSON (no Markdown header)", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, FIXTURE_TSCONFIG, "--json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    expect(stdout.text.startsWith("#")).toBe(false);
    expect(() => {
      JSON.parse(stdout.text);
    }).not.toThrow();
  });

  test("missing tsconfig without --json emits Markdown error block", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const missing = resolve(FIXTURE_DIR, "nope.json");
    const code = await run([...ARGV_PREFIX, missing], stdout, stderr);
    expect(code).toBe(1);
    expect(stdout.text.startsWith("# ts-hotspots error")).toBe(true);
    expect(stdout.text).toContain(missing);
    expect(stderr.text.length).toBeGreaterThan(0);
  });

  test("--format is rejected as unknown option", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, FIXTURE_TSCONFIG, "-f", "json"],
      stdout,
      stderr,
    );
    expect(code).toBe(1);
    expect(stderr.text).toContain("unknown option");
  });

  test("--no-churn skips git collection (no stderr warning)", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, FIXTURE_TSCONFIG, "--no-churn", "--full", "--json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    expect(stderr.text).toBe("");
    const report = JSON.parse(stdout.text) as ParsedFunctionReport;
    for (const f of report.functions ?? []) {
      expect(f.metrics.commitCount).toBeUndefined();
    }
  });

  test("--churn-window rejects non-positive integers", async () => {
    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, FIXTURE_TSCONFIG, "--churn-window", "0"],
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
    const code = await run([...ARGV_PREFIX, FIXTURE_TSCONFIG], stdout, stderr);
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
      [...ARGV_PREFIX, FIXTURE_TSCONFIG, "--json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    expect(stdout.chunks.length).toBe(1);
    expect(stdout.chunks[0]?.startsWith("#")).toBe(false);
  });

  test("mid-analysis failure closes the Markdown code fence with an error body", async () => {
    // Construct a tsconfig that passes the pre-stream existsSync check but
    // makes loadProject throw (a referenced tsconfig is missing). This
    // exercises the post-head error path and must still produce a
    // well-formed fenced-JSON Markdown document.
    const tmp = mkdtempSync(join(tmpdir(), "ts-hotspots-mid-err-"));
    try {
      const broken = join(tmp, "tsconfig.json");
      writeFileSync(
        broken,
        JSON.stringify({ references: [{ path: "./does-not-exist" }] }),
      );
      const stdout = new StringSink();
      const stderr = new StringSink();
      const code = await run([...ARGV_PREFIX, broken], stdout, stderr);
      expect(code).toBe(1);
      expect(stdout.text.startsWith("# ts-hotspots report")).toBe(true);
      const match = /```json\n([\s\S]*?)\n```/.exec(stdout.text);
      expect(match).not.toBeNull();
      const parsed = JSON.parse(match?.[1] ?? "") as {
        status: string;
        error: { code: string; message: string };
      };
      expect(parsed.status).toBe("error");
      expect(parsed.error.code).toBe("TSCONFIG_NOT_FOUND");
      expect(stderr.text.length).toBeGreaterThan(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("dismissal registry subcommands", () => {
  let projectDir: string;
  let tsconfigPath: string;
  let tmpXdg: string;
  let savedXdg: string | undefined;

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), "ts-hotspots-cli-"));
    cpSync(FIXTURE_DIR, projectDir, { recursive: true });
    tsconfigPath = resolve(projectDir, "tsconfig.json");
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
      [...ARGV_PREFIX, tsconfigPath, "--json"],
      stdout,
      stderr,
    );
    expect(code).toBe(0);
    return JSON.parse(stdout.text) as ParsedFunctionReport;
  }

  test("every candidate carries a sha256 dismissalId", async () => {
    const report = await analyze();
    expect(report.functionHotspotCandidates.length).toBeGreaterThan(0);
    for (const c of report.functionHotspotCandidates) {
      expect(c.dismissalId.startsWith("sha256:")).toBe(true);
    }
  });

  test("empty registry omits dismissed summary", async () => {
    const report = await analyze();
    expect(report.dismissed).toBeUndefined();
  });

  test("dismiss writes registry, next run filters candidate and reports summary", async () => {
    const first = await analyze();
    const target = first.functionHotspotCandidates[0];
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
        tsconfigPath,
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
      second.functionHotspotCandidates.find(
        (c) => c.dismissalId === target.dismissalId,
      ),
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
        tsconfigPath,
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

    const report = await analyze();
    expect(report.dismissed).toEqual({
      active: 0,
      filteredThisRun: 0,
      prunedThisRun: 1,
    });

    const after = JSON.parse(readFileSync(registryFile, "utf8")) as {
      entries: unknown[];
    };
    expect(after.entries).toHaveLength(0);
  });

  test("dismiss is idempotent for an already-dismissed id", async () => {
    const first = await analyze();
    const target = first.functionHotspotCandidates[0];
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
          tsconfigPath,
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
    const target = first.functionHotspotCandidates[0];
    if (target === undefined) throw new Error("fixture has no candidates");

    await run(
      [
        ...ARGV_PREFIX,
        "dismiss",
        target.dismissalId,
        "--reason",
        "r",
        "--path",
        tsconfigPath,
      ],
      new StringSink(),
      new StringSink(),
    );

    const stdout = new StringSink();
    const stderr = new StringSink();
    const code = await run(
      [...ARGV_PREFIX, "list-dismissed", "--json", "--path", tsconfigPath],
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
    const target = first.functionHotspotCandidates[0];
    if (target === undefined) throw new Error("fixture has no candidates");

    await run(
      [
        ...ARGV_PREFIX,
        "dismiss",
        target.dismissalId,
        "--reason",
        "r",
        "--path",
        tsconfigPath,
      ],
      new StringSink(),
      new StringSink(),
    );

    const ok = await run(
      [...ARGV_PREFIX, "undismiss", target.dismissalId, "--path", tsconfigPath],
      new StringSink(),
      new StringSink(),
    );
    expect(ok).toBe(0);

    const stderr = new StringSink();
    const miss = await run(
      [...ARGV_PREFIX, "undismiss", target.dismissalId, "--path", tsconfigPath],
      new StringSink(),
      stderr,
    );
    expect(miss).toBe(1);
    expect(stderr.text).toContain("not found");
  });
});
