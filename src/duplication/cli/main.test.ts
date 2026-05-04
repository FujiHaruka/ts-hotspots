import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  createTempRepo,
  type TempRepo,
} from "../../../test/dedup/e2e/helpers/tempRepo.ts";
import { run as runRoot } from "../../cli.ts";
import { registryPath } from "../../dismissal/store.ts";
import { type MainIO, main } from "./main.ts";

interface CapturedIO {
  io: MainIO;
  stdout: () => string;
  stderr: () => string;
}

function captureIO(cwd = process.cwd()): CapturedIO {
  const stdoutChunks: string[] = [];
  const stderrChunks: string[] = [];
  const io: MainIO = {
    stdout: {
      write: (chunk: string | Uint8Array): boolean => {
        stdoutChunks.push(
          typeof chunk === "string"
            ? chunk
            : Buffer.from(chunk).toString("utf-8"),
        );
        return true;
      },
    } as NodeJS.WritableStream,
    stderr: {
      write: (chunk: string | Uint8Array): boolean => {
        stderrChunks.push(
          typeof chunk === "string"
            ? chunk
            : Buffer.from(chunk).toString("utf-8"),
        );
        return true;
      },
    } as NodeJS.WritableStream,
    cwd: () => cwd,
  };
  return {
    io,
    stdout: () => stdoutChunks.join(""),
    stderr: () => stderrChunks.join(""),
  };
}

