import { afterEach, describe, expect, it } from "vitest";
import { main as archMain } from "../../src/architecture/cli/main.ts";
import { createTempRepo, type TempRepo } from "../dedup/e2e/helpers/tempRepo.ts";

describe("architecture e2e", () => {
  const repos: TempRepo[] = [];
  afterEach(() => {
    while (repos.length > 0) {
      const r = repos.pop();
      r?.cleanup();
    }
  });

  function makeIO() {
    let stdout = "";
    let stderr = "";
    return {
      stdout: {
        write: (s: string) => {
          stdout += s;
        },
      },
      stderr: {
        write: (s: string) => {
          stderr += s;
        },
      },
      cwd: () => process.cwd(),
      get out() {
        return stdout;
      },
      get err() {
        return stderr;
      },
    };
  }

  function makeHubRepo(): TempRepo {
    const r = createTempRepo("ts-arch-e2e-");
    repos.push(r);
    // Build a star: 8 callers all importing the same hub. This gives the
    // hub a fan-in of 8 — high outlier in a graph of 9 nodes — so the
    // small-N gate (N=9 < 100) passes via the z-score floor.
    r.write(
      "src/hub.ts",
      `export function hub(): number {\n  return 42;\n}\n`,
    );
    for (let i = 0; i < 8; i++) {
      r.write(
        `src/caller${String(i)}.ts`,
        `import { hub } from './hub';\nexport const v${String(i)} = () => hub();\n`,
      );
    }
    r.commit("hub-and-callers");
    return r;
  }

  it("emits a JSON report flagging the hub", async () => {
    const r = makeHubRepo();
    const io = makeIO();
    const code = await archMain(["--format", "json", r.path], io);
    expect(code).toBe(0);

    const parsed = JSON.parse(io.out);
    expect(parsed.tool.name).toBe("ts-hotspots");
    expect(Array.isArray(parsed.hotspots)).toBe(true);
    const hub = parsed.hotspots.find(
      (h: { ref: { location: string } }) =>
        h.ref.location.startsWith("src/hub.ts:"),
    );
    expect(hub).toBeDefined();
    expect(hub.ref.name).toBe("hub");
    expect(hub.dismissalId).toMatch(/^arch:[0-9a-f]{16}$/);
  });

  it("emits a Markdown report with the agent prelude + JSON fence", async () => {
    const r = makeHubRepo();
    const io = makeIO();
    const code = await archMain([r.path], io);
    expect(code).toBe(0);
    expect(io.out.startsWith("# ts-hotspots architecture report")).toBe(true);
    expect(io.out).toContain("```json");
    expect(io.out.trimEnd().endsWith("```")).toBe(true);
  });

  it("--limit caps the hotspots list", async () => {
    const r = makeHubRepo();
    const io = makeIO();
    const code = await archMain(
      ["--format", "json", "--limit", "1", r.path],
      io,
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(io.out);
    expect(parsed.hotspots.length).toBeLessThanOrEqual(1);
  });

  it("produces deterministic output across runs", async () => {
    const r = makeHubRepo();
    const a = makeIO();
    const b = makeIO();
    const codeA = await archMain(["--format", "json", r.path], a);
    const codeB = await archMain(["--format", "json", r.path], b);
    expect(codeA).toBe(0);
    expect(codeB).toBe(0);
    expect(a.out).toBe(b.out);
  });

  it("--ref builds the graph at a specific commit", async () => {
    const r = makeHubRepo();
    const baseSha = r.rev("HEAD");
    // Add a new component on top — should appear at HEAD but not at base.
    r.write(
      "src/late.ts",
      `import { hub } from './hub';\nexport const late = () => hub();\n`,
    );
    r.commit("late");

    const headIO = makeIO();
    const codeHead = await archMain(
      ["--format", "json", r.path],
      headIO,
    );
    expect(codeHead).toBe(0);
    const headReport = JSON.parse(headIO.out);
    const headLate = headReport.hotspots.find(
      (h: { ref: { location: string } }) =>
        h.ref.location.startsWith("src/late.ts:"),
    );
    // 'late' may or may not be a hotspot, but the file count should
    // reflect HEAD's tree.
    expect(headReport.project.sourceFileCount).toBeGreaterThanOrEqual(10);
    void headLate;

    const baseIO = makeIO();
    const codeBase = await archMain(
      ["--format", "json", "--ref", baseSha, r.path],
      baseIO,
    );
    expect(codeBase).toBe(0);
    const baseReport = JSON.parse(baseIO.out);
    expect(baseReport.project.sourceFileCount).toBe(9);
  });

  it("downweight config drops a hub off the candidate list", async () => {
    const r = makeHubRepo();
    // Drop hub.ts to weight 0 — every edge involving it disappears.
    r.write(
      ".ts-hotspots.json",
      JSON.stringify(
        {
          architecture: {
            downweight: [{ glob: "src/hub.ts", factor: 0 }],
          },
        },
        null,
        2,
      ),
    );
    r.commit("downweight-config");

    const io = makeIO();
    const code = await archMain(["--format", "json", r.path], io);
    expect(code).toBe(0);
    const report = JSON.parse(io.out);
    const hub = report.hotspots.find(
      (h: { ref: { location: string } }) =>
        h.ref.location.startsWith("src/hub.ts:"),
    );
    expect(hub).toBeUndefined();
  });

  it("malformed config produces an INVALID_CONFIG error", async () => {
    const r = makeHubRepo();
    r.write(
      ".ts-hotspots.json",
      JSON.stringify({
        architecture: { downweight: [{ glob: "x", factor: 2 }] },
      }),
    );
    r.commit("bad-config");

    const io = makeIO();
    const code = await archMain(["--format", "json", r.path], io);
    expect(code).toBe(1);
    const parsed = JSON.parse(io.out);
    expect(parsed.status).toBe("error");
    expect(parsed.error.code).toBe("INVALID_CONFIG");
  });

  it("--no-include-types drops type-only edges", async () => {
    const r = createTempRepo("ts-arch-types-");
    repos.push(r);
    // 5 nodes, only one with high fan-in via type-only edges.
    r.write("src/types.ts", `export type T = number;\n`);
    for (let i = 0; i < 4; i++) {
      r.write(
        `src/c${String(i)}.ts`,
        `import type { T } from './types';\nexport const v${String(i)}: T = ${String(i)};\n`,
      );
    }
    r.commit("type-fanin");

    const ioNoTypes = makeIO();
    const codeNo = await archMain(
      ["--format", "json", "--no-include-types", r.path],
      ioNoTypes,
    );
    expect(codeNo).toBe(0);
    const reportNoTypes = JSON.parse(ioNoTypes.out);
    // No runtime edges at all — no candidate should clear the small-N
    // gate (z-score against an all-zero distribution is 0).
    expect(reportNoTypes.hotspots.length).toBe(0);
  });
});
