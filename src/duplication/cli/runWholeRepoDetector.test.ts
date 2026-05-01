import { afterEach, describe, expect, it } from "vitest";
import {
  createTempRepo,
  type TempRepo,
} from "../../../test/dedup/e2e/helpers/tempRepo.ts";
import { defaultConfig } from "../config/index.ts";
import { parseLocation } from "../util/location.ts";
import { nonNull } from "../util/nonNull.ts";
import { PhaseTimingsCollector, RecordingPerfLogger } from "./perfLog.ts";
import { runWholeRepoDetector } from "./runWholeRepoDetector.ts";

describe("runWholeRepoDetector", () => {
  const repos: TempRepo[] = [];

  afterEach(() => {
    while (repos.length > 0) {
      const r = repos.pop();
      r?.cleanup();
    }
  });

  function newRepo(): TempRepo {
    const r = createTempRepo("ts-dedup-whole-");
    repos.push(r);
    return r;
  }

  it("flags duplicate functions across two files at the same ref", async () => {
    const r = newRepo();
    r.write(
      "src/math.ts",
      `export function add(a: number, b: number): number {
  if (a < 0) {
    throw new Error("negative");
  }
  return a + b;
}
`,
    );
    r.write(
      "src/util.ts",
      `export function addCopy(a: number, b: number): number {
  if (a < 0) {
    throw new Error("negative");
  }
  return a + b;
}
`,
    );
    const sha = r.commit("only");

    const result = await runWholeRepoDetector({
      repoPath: r.path,
      ref: sha,
      config: defaultConfig,
    });

    expect(result.diff.baseSha).toBe(sha);
    expect(result.diff.headSha).toBe(sha);
    expect(result.groups.length).toBeGreaterThan(0);

    // Whole-repo clusters have no anchor; both files should appear as
    // members of the same group.
    const matched = result.groups.some((g) => {
      const paths = new Set(
        g.members
          .map((m) => parseLocation(m.fragment.location).filePath)
          .sort(),
      );
      return paths.has("src/math.ts") && paths.has("src/util.ts");
    });
    expect(matched).toBe(true);
  });

  it("emits each symmetric pair once (no (a,b)/(b,a) duplicates)", async () => {
    const r = newRepo();
    r.write(
      "src/math.ts",
      `export function add(a: number, b: number): number {
  if (a < 0) {
    throw new Error("negative");
  }
  return a + b;
}
`,
    );
    r.write(
      "src/util.ts",
      `export function addCopy(a: number, b: number): number {
  if (a < 0) {
    throw new Error("negative");
  }
  return a + b;
}
`,
    );
    const sha = r.commit("only");

    const result = await runWholeRepoDetector({
      repoPath: r.path,
      ref: sha,
      config: defaultConfig,
    });

    // Each cluster member appears at most once across the report — no
    // (a,b)/(b,a) duplication that would manifest as the same fragment
    // showing up twice in the same group.
    for (const g of result.groups) {
      const memberKeys = g.members.map((m) => {
        const { filePath, startLine } = parseLocation(m.fragment.location);
        return `${filePath}:${String(startLine)}`;
      });
      expect(new Set(memberKeys).size).toBe(memberKeys.length);
    }
  });

  it("returns no candidates when only one file is present (self-matches dropped)", async () => {
    const r = newRepo();
    r.write(
      "src/only.ts",
      `export function only(a: number, b: number): number {
  return a + b;
}
`,
    );
    const sha = r.commit("only");

    const result = await runWholeRepoDetector({
      repoPath: r.path,
      ref: sha,
      config: defaultConfig,
    });
    expect(result.groups).toEqual([]);
  });

  it("is deterministic across repeated runs", async () => {
    const r = newRepo();
    r.write(
      "src/a.ts",
      `export function add(a: number, b: number) {
  if (a < 0) throw new Error("negative");
  return a + b;
}
`,
    );
    r.write(
      "src/b.ts",
      `export function addCopy(a: number, b: number) {
  if (a < 0) throw new Error("negative");
  return a + b;
}
`,
    );
    const sha = r.commit("only");

    const x = await runWholeRepoDetector({
      repoPath: r.path,
      ref: sha,
      config: defaultConfig,
    });
    const y = await runWholeRepoDetector({
      repoPath: r.path,
      ref: sha,
      config: defaultConfig,
    });
    expect(JSON.stringify(x)).toBe(JSON.stringify(y));
  });

  it("attaches a whole-repo analysis summary with no changed scope", async () => {
    const r = newRepo();
    r.write(
      "src/a.ts",
      `export function add(a: number, b: number) {
  return a + b;
}
`,
    );
    r.write(
      "src/b.ts",
      `export function addCopy(a: number, b: number) {
  return a + b;
}
`,
    );
    const sha = r.commit("only");

    const result = await runWholeRepoDetector({
      repoPath: r.path,
      ref: sha,
      config: defaultConfig,
    });
    const summary = result.summary;
    expect(summary.mode).toBe("whole-repo");
    expect(summary.scope.changed).toBeUndefined();
    expect(summary.scope.base.files).toBe(2);
    expect(summary.scope.base.lines).toBeGreaterThanOrEqual(6);
    expect(summary.scope.base.fragments).toBeGreaterThanOrEqual(2);
    expect(summary.scope.base.excludedFiles).toBe(0);
    const k = summary.scope.base.fragmentsByKind;
    expect(k.function + k.block + k.window).toBe(summary.scope.base.fragments);
    expect(summary.pipeline.candidatePairs).toBeGreaterThanOrEqual(0);
    expect(summary.pipeline.reportedPairs).toBeGreaterThanOrEqual(0);
  });

  it("emits phase.end events for every pipeline phase when a perfLog is provided", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    const sha = r.commit("only");

    const perfLog = new RecordingPerfLogger();
    await runWholeRepoDetector({
      repoPath: r.path,
      ref: sha,
      config: defaultConfig,
      perfLog,
    });

    const phases = new Set(
      perfLog.events
        .filter((e) => e.name === "phase.end")
        .map((e) => e.payload.phase),
    );
    for (const phase of [
      "diff",
      "listBase",
      "baseIndex",
      "headSearch",
      "report",
    ]) {
      expect(phases.has(phase)).toBe(true);
    }
  });

  it("PhaseTimingsCollector captures wall time for every phase", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    const sha = r.commit("only");

    const collector = new PhaseTimingsCollector();
    await runWholeRepoDetector({
      repoPath: r.path,
      ref: sha,
      config: defaultConfig,
      perfLog: collector,
    });
    for (const phase of [
      "diff",
      "listBase",
      "baseIndex",
      "headSearch",
      "report",
    ] as const) {
      expect(collector.timings[phase]).toBeGreaterThanOrEqual(0);
      expect(Number.isFinite(collector.timings[phase])).toBe(true);
    }
  });

  it("emits lsh.summary per enabled axis and an lsh.union event", async () => {
    const r = newRepo();
    r.write(
      "src/math.ts",
      `export function add(a: number, b: number): number {
  if (a < 0) throw new Error("negative");
  return a + b;
}
`,
    );
    r.write(
      "src/util.ts",
      `export function addCopy(a: number, b: number): number {
  if (a < 0) throw new Error("negative");
  return a + b;
}
`,
    );
    const sha = r.commit("only");

    const perfLog = new RecordingPerfLogger();
    await runWholeRepoDetector({
      repoPath: r.path,
      ref: sha,
      config: defaultConfig,
      perfLog,
    });

    const summaries = perfLog.events.filter((e) => e.name === "lsh.summary");
    const axes = summaries.map((e) => e.payload.axis as string).sort();
    expect(axes).toEqual(["call", "statement", "token"]);

    const union = perfLog.events.find((e) => e.name === "lsh.union");
    expect(union).toBeDefined();
    if (union === undefined) throw new Error("unreachable");
    const ap = union.payload.axisPairs as Record<string, number>;
    expect(typeof ap.token).toBe("number");
    expect(typeof ap.call).toBe("number");
    expect(typeof ap.statement).toBe("number");
    expect(typeof union.payload.unionPairs).toBe("number");
    expect(typeof union.payload.overlapPairs).toBe("number");
    // overlap = sum(axisPairs) - unionPairs, must be >= 0.
    expect(union.payload.overlapPairs as number).toBeGreaterThanOrEqual(0);
  });

  it("axis with enabled=false is skipped (no lsh.summary for it)", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    r.write("src/b.ts", "export const y = 2;\n");
    const sha = r.commit("only");

    const cfg = {
      ...defaultConfig,
      search: {
        ...defaultConfig.search,
        lsh: {
          ...defaultConfig.search.lsh,
          call: { ...defaultConfig.search.lsh.call, enabled: false },
          statement: { ...defaultConfig.search.lsh.statement, enabled: false },
        },
      },
    };
    const perfLog = new RecordingPerfLogger();
    await runWholeRepoDetector({
      repoPath: r.path,
      ref: sha,
      config: cfg,
      perfLog,
    });

    const axes = perfLog.events
      .filter((e) => e.name === "lsh.summary")
      .map((e) => e.payload.axis as string);
    expect(axes).toEqual(["token"]);
    const union = perfLog.events.find((e) => e.name === "lsh.union");
    expect(union).toBeDefined();
    if (union === undefined) throw new Error("unreachable");
    expect(
      Object.keys(union.payload.axisPairs as Record<string, number>),
    ).toEqual(["token"]);
  });

  it("dedupes pairs surfaced by multiple LSH axes (no double-scoring)", async () => {
    // Two near-identical functions: their token AND call sets both
    // overlap heavily, so both axes should emit the same pair. The
    // runner-level seenPairs must collapse this to a single scoring call.
    const r = newRepo();
    r.write(
      "src/a.ts",
      `export function processOrder(order: { id: string; total: number }) {
  if (order.total < 0) throw new Error("invalid");
  console.log("processing", order.id);
  return order.total * 1.1;
}
`,
    );
    r.write(
      "src/b.ts",
      `export function processOrderCopy(order: { id: string; total: number }) {
  if (order.total < 0) throw new Error("invalid");
  console.log("processing", order.id);
  return order.total * 1.1;
}
`,
    );
    const sha = r.commit("only");

    const perfLog = new RecordingPerfLogger();
    const result = await runWholeRepoDetector({
      repoPath: r.path,
      ref: sha,
      config: defaultConfig,
      perfLog,
    });

    // Cluster members appear once per group (no axis-double scoring would
    // surface as the same member listed twice).
    for (const g of result.groups) {
      const memberKeys = g.members.map((m) => {
        const { filePath, startLine } = parseLocation(m.fragment.location);
        return `${filePath}:${String(startLine)}`;
      });
      expect(new Set(memberKeys).size).toBe(memberKeys.length);
    }

    // Per-axis lsh.summary both emit the pair, but lsh.union reports
    // overlapPairs >= 1 to reflect that the same pair was found twice.
    const union = perfLog.events.find((e) => e.name === "lsh.union");
    expect(union).toBeDefined();
    if (union === undefined) throw new Error("unreachable");
    const ap = union.payload.axisPairs as Record<string, number>;
    const sumAxes = (ap.token ?? 0) + (ap.call ?? 0);
    expect(sumAxes).toBeGreaterThanOrEqual(union.payload.unionPairs as number);
  });

  it("skips same-file overlapping pairs in the LSH path", async () => {
    // A single file with many statements produces several sliding-window
    // fragments whose line ranges intersect (e.g. [1..10] and [4..13]).
    // Their feature sets share the overlapping region, so LSH would
    // otherwise surface them as candidate pairs. Verify the LSH path
    // drops same-file overlapping pairs at search time, just like the
    // inverted-index path.
    const r = newRepo();
    const stmts = Array.from(
      { length: 30 },
      (_, i) => `  const v${String(i)} = ${String(i)};`,
    ).join("\n");
    r.write("src/long.ts", `export function f() {\n${stmts}\n  return 0;\n}\n`);
    const sha = r.commit("only");

    const result = await runWholeRepoDetector({
      repoPath: r.path,
      ref: sha,
      config: defaultConfig,
    });

    // Every (memberᵢ, memberⱼ) pair within a single-file cluster must
    // either point at different files or have non-overlapping line ranges.
    for (const g of result.groups) {
      for (let i = 0; i < g.members.length; i++) {
        for (let j = i + 1; j < g.members.length; j++) {
          const a = parseLocation(nonNull(g.members[i]).fragment.location);
          const b = parseLocation(nonNull(g.members[j]).fragment.location);
          if (a.filePath !== b.filePath) continue;
          const overlap = a.endLine >= b.startLine && b.endLine >= a.startLine;
          expect(overlap).toBe(false);
        }
      }
    }
  });

  it("emits pairs.dedup with the canonical-key dedup rate", async () => {
    const r = newRepo();
    r.write(
      "src/math.ts",
      `export function add(a: number, b: number): number {
  if (a < 0) {
    throw new Error("negative");
  }
  return a + b;
}
`,
    );
    r.write(
      "src/util.ts",
      `export function addCopy(a: number, b: number): number {
  if (a < 0) {
    throw new Error("negative");
  }
  return a + b;
}
`,
    );
    const sha = r.commit("only");

    const perfLog = new RecordingPerfLogger();
    await runWholeRepoDetector({
      repoPath: r.path,
      ref: sha,
      config: defaultConfig,
      perfLog,
    });
    const event = perfLog.events.find((e) => e.name === "pairs.dedup");
    expect(event).toBeDefined();
    if (event === undefined) throw new Error("unreachable");
    expect(typeof event.payload.rawCandidates).toBe("number");
    expect(typeof event.payload.uniqueAfterCanonical).toBe("number");
    expect(typeof event.payload.dedupRate).toBe("number");
  });
});