describe("main", () => {
  const repos: TempRepo[] = [];
  afterEach(() => {
    while (repos.length > 0) {
      const r = repos.pop();
      r?.cleanup();
    }
  });

  function newRepo(): TempRepo {
    const r = createTempRepo("ts-dedup-m7-main-");
    repos.push(r);
    return r;
  }

  it("prints usage on --help and returns 0", async () => {
    const cap = captureIO();
    const code = await main(["--help"], cap.io);
    expect(code).toBe(0);
    expect(cap.stdout()).toContain("Usage:");
    expect(cap.stdout()).toContain("ts-hotspots duplication");
    expect(cap.stdout()).toContain("--diff <revrange>");
    expect(cap.stderr()).toBe("");
  });

  it("writes Markdown to stdout by default and exits 0 on empty diff", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    const sha = r.commit("only");

    const cap = captureIO();
    const code = await main(["--diff", `${sha}..${sha}`, r.path], cap.io);
    expect(code).toBe(0);
    const out = cap.stdout();
    expect(out).toContain("# ts-hotspots duplication report");
    const fenceMatch = /```yaml\n([\s\S]*?)\n```/.exec(out);
    expect(fenceMatch).not.toBeNull();
    const parsed = parseYaml(fenceMatch?.[1] ?? "") as {
      status?: string;
      hotspots: unknown[];
    };
    // Success envelope omits `status`; only the error path keeps it.
    expect(parsed.status).toBeUndefined();
    expect(parsed.hotspots).toEqual([]);
  });

  it("streams the Markdown head before running the detector", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    const sha = r.commit("only");

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];
    const io: MainIO = {
      stdout: {
        write: (chunk: string): boolean => {
          stdoutChunks.push(chunk);
          return true;
        },
      } as NodeJS.WritableStream,
      stderr: {
        write: (chunk: string): boolean => {
          stderrChunks.push(chunk);
          return true;
        },
      } as NodeJS.WritableStream,
      cwd: () => process.cwd(),
    };
    const code = await main(["--diff", `${sha}..${sha}`, r.path], io);
    expect(code).toBe(0);
    expect(stdoutChunks.length).toBeGreaterThanOrEqual(2);
    const head = stdoutChunks[0] ?? "";
    expect(head.startsWith("# ts-hotspots duplication report")).toBe(true);
    expect(head.endsWith("```yaml\n")).toBe(true);
    expect(head).not.toContain("status:");
    const full = stdoutChunks.join("");
    expect(full.endsWith("```\n")).toBe(true);
  });

  it("writes JSON to stdout when --format json is passed", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    const sha = r.commit("only");

    const cap = captureIO();
    const code = await main(
      ["--diff", `${sha}..${sha}`, r.path, "--format", "json"],
      cap.io,
    );
    expect(code).toBe(0);
    // Diff mode keeps the `diff` block; the `summary` block is
    // `--verbose`-only and stays out of the slim default.
    const parsed = JSON.parse(cap.stdout()) as {
      diff: {
        baseSha: string;
        headSha: string;
        threeDot: boolean;
        changedFiles: number;
      };
      summary?: unknown;
      hotspots: unknown[];
    };
    expect(parsed.diff).toEqual({
      baseSha: sha,
      headSha: sha,
      threeDot: false,
      changedFiles: 0,
    });
    expect(parsed.summary).toBeUndefined();
    expect(parsed.hotspots).toEqual([]);
  });

  it("--exclude drops user-listed paths from the candidate set", async () => {
    const r = newRepo();
    // Same function in two files. Without --exclude both base/legacy.ts and
    // the head src/util.ts would be visible and produce a clone candidate.
    // The body is padded to clear the default minLines gate (5 lines).
    r.write(
      "base/legacy.ts",
      `export function add(a: number, b: number) {
  if (a < 0) throw new Error("negative a");
  if (b < 0) throw new Error("negative b");
  const total = a + b;
  return total;
}
`,
    );
    const baseSha = r.commit("base");
    r.write(
      "src/util.ts",
      `export function addCopy(a: number, b: number) {
  if (a < 0) throw new Error("negative a");
  if (b < 0) throw new Error("negative b");
  const total = a + b;
  return total;
}
`,
    );
    const headSha = r.commit("head");

    const baseline = captureIO();
    const baselineCode = await main(
      ["--diff", `${baseSha}..${headSha}`, r.path, "--format", "json"],
      baseline.io,
    );
    expect(baselineCode).toBe(0);
    const baselineReport = JSON.parse(baseline.stdout()) as {
      hotspots: unknown[];
    };
    expect(baselineReport.hotspots.length).toBeGreaterThan(0);

    const filtered = captureIO();
    const filteredCode = await main(
      [
        "--diff",
        `${baseSha}..${headSha}`,
        r.path,
        "--format",
        "json",
        "--exclude",
        "base/**",
      ],
      filtered.io,
    );
    expect(filteredCode).toBe(0);
    const filteredReport = JSON.parse(filtered.stdout()) as {
      hotspots: unknown[];
    };
    expect(filteredReport.hotspots).toEqual([]);
  });

  it("returns 1 and writes an error to stderr when the path is not in a git repo", async () => {
    const cap = captureIO();
    const code = await main(
      ["--diff", "main..feature", "/path/does/not/exist"],
      cap.io,
    );
    expect(code).toBe(1);
    expect(cap.stderr()).toMatch(/ts-hotspots duplication:/);
    expect(cap.stderr()).toContain("not in a git repository");
  });

  it("--phase-timings emits a JSON Lines perf log on stderr", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    const sha = r.commit("only");

    const cap = captureIO();
    const code = await main(
      ["--diff", `${sha}..${sha}`, r.path, "--phase-timings"],
      cap.io,
    );
    expect(code).toBe(0);
    const stderr = cap.stderr();

    const events: { event: string; phase?: string }[] = [];
    for (const line of stderr.split("\n")) {
      if (!line.startsWith("{")) continue;
      const parsed = JSON.parse(line) as {
        ts: number;
        event: string;
        phase?: string;
      };
      expect(typeof parsed.ts).toBe("number");
      expect(typeof parsed.event).toBe("string");
      events.push(parsed);
    }
    const seenPhaseEnds = new Set(
      events.filter((e) => e.event === "phase.end").map((e) => e.phase),
    );
    for (const phase of [
      "diff",
      "listBase",
      "baseIndex",
      "headSearch",
      "report",
    ]) {
      expect(seenPhaseEnds.has(phase)).toBe(true);
    }
  });

  it("does not emit perf log lines without --phase-timings", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    const sha = r.commit("only");

    const cap = captureIO();
    await main(["--diff", `${sha}..${sha}`, r.path], cap.io);
    const stderr = cap.stderr();
    for (const line of stderr.split("\n")) {
      expect(line.startsWith("{")).toBe(false);
    }
  });

  it("--limit truncates the candidates list to the top N", async () => {
    // Build a repo with TWO distinct duplicate families so the whole-repo
    // cluster path produces multiple groups. The first family copies a
    // numeric helper across three files; the second family copies a
    // string-formatting helper. Each family forms its own dense cluster
    // so the report has at least two groups. Bodies are padded to clear
    // the default minLines gate (5 lines).
    const r = newRepo();
    for (let i = 0; i < 3; i++) {
      r.write(
        `src/num${String(i)}.ts`,
        `export function helper${String(i)}(a: number, b: number) {
  if (a < 0) throw new Error("negative a");
  if (b < 0) throw new Error("negative b");
  const total = a + b;
  return total;
}
`,
      );
    }
    for (let i = 0; i < 3; i++) {
      r.write(
        `src/str${String(i)}.ts`,
        `export function format${String(i)}(items: string[]) {
  const buffer: string[] = [];
  for (const item of items) {
    buffer.push(item.toUpperCase());
  }
  return buffer.join(",");
}
`,
      );
    }
    r.commit("base");

    const unlimited = captureIO();
    const codeAll = await main(
      [r.path, "--format", "json", "--limit", "all"],
      unlimited.io,
    );
    expect(codeAll).toBe(0);
    const allReport = JSON.parse(unlimited.stdout()) as {
      hotspots: unknown[];
    };
    const fullCount = allReport.hotspots.length;
    expect(fullCount).toBeGreaterThan(1);

    const capped = captureIO();
    const codeCap = await main(
      [r.path, "--format", "json", "--limit", "1"],
      capped.io,
    );
    expect(codeCap).toBe(0);
    const cappedReport = JSON.parse(capped.stdout()) as {
      hotspots: unknown[];
    };
    expect(cappedReport.hotspots).toHaveLength(1);
    // fullCount is observable from the unlimited run's hotspots[].length.
    expect(fullCount).toBeGreaterThan(1);
  });

  it("default --limit caps the output to 50 candidates max", async () => {
    // Smoke check: a tiny repo cannot exceed 50 groups, so the run must
    // succeed with at least zero hotspots and no error output.
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    const sha = r.commit("only");

    const cap = captureIO();
    const code = await main(["--diff", `${sha}..${sha}`, r.path], cap.io);
    expect(code).toBe(0);
    expect(cap.stderr()).toBe("");
  });

  describe("dismissal round-trip", () => {
    let tmpXdg: string;
    let savedXdg: string | undefined;

    beforeEach(() => {
      tmpXdg = mkdtempSync(join(tmpdir(), "ts-hotspots-xdg-"));
      savedXdg = process.env.XDG_CONFIG_HOME;
      process.env.XDG_CONFIG_HOME = tmpXdg;
    });

    afterEach(() => {
      rmSync(tmpXdg, { recursive: true, force: true });
      if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = savedXdg;
    });

    function makeDupRepo(): TempRepo {
      const r = newRepo();
      // Two near-identical functions in distinct files. Bodies pad past the
      // default minLines gate (5 lines) so they reach the report.
      r.write(
        "src/a.ts",
        `export function add(a: number, b: number) {
  if (a < 0) throw new Error("negative a");
  if (b < 0) throw new Error("negative b");
  const total = a + b;
  return total;
}
`,
      );
      r.write(
        "src/b.ts",
        `export function addCopy(a: number, b: number) {
  if (a < 0) throw new Error("negative a");
  if (b < 0) throw new Error("negative b");
  const total = a + b;
  return total;
}
`,
      );
      r.commit("only");
      return r;
    }

    interface ParsedReport {
      hotspots: { dismissalId: string }[];
      dismissed?: {
        active: number;
        filteredThisRun: number;
        prunedThisRun: number;
      };
    }

    async function runDup(repoPath: string): Promise<ParsedReport> {
      const cap = captureIO();
      const code = await main([repoPath, "--format", "json"], cap.io);
      expect(code).toBe(0);
      return JSON.parse(cap.stdout()) as ParsedReport;
    }

    it("every reported group exposes a dup:<hex> dismissalId", async () => {
      const r = makeDupRepo();
      const report = await runDup(r.path);
      expect(report.hotspots.length).toBeGreaterThan(0);
      for (const g of report.hotspots) {
        expect(g.dismissalId).toMatch(/^dup:[0-9a-f]{16}$/);
      }
      expect(report.dismissed).toBeUndefined();
    });

    it("dismiss → re-run filters the group and reports the summary", async () => {
      const r = makeDupRepo();
      const first = await runDup(r.path);
      const target = first.hotspots[0];
      if (target === undefined) throw new Error("fixture has no dup groups");

      class StringSink {
        chunks: string[] = [];
        write(c: string): void {
          this.chunks.push(c);
        }
        get text(): string {
          return this.chunks.join("");
        }
      }

      const out = new StringSink();
      const err = new StringSink();
      const dismissCode = await runRoot(
        [
          "node",
          "ts-hotspots",
          "dismiss",
          target.dismissalId,
          "--reason",
          "test pattern",
          "--path",
          r.path,
        ],
        out,
        err,
      );
      expect(dismissCode).toBe(0);

      // Registry sits at the git-root key (dup uses findGitRoot, not tsconfig).
      const regPath = registryPath(r.path);
      const saved = JSON.parse(readFileSync(regPath, "utf-8")) as {
        entries: { id: string; feature: string; reason: string }[];
      };
      expect(saved.entries).toHaveLength(1);
      expect(saved.entries[0]?.id).toBe(target.dismissalId);
      expect(saved.entries[0]?.feature).toBe("dup");

      const second = await runDup(r.path);
      const stillThere = second.hotspots.find(
        (g) => g.dismissalId === target.dismissalId,
      );
      expect(stillThere).toBeUndefined();
      expect(second.dismissed).toEqual({
        active: 1,
        filteredThisRun: 1,
        prunedThisRun: 0,
      });

      const undismissCode = await runRoot(
        [
          "node",
          "ts-hotspots",
          "undismiss",
          target.dismissalId,
          "--path",
          r.path,
        ],
        out,
        err,
      );
      expect(undismissCode).toBe(0);

      const third = await runDup(r.path);
      expect(
        third.hotspots.find((g) => g.dismissalId === target.dismissalId),
      ).toBeDefined();
      expect(third.dismissed).toBeUndefined();
    });

    it("stale dup entries get pruned automatically when membership shifts", async () => {
      const r = makeDupRepo();
      const first = await runDup(r.path);
      const target = first.hotspots[0];
      if (target === undefined) throw new Error("fixture has no dup groups");

      class StringSink {
        chunks: string[] = [];
        write(c: string): void {
          this.chunks.push(c);
        }
        get text(): string {
          return this.chunks.join("");
        }
      }
      const out = new StringSink();
      const err = new StringSink();
      const dismissCode = await runRoot(
        [
          "node",
          "ts-hotspots",
          "dismiss",
          target.dismissalId,
          "--reason",
          "stale-on-purpose",
          "--path",
          r.path,
        ],
        out,
        err,
      );
      expect(dismissCode).toBe(0);

      // Mutate one of the duplicates so the group's normalized member-hash
      // set changes — the dismissal id from the previous run no longer
      // matches anything reportable, and applyDismissalRegistry should
      // prune it on the next run.
      r.write(
        "src/b.ts",
        `export function addCopy(a: number, b: number) {
  if (a < 0) throw new Error("negative a");
  if (b < 0) throw new Error("negative b");
  if (a === b) throw new Error("equal inputs");
  const total = a + b;
  return total + 1;
}
`,
      );
      r.commit("mutate");

      const cap = captureIO();
      const code = await main([r.path, "--format", "json"], cap.io);
      expect(code).toBe(0);
      const second = JSON.parse(cap.stdout()) as ParsedReport;
      expect(second.dismissed).toEqual({
        active: 0,
        filteredThisRun: 0,
        prunedThisRun: 1,
      });
      expect(cap.stderr()).toBe("");
      const regPath = registryPath(r.path);
      const after = JSON.parse(readFileSync(regPath, "utf-8")) as {
        entries: unknown[];
      };
      expect(after.entries).toEqual([]);
    });
  });

  it("runs whole-repo mode end-to-end and emits a non-empty hotspots[] envelope", async () => {
    const r = newRepo();
    // Bodies are padded to clear the default minLines gate (5 lines).
    r.write(
      "src/a.ts",
      `export function add(a: number, b: number) {
  if (a < 0) throw new Error("negative a");
  if (b < 0) throw new Error("negative b");
  const total = a + b;
  return total;
}
`,
    );
    r.write(
      "src/b.ts",
      `export function addCopy(a: number, b: number) {
  if (a < 0) throw new Error("negative a");
  if (b < 0) throw new Error("negative b");
  const total = a + b;
  return total;
}
`,
    );
    r.commit("only");

    const cap = captureIO();
    const code = await main([r.path, "--format", "json"], cap.io);
    expect(code).toBe(0);

    const parsed = JSON.parse(cap.stdout()) as {
      hotspots: {
        anchor?: { ref: { location: string } };
        members: { ref: { location: string } }[];
      }[];
    };
    expect(parsed.hotspots.length).toBeGreaterThan(0);
    expect(cap.stderr()).toBe("");
  });
});
