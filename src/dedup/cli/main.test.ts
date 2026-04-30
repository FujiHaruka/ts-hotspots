import { afterEach, describe, expect, it } from "vitest";
import {
  createTempRepo,
  type TempRepo,
} from "../../../test/dedup/e2e/helpers/tempRepo.ts";
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
    expect(cap.stderr()).toContain("Usage:");
    expect(cap.stderr()).toContain("ts-hotspots dedup <revrange>");
    expect(cap.stdout()).toBe("");
  });

  it("returns 1 with a usage hint when the revrange is missing", async () => {
    const cap = captureIO();
    const code = await main([], cap.io);
    expect(code).toBe(1);
    expect(cap.stderr()).toContain("missing revrange");
  });

  it("writes Markdown to stdout by default and exits 0 on empty diff", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    const sha = r.commit("only");

    const cap = captureIO();
    const code = await main(["--repo", r.path, `${sha}..${sha}`], cap.io);
    expect(code).toBe(0);
    const out = cap.stdout();
    expect(out).toContain("# ts-hotspots dedup report");
    expect(out).toContain("groups: 0");
  });

  it("writes JSON to stdout when --format json is passed", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    const sha = r.commit("only");

    const cap = captureIO();
    const code = await main(
      ["--repo", r.path, "--format", "json", `${sha}..${sha}`],
      cap.io,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(cap.stdout()) as {
      pr: { baseSha: string; headSha: string };
      summary: { mode: string };
      groups: unknown[];
    };
    expect(parsed.pr).toEqual({ baseSha: sha, headSha: sha });
    expect(parsed.summary.mode).toBe("pr");
    expect(parsed.groups).toEqual([]);
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
      ["--repo", r.path, "--format", "json", `${baseSha}..${headSha}`],
      baseline.io,
    );
    expect(baselineCode).toBe(0);
    const baselineReport = JSON.parse(baseline.stdout()) as {
      groups: unknown[];
    };
    expect(baselineReport.groups.length).toBeGreaterThan(0);

    const filtered = captureIO();
    const filteredCode = await main(
      [
        "--repo",
        r.path,
        "--format",
        "json",
        "--exclude",
        "base/**",
        `${baseSha}..${headSha}`,
      ],
      filtered.io,
    );
    expect(filteredCode).toBe(0);
    const filteredReport = JSON.parse(filtered.stdout()) as {
      groups: unknown[];
    };
    expect(filteredReport.groups).toEqual([]);
  });

  it("returns 1 and writes an error to stderr when the repo path is invalid", async () => {
    const cap = captureIO();
    const code = await main(
      ["main..feature", "--repo", "/path/does/not/exist"],
      cap.io,
    );
    expect(code).toBe(1);
    expect(cap.stderr()).toMatch(/ts-hotspots dedup:/);
  });

  it("--phase-timings emits a JSON Lines perf log on stderr", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    const sha = r.commit("only");

    const cap = captureIO();
    const code = await main(
      ["--repo", r.path, "--phase-timings", `${sha}..${sha}`],
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
    await main(["--repo", r.path, `${sha}..${sha}`], cap.io);
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
      ["--repo", r.path, "--whole-repo", "--format", "json", "--limit", "all"],
      unlimited.io,
    );
    expect(codeAll).toBe(0);
    const allReport = JSON.parse(unlimited.stdout()) as {
      groups: unknown[];
    };
    const fullCount = allReport.groups.length;
    expect(fullCount).toBeGreaterThan(1);

    const capped = captureIO();
    const codeCap = await main(
      ["--repo", r.path, "--whole-repo", "--format", "json", "--limit", "1"],
      capped.io,
    );
    expect(codeCap).toBe(0);
    const cappedReport = JSON.parse(capped.stdout()) as {
      groups: unknown[];
    };
    expect(cappedReport.groups).toHaveLength(1);
    expect(capped.stderr()).toContain(
      `displayed=1 of ${String(fullCount)} groups`,
    );
  });

  it("default --limit caps the output to 50 candidates max", async () => {
    // Smoke check: with a tiny repo we can't easily exceed 50; verify
    // displayed= appears WITHOUT a "of N" suffix when the cap doesn't bind.
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    const sha = r.commit("only");

    const cap = captureIO();
    await main(["--repo", r.path, `${sha}..${sha}`], cap.io);
    expect(cap.stderr()).toMatch(/displayed=\d+(?! of)/);
  });

  it("runs whole-repo mode end-to-end and prints a summary line with repo=", async () => {
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
    const code = await main(
      ["--repo", r.path, "--whole-repo", "--format", "json"],
      cap.io,
    );
    expect(code).toBe(0);

    const parsed = JSON.parse(cap.stdout()) as {
      groups: {
        anchor?: { filePath: string };
        members: { fragment: { filePath: string } }[];
      }[];
    };
    expect(parsed.groups.length).toBeGreaterThan(0);

    const stderr = cap.stderr();
    expect(stderr).toMatch(/^ts-hotspots dedup: repo=\d+ files\/\d+ fragments/);
  });
});
