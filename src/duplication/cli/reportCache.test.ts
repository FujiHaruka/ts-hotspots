import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTempRepo,
  type TempRepo,
} from "../../../test/dedup/e2e/helpers/tempRepo.ts";
import { run as runRoot } from "../../cli.ts";
import type { CloneCandidateReport } from "../domain/report.ts";
import type { ParsedArgs } from "./args.ts";
import { type MainIO, runPipeline } from "./main.ts";
import {
  DEFAULT_CACHE_LIMITS,
  readCachedReport,
  reportCacheDir,
  writeCachedReport,
} from "./reportCache.ts";

const savedConfigHome = process.env.XDG_CONFIG_HOME;
const savedCacheHome = process.env.XDG_CACHE_HOME;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) Reflect.deleteProperty(process.env, name);
  else process.env[name] = value;
}

let xdgConfig: string;
let xdgCache: string;
const repos: TempRepo[] = [];

beforeEach(() => {
  xdgConfig = mkdtempSync(join(tmpdir(), "ts-hotspots-xdg-config-"));
  xdgCache = mkdtempSync(join(tmpdir(), "ts-hotspots-xdg-cache-"));
  process.env.XDG_CONFIG_HOME = xdgConfig;
  process.env.XDG_CACHE_HOME = xdgCache;
});

afterEach(() => {
  while (repos.length > 0) repos.pop()?.cleanup();
  rmSync(xdgConfig, { recursive: true, force: true });
  rmSync(xdgCache, { recursive: true, force: true });
  restoreEnv("XDG_CONFIG_HOME", savedConfigHome);
  restoreEnv("XDG_CACHE_HOME", savedCacheHome);
});

const BODY = `  if (a < 0) throw new Error("negative a");
  if (b < 0) throw new Error("negative b");
  const total = a + b;
  return total;
}
`;

function makeDupRepo(): TempRepo {
  const r = createTempRepo("ts-hotspots-cache-");
  repos.push(r);
  r.write("src/a.ts", `export function add(a: number, b: number) {\n${BODY}`);
  r.write(
    "src/b.ts",
    `export function addCopy(a: number, b: number) {\n${BODY}`,
  );
  r.commit("init");
  return r;
}

function wholeRepoArgs(
  path: string,
  overrides: Partial<ParsedArgs> = {},
): ParsedArgs {
  return {
    kind: "run",
    mode: "whole-repo",
    ref: "HEAD",
    path,
    format: "json",
    excludeGlobs: [],
    phaseTimings: undefined,
    limit: 20,
    verbose: false,
    churn: { enabled: true, window: 200, ref: undefined },
    cache: true,
    ...overrides,
  } as ParsedArgs;
}

async function runCaptured(args: ParsedArgs): Promise<string> {
  const chunks: string[] = [];
  const io: MainIO = {
    stdout: {
      write: (c: string): boolean => {
        chunks.push(c);
        return true;
      },
    } as NodeJS.WritableStream,
    stderr: {
      write: (): boolean => true,
    } as unknown as NodeJS.WritableStream,
    cwd: () => args.path ?? process.cwd(),
  };
  const code = await runPipeline(args, io);
  expect(code).toBe(0);
  return chunks.join("");
}

function cacheEntries(projectDir: string): string[] {
  try {
    return readdirSync(reportCacheDir(projectDir)).filter((n) =>
      n.endsWith(".json.gz"),
    );
  } catch {
    return [];
  }
}

function emptyCachedGroups(projectDir: string): void {
  const dir = reportCacheDir(projectDir);
  for (const name of cacheEntries(projectDir)) {
    const path = join(dir, name);
    const envelope = JSON.parse(
      gunzipSync(readFileSync(path)).toString("utf8"),
    ) as { report: CloneCandidateReport };
    envelope.report.groups = [];
    writeFileSync(path, gzipSync(JSON.stringify(envelope)));
  }
}

