import { describe, expect, test } from "vitest";
import type { ReportTool } from "../../schema.ts";
import type { PairMetrics } from "../metrics/computeMetrics.ts";
import type { Candidate } from "../ranking/types.ts";
import type { CochangeReportInput } from "./serializeJson.ts";
import { serializeMarkdown } from "./serializeMarkdown.ts";

const TOOL: ReportTool = { name: "ts-hotspots", version: "0.1.0" };

function metric(
  support: number,
  confidenceMax: number,
  lift: number,
  confidenceAtoB = confidenceMax,
  confidenceBtoA = confidenceMax,
): PairMetrics {
  return { support, confidenceAtoB, confidenceBtoA, confidenceMax, lift };
}

function candidate(
  pathA: string,
  pathB: string,
  m: PairMetrics,
  recent: string[] = [],
): Candidate {
  return {
    pairKey: `${pathA} ${pathB}`,
    pathA,
    pathB,
    metrics: m,
    recent,
  };
}

function baseInput(
  candidates: readonly Candidate[],
  perFileChanges = new Map<string, number>(),
): CochangeReportInput {
  return {
    candidates,
    perFileChanges,
    windowCommits: 200,
    analyzedFileCount: 50,
    pairCandidateCountBeforeGate: candidates.length + 5,
    pairsAfterGate: candidates.length,
    commitsSkippedAsLargeChange: 1,
    requestedWindow: 200,
    actualWindow: 200,
    tool: TOOL,
  };
}

describe("serializeMarkdown", () => {
  test("empty result emits a friendly placeholder under the header", () => {
    const md = serializeMarkdown(baseInput([]), { verbose: false });
    expect(md).toContain("# ts-hotspots cochange");
    expect(md).toContain("files analyzed: 50");
    expect(md).toContain("No cochange candidates found.");
    expect(md).not.toContain("##");
  });

  test("single pair (slim) renders one card with metrics and dismissalId", () => {
    const c = candidate("src/a.ts", "src/b.ts", metric(5, 0.5, 2.0, 0.5, 0.4), [
      "abc1234",
      "def5678",
    ]);
    const md = serializeMarkdown(baseInput([c]), { verbose: false });
    expect(md).toContain("## #1 src/a.ts <-> src/b.ts");
    expect(md).toContain("score: confidenceMax = 0.500");
    expect(md).toContain("support: 5");
    expect(md).toContain("confidenceAtoB: 0.500");
    expect(md).toContain("confidenceBtoA: 0.400");
    expect(md).toContain("lift: 2.00");
    expect(md).toContain("recent commits: `abc1234`, `def5678`");
    expect(md).toContain("dismissalId: `coch:");
    // Slim must NOT show denominators or coChangeWindow.
    expect(md).not.toContain("changesOfA");
    expect(md).not.toContain("co-change window");
  });

  test("multiple pairs (slim) render in input order with sequential ranks", () => {
    const candidates = [
      candidate("src/a.ts", "src/b.ts", metric(10, 0.8, 3.0), ["c1"]),
      candidate("src/c.ts", "src/d.ts", metric(5, 0.5, 1.5), ["c2"]),
    ];
    const md = serializeMarkdown(baseInput(candidates), { verbose: false });
    expect(md.indexOf("## #1 src/a.ts <-> src/b.ts")).toBeLessThan(
      md.indexOf("## #2 src/c.ts <-> src/d.ts"),
    );
  });

  test("verbose adds denominators and full SHA list / window endpoints", () => {
    const c = candidate("src/a.ts", "src/b.ts", metric(5, 0.5, 2.0), [
      "abc1234",
      "def5678",
      "ffeeddc",
    ]);
    const perFileChanges = new Map<string, number>([
      ["src/a.ts", 10],
      ["src/b.ts", 12],
    ]);
    const md = serializeMarkdown(baseInput([c], perFileChanges), {
      verbose: true,
    });
    expect(md).toContain("changesOfA: 10");
    expect(md).toContain("changesOfB: 12");
    expect(md).toContain("co-change window: `abc1234` -> `ffeeddc`");
    expect(md).toContain("all co-change commits:");
    expect(md).toContain("displayed: 1");
  });

  test("renders empty-recent state without crashing", () => {
    const c = candidate("src/a.ts", "src/b.ts", metric(5, 0.5, 2.0), []);
    const md = serializeMarkdown(baseInput([c]), { verbose: true });
    expect(md).toContain("recent commits: (none recorded)");
    expect(md).not.toContain("co-change window:");
  });

  test("determinism: two runs produce identical Markdown", () => {
    const c = candidate("src/a.ts", "src/b.ts", metric(5, 0.5, 2.0), [
      "c1",
      "c2",
    ]);
    const input = baseInput([c]);
    expect(serializeMarkdown(input, { verbose: false })).toBe(
      serializeMarkdown(input, { verbose: false }),
    );
    expect(serializeMarkdown(input, { verbose: true })).toBe(
      serializeMarkdown(input, { verbose: true }),
    );
  });
});
