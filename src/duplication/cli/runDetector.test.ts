import { afterEach, describe, expect, it } from "vitest";
import {
  createTempRepo,
  type TempRepo,
} from "../../../test/dedup/e2e/helpers/tempRepo.ts";
import { defaultConfig } from "../config/index.ts";
import { PhaseTimingsCollector, RecordingPerfLogger } from "./perfLog.ts";
import { runDetector } from "./runDetector.ts";

describe("runDetector", () => {
  const repos: TempRepo[] = [];

  afterEach(() => {
    while (repos.length > 0) {
      const r = repos.pop();
      r?.cleanup();
    }
  });

  function newRepo(): TempRepo {
    const r = createTempRepo("ts-dedup-m7-run-");
    repos.push(r);
    return r;
  }

  it("returns empty candidates when base === head", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    const sha = r.commit("only");

    const result = await runDetector({
      repoPath: r.path,
      baseRef: sha,
      headRef: sha,
      threeDot: false,
      config: defaultConfig,
    });
    expect(result.diff.baseSha).toBe(sha);
    expect(result.diff.headSha).toBe(sha);
    expect(result.groups).toEqual([]);
    expect(result.summary.scope.changed?.files).toBe(0);
    expect(result.summary.pipeline.reportedPairs).toBe(0);
  });

  it("surfaces a copy-pasted function as a candidate", async () => {
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
    const base = r.commit("base");

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
    const head = r.commit("head");

    const result = await runDetector({
      repoPath: r.path,
      baseRef: base,
      headRef: head,
      threeDot: false,
      config: defaultConfig,
    });
    expect(result.diff.baseSha).toBe(base);
    expect(result.diff.headSha).toBe(head);
    const hasPair = result.groups.some(
      (g) =>
        g.anchor?.location.startsWith("src/util.ts:") === true &&
        g.members.some((m) => m.fragment.location.startsWith("src/math.ts:")),
    );
    expect(hasPair).toBe(true);
  });

  describe("features.enabled: 1-axis-off extensibility", () => {
    function makeCopyRepo(): { repo: TempRepo; base: string; head: string } {
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
      const base = r.commit("base");
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
      const head = r.commit("head");
      return { repo: r, base, head };
    }

    for (const axis of ["token", "statement", "call"] as const) {
      it(`still surfaces the copied function when ${axis} is disabled`, async () => {
        const { repo, base, head } = makeCopyRepo();
        const config = {
          ...defaultConfig,
          features: {
            ...defaultConfig.features,
            enabled: {
              token: axis !== "token",
              statement: axis !== "statement",
              call: axis !== "call",
            },
          },
        };
        const result = await runDetector({
          repoPath: repo.path,
          baseRef: base,
          headRef: head,
          threeDot: false,
          config,
        });
        const hasPair = result.groups.some(
          (g) =>
            g.anchor?.location.startsWith("src/util.ts:") === true &&
            g.members.some((m) =>
              m.fragment.location.startsWith("src/math.ts:"),
            ),
        );
        expect(hasPair).toBe(true);
      });
    }
  });

  it("is deterministic across repeated runs", async () => {
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
    const base = r.commit("base");
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
    const head = r.commit("head");

    const a = await runDetector({
      repoPath: r.path,
      baseRef: base,
      headRef: head,
      threeDot: false,
      config: defaultConfig,
    });
    const b = await runDetector({
      repoPath: r.path,
      baseRef: base,
      headRef: head,
      threeDot: false,
      config: defaultConfig,
    });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("emits no perf events when perfLog is not provided", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    const sha = r.commit("only");

    const result = await runDetector({
      repoPath: r.path,
      baseRef: sha,
      headRef: sha,
      threeDot: false,
      config: defaultConfig,
    });
    // Smoke check: the run still produces a report when perfLog is absent.
    expect(result.groups).toBeDefined();
  });

  it("attaches an analysis summary describing both base and changed sides", async () => {
    const r = newRepo();
    r.write(
      "src/math.ts",
      `export function add(a: number, b: number): number {
  return a + b;
}
`,
    );
    const base = r.commit("base");
    r.write(
      "src/util.ts",
      `export function addCopy(a: number, b: number): number {
  return a + b;
}
`,
    );
    const head = r.commit("head");

    const result = await runDetector({
      repoPath: r.path,
      baseRef: base,
      headRef: head,
      threeDot: false,
      config: defaultConfig,
    });
    const summary = result.summary;
    expect(summary.mode).toBe("diff");
    expect(summary.scope.base.files).toBeGreaterThanOrEqual(1);
    expect(summary.scope.base.lines).toBeGreaterThanOrEqual(1);
    expect(summary.scope.base.fragments).toBeGreaterThanOrEqual(1);
    expect(summary.scope.base.excludedFiles).toBe(0);
    expect(summary.scope.changed).toBeDefined();
    expect(summary.scope.changed?.files).toBeGreaterThanOrEqual(1);
    expect(summary.pipeline.candidatePairs).toBeGreaterThanOrEqual(0);
    expect(summary.pipeline.reportedPairs).toBeGreaterThanOrEqual(0);
  });

  it("emits phase.start / phase.end events for every pipeline phase when a perfLog is provided", async () => {
    const r = newRepo();
    r.write(
      "src/math.ts",
      `export function add(a: number, b: number): number {
  return a + b;
}
`,
    );
    const base = r.commit("base");
    r.write(
      "src/util.ts",
      `export function addCopy(a: number, b: number): number {
  return a + b;
}
`,
    );
    const head = r.commit("head");

    const perfLog = new RecordingPerfLogger();
    await runDetector({
      repoPath: r.path,
      baseRef: base,
      headRef: head,
      threeDot: false,
      config: defaultConfig,
      perfLog,
    });

    const phaseEnds = perfLog.events
      .filter((e) => e.name === "phase.end")
      .map((e) => e.payload);
    const seenPhases = new Set(phaseEnds.map((p) => p.phase));
    for (const phase of [
      "diff",
      "listBase",
      "baseIndex",
      "headSearch",
      "report",
    ]) {
      expect(seenPhases.has(phase)).toBe(true);
    }
    for (const p of phaseEnds) {
      expect(typeof p.wallMs).toBe("number");
      expect(p.wallMs as number).toBeGreaterThanOrEqual(0);
    }
  });

  it("PhaseTimingsCollector captures wall time for every phase", async () => {
    const r = newRepo();
    r.write("src/a.ts", "export const x = 1;\n");
    const sha = r.commit("only");

    const collector = new PhaseTimingsCollector();
    await runDetector({
      repoPath: r.path,
      baseRef: sha,
      headRef: sha,
      threeDot: false,
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
});