describe("duplication report cache", () => {
  it("a cache hit prints exactly what an uncached run prints", async () => {
    const r = makeDupRepo();
    r.write(
      "src/c.ts",
      `export function addAgain(x: number, b: number) {\n${BODY.replaceAll("a", "x")}`,
    );
    r.commit("add another copy");
    const variants: Partial<ParsedArgs>[] = [
      { format: "json", verbose: false },
      { format: "json", verbose: true },
      { format: "markdown", verbose: false },
      { format: "markdown", verbose: true },
      {
        mode: "diff",
        baseRef: "HEAD~1",
        headRef: "HEAD",
        threeDot: true,
        format: "json",
        verbose: true,
      } as Partial<ParsedArgs>,
    ];
    const diffReport = JSON.parse(
      await runCaptured(
        wholeRepoArgs(r.path, { ...variants[4], cache: false }),
      ),
    ) as { hotspots: { anchor?: unknown }[] };
    expect(diffReport.hotspots.some((h) => h.anchor !== undefined)).toBe(true);
    for (const variant of variants) {
      const uncached = await runCaptured(
        wholeRepoArgs(r.path, { ...variant, cache: false }),
      );
      const cold = await runCaptured(wholeRepoArgs(r.path, variant));
      const warm = await runCaptured(wholeRepoArgs(r.path, variant));
      expect(cold).toBe(uncached);
      expect(warm).toBe(uncached);
    }
  });

  it("serves a repeated run from the cache instead of re-analyzing", async () => {
    const r = makeDupRepo();
    const first = JSON.parse(await runCaptured(wholeRepoArgs(r.path))) as {
      hotspots: unknown[];
    };
    expect(first.hotspots.length).toBeGreaterThan(0);
    expect(cacheEntries(r.path)).toHaveLength(1);

    emptyCachedGroups(r.path);
    const second = JSON.parse(await runCaptured(wholeRepoArgs(r.path))) as {
      hotspots: unknown[];
    };
    expect(second.hotspots).toEqual([]);

    const bypassed = JSON.parse(
      await runCaptured(wholeRepoArgs(r.path, { cache: false })),
    ) as { hotspots: unknown[] };
    expect(bypassed.hotspots.length).toBeGreaterThan(0);
  });

  it("a new commit or different options miss the cache", async () => {
    const r = makeDupRepo();
    await runCaptured(wholeRepoArgs(r.path));
    await runCaptured(wholeRepoArgs(r.path, { excludeGlobs: ["src/b.ts"] }));
    await runCaptured(
      wholeRepoArgs(r.path, {
        churn: { enabled: false, window: 200, ref: undefined },
      }),
    );
    await runCaptured(wholeRepoArgs(r.path, { limit: 1, format: "markdown" }));
    expect(cacheEntries(r.path)).toHaveLength(3);

    r.write("src/c.ts", "export const c = 1;\n");
    r.commit("more");
    await runCaptured(wholeRepoArgs(r.path));
    expect(cacheEntries(r.path)).toHaveLength(4);
  });

  it("dismissals apply on top of a cached result", async () => {
    const r = makeDupRepo();
    const first = JSON.parse(await runCaptured(wholeRepoArgs(r.path))) as {
      hotspots: { dismissalId: string }[];
    };
    const target = first.hotspots[0];
    if (target === undefined) throw new Error("fixture has no dup groups");
    const sink = { write: (c: string): number => c.length };
    const code = await runRoot(
      [
        "node",
        "ts-hotspots",
        "dismiss",
        target.dismissalId,
        "--reason",
        "fine",
        "--path",
        r.path,
      ],
      sink,
      sink,
    );
    expect(code).toBe(0);

    const second = JSON.parse(await runCaptured(wholeRepoArgs(r.path))) as {
      hotspots: { dismissalId: string }[];
      dismissed?: { filteredThisRun: number };
    };
    expect(
      second.hotspots.find((h) => h.dismissalId === target.dismissalId),
    ).toBeUndefined();
    expect(second.dismissed?.filteredThisRun).toBe(1);
    expect(cacheEntries(r.path)).toHaveLength(1);
  });

  it("worktrees of a repo share the cache", async () => {
    const r = makeDupRepo();
    const main = realpathSync(r.path);
    const wt = `${main}-wt`;
    r.git("worktree", "add", "-q", "--detach", wt);
    try {
      await runCaptured(wholeRepoArgs(main));
      emptyCachedGroups(main);
      const fromWt = JSON.parse(await runCaptured(wholeRepoArgs(wt))) as {
        hotspots: unknown[];
      };
      expect(fromWt.hotspots).toEqual([]);
    } finally {
      rmSync(wt, { recursive: true, force: true });
    }
  });
});

describe("cache entries", () => {
  function sampleReport(): CloneCandidateReport {
    return { status: "ok", groups: [] } as unknown as CloneCandidateReport;
  }

  it("treats corrupt or foreign entries as a miss", () => {
    const dir = join(xdgCache, "entries");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "broken.json.gz"), "{not gzip");
    writeFileSync(
      join(dir, "old.json.gz"),
      gzipSync(JSON.stringify({ format: 0, report: sampleReport() })),
    );
    expect(readCachedReport(dir, "broken")).toBeUndefined();
    expect(readCachedReport(dir, "old")).toBeUndefined();
    expect(readCachedReport(dir, "missing")).toBeUndefined();
  });

  it("keeps only the most recently used entries", () => {
    const dir = join(xdgCache, "entries");
    const total = DEFAULT_CACHE_LIMITS.maxEntries + 2;
    for (let i = 0; i < total; i++) {
      writeCachedReport(dir, `k${String(i)}`, sampleReport());
      const t = new Date(Date.UTC(2026, 0, 1, 0, 0, i));
      utimesSync(join(dir, `k${String(i)}.json.gz`), t, t);
    }
    expect(readCachedReport(dir, "k2")).toBeDefined();
    writeCachedReport(dir, "fresh", sampleReport());
    const names = readdirSync(dir).sort();
    expect(names).toHaveLength(DEFAULT_CACHE_LIMITS.maxEntries);
    expect(names).toContain("k2.json.gz");
    expect(names).toContain("fresh.json.gz");
    expect(names).not.toContain("k3.json.gz");
  });

  it("drops older entries once the total size passes the byte cap, keeping the newest", () => {
    const dir = join(xdgCache, "entries");
    writeCachedReport(dir, "a", sampleReport());
    expect(readdirSync(dir)).toEqual(["a.json.gz"]);
    const t = new Date(Date.UTC(2026, 0, 1));
    utimesSync(join(dir, "a.json.gz"), t, t);
    const limits = { maxEntries: 10, maxBytes: 1 };
    writeCachedReport(dir, "b", sampleReport(), limits);
    expect(readdirSync(dir)).toEqual(["b.json.gz"]);
  });
});
