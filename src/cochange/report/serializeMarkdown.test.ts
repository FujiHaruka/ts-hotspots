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
    expect(md).toContain("score: supportConfidence = 2.500");
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

  test("slim caps `recent commits` line at 5; verbose `all co-change commits` keeps every SHA", () => {
    const recent = ["s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7"];
    const c = candidate("src/a.ts", "src/b.ts", metric(8, 0.5, 2.0), recent);
    const slim = serializeMarkdown(baseInput([c]), { verbose: false });
    expect(slim).toContain("recent commits: `s0`, `s1`, `s2`, `s3`, `s4`");
    expect(slim).not.toContain("`s5`");
    const verbose = serializeMarkdown(baseInput([c]), { verbose: true });
    expect(verbose).toContain("recent commits: `s0`, `s1`, `s2`, `s3`, `s4`");
    expect(verbose).toContain(
      "all co-change commits: `s0`, `s1`, `s2`, `s3`, `s4`, `s5`, `s6`, `s7`",
    );
    expect(verbose).toContain("co-change window: `s0` -> `s7`");
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

  test("triangle of pairs renders as one cluster card with aggregated metrics annotated", () => {
    const candidates = [
      candidate("src/a.ts", "src/b.ts", metric(6, 0.8, 3.0), ["sha1"]),
      candidate("src/b.ts", "src/c.ts", metric(4, 0.6, 2.0), ["sha2"]),
      candidate("src/a.ts", "src/c.ts", metric(3, 1.0, 1.5), ["sha3"]),
    ];
    const md = serializeMarkdown(baseInput(candidates), { verbose: false });
    // Single ranked entry, header reflects file count.
    expect(md).toContain("## #1 Cluster (3 files)");
    expect(md).not.toContain("## #2");
    // Aggregated metrics labelled with their aggregation method.
    expect(md).toContain("support (median across 3 pairs): 4");
    expect(md).toContain("confidenceMax (max across pairs): 1.000");
    expect(md).toContain("lift (median across pairs): 2.00");
    // All three members listed.
    expect(md).toContain("- members:");
    expect(md).toContain("  - src/a.ts");
    expect(md).toContain("  - src/b.ts");
    expect(md).toContain("  - src/c.ts");
    // SHA union annotated.
    expect(md).toContain(
      "recent commits (union across pairs): `sha1`, `sha2`, `sha3`",
    );
    expect(md).toContain("dismissalId: `coch:");
    // Pair-only labels must not leak in.
    expect(md).not.toContain("confidenceAtoB");
    expect(md).not.toContain("confidenceBtoA");
  });

  test("cluster verbose card adds full SHA list and window endpoints", () => {
    const candidates = [
      candidate("src/a.ts", "src/b.ts", metric(4, 0.8, 3.0), [
        "sha1",
        "shared",
      ]),
      candidate("src/b.ts", "src/c.ts", metric(3, 0.6, 2.0), [
        "shared",
        "sha2",
      ]),
      candidate("src/a.ts", "src/c.ts", metric(3, 1.0, 1.5), ["sha3"]),
    ];
    const md = serializeMarkdown(baseInput(candidates), { verbose: true });
    expect(md).toContain("## #1 Cluster (3 files)");
    // SHA union deduped, window endpoints derived from the union.
    expect(md).toContain("co-change window: `sha1` -> `sha3`");
    expect(md).toContain(
      "all co-change commits: `sha1`, `shared`, `sha2`, `sha3`",
    );
  });

  test("anchor-mode pair next to non-anchor cluster: anchor mode preserves pair shape", () => {
    // All three pairs share the anchor; without the anchor-mode bypass
    // they would have density 3/3=1 and collapse. With the bypass each
    // anchor-pair stays a separate card.
    const candidates = [
      {
        ...candidate("src/anchor.ts", "src/a.ts", metric(5, 0.8, 2.0)),
        anchor: "src/anchor.ts",
      },
      {
        ...candidate("src/anchor.ts", "src/b.ts", metric(4, 0.7, 1.8)),
        anchor: "src/anchor.ts",
      },
      {
        ...candidate("src/anchor.ts", "src/c.ts", metric(3, 0.6, 1.5)),
        anchor: "src/anchor.ts",
      },
    ];
    const md = serializeMarkdown(baseInput(candidates), { verbose: false });
    expect(md).toContain("## #1 src/anchor.ts -> src/a.ts");
    expect(md).toContain("## #2 src/anchor.ts -> src/b.ts");
    expect(md).toContain("## #3 src/anchor.ts -> src/c.ts");
    expect(md).not.toContain("Cluster (");
  });
});
