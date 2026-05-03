import { describe, expect, test } from "vitest";
import { makePairKey, parsePairKey, walkCochange } from "./walkCochange.ts";

const cmt = "CMT";

function withSha(sha: string): string {
  return `${cmt} ${sha}`;
}

describe("walkCochange", () => {
  test("counts per-file changes for a single-file commit", () => {
    const raw = [withSha("abc1234"), "M\tsrc/a.ts"].join("\n");
    const r = walkCochange(raw, new Set(["src/a.ts"]), {
      maxFilesPerCommit: 50,
    });
    expect(r.perFileChanges.get("src/a.ts")).toBe(1);
    expect(r.pairs.size).toBe(0);
    expect(r.actualWindow).toBe(1);
    expect(r.commitsSkippedAsLargeChange).toBe(0);
  });

  test("emits a single pair from a two-file commit and counts both", () => {
    const raw = [withSha("abc1234"), "M\tsrc/a.ts", "M\tsrc/b.ts"].join("\n");
    const r = walkCochange(raw, new Set(["src/a.ts", "src/b.ts"]), {
      maxFilesPerCommit: 50,
    });
    expect(r.perFileChanges.get("src/a.ts")).toBe(1);
    expect(r.perFileChanges.get("src/b.ts")).toBe(1);
    expect(r.pairs.size).toBe(1);
    const evidence = r.pairs.get("src/a.ts src/b.ts");
    expect(evidence).toEqual({ support: 1, recent: ["abc1234"] });
  });

  test("emits all unordered pairs from a three-file commit", () => {
    const raw = [
      withSha("abc1234"),
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
      "M\tsrc/c.ts",
    ].join("\n");
    const r = walkCochange(raw, new Set(["src/a.ts", "src/b.ts", "src/c.ts"]), {
      maxFilesPerCommit: 50,
    });
    expect([...r.pairs.keys()].sort()).toEqual([
      "src/a.ts src/b.ts",
      "src/a.ts src/c.ts",
      "src/b.ts src/c.ts",
    ]);
    for (const e of r.pairs.values()) expect(e.support).toBe(1);
  });

  test("pair key is canonical regardless of log order", () => {
    const raw = [withSha("abc1234"), "M\tsrc/z.ts", "M\tsrc/a.ts"].join("\n");
    const r = walkCochange(raw, new Set(["src/a.ts", "src/z.ts"]), {
      maxFilesPerCommit: 50,
    });
    expect([...r.pairs.keys()]).toEqual(["src/a.ts src/z.ts"]);
  });

  test("dedupes per-commit when the same canonical path appears twice", () => {
    // A rename log can produce two events for one canonical file in the same
    // commit. The walker must count it as one bump and not emit a self-pair.
    const raw = [
      withSha("abc1234"),
      "M\tsrc/a.ts",
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
    ].join("\n");
    const r = walkCochange(raw, new Set(["src/a.ts", "src/b.ts"]), {
      maxFilesPerCommit: 50,
    });
    expect(r.perFileChanges.get("src/a.ts")).toBe(1);
    expect(r.perFileChanges.get("src/b.ts")).toBe(1);
    expect(r.pairs.size).toBe(1);
    expect(r.pairs.get("src/a.ts src/b.ts")?.support).toBe(1);
  });

  test("aggregates across multiple commits", () => {
    const raw = [
      withSha("aaaaaaa"),
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
      withSha("bbbbbbb"),
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
      withSha("ccccccc"),
      "M\tsrc/a.ts",
    ].join("\n");
    const r = walkCochange(raw, new Set(["src/a.ts", "src/b.ts"]), {
      maxFilesPerCommit: 50,
    });
    expect(r.perFileChanges.get("src/a.ts")).toBe(3);
    expect(r.perFileChanges.get("src/b.ts")).toBe(2);
    expect(r.pairs.get("src/a.ts src/b.ts")).toEqual({
      support: 2,
      recent: ["aaaaaaa", "bbbbbbb"],
    });
    expect(r.actualWindow).toBe(3);
  });

  test("recent[] retains every co-change SHA (length === support, walk order preserved)", () => {
    // The walker is responsible for keeping the full list; the slim
    // 5-SHA display cap lives in the serializer, not here.
    const lines: string[] = [];
    for (let i = 0; i < 7; i++) {
      const sha = `sha000${String(i)}`;
      lines.push(withSha(sha), "M\tsrc/a.ts", "M\tsrc/b.ts");
    }
    const r = walkCochange(
      lines.join("\n"),
      new Set(["src/a.ts", "src/b.ts"]),
      {
        maxFilesPerCommit: 50,
      },
    );
    const evidence = r.pairs.get("src/a.ts src/b.ts");
    expect(evidence?.support).toBe(7);
    expect(evidence?.recent).toEqual([
      "sha0000",
      "sha0001",
      "sha0002",
      "sha0003",
      "sha0004",
      "sha0005",
      "sha0006",
    ]);
    expect(evidence?.recent.length).toBe(evidence?.support);
  });

  test("skips commits exceeding maxFilesPerCommit (post-filter count)", () => {
    const raw = [
      withSha("aaaaaaa"),
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
      "M\tsrc/c.ts",
      withSha("bbbbbbb"),
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
    ].join("\n");
    const r = walkCochange(raw, new Set(["src/a.ts", "src/b.ts", "src/c.ts"]), {
      maxFilesPerCommit: 2,
    });
    expect(r.commitsSkippedAsLargeChange).toBe(1);
    expect(r.actualWindow).toBe(2);
    // First commit dropped entirely: no per-file bumps, no pairs.
    expect(r.perFileChanges.get("src/a.ts")).toBe(1);
    expect(r.perFileChanges.get("src/b.ts")).toBe(1);
    expect(r.perFileChanges.get("src/c.ts")).toBeUndefined();
    expect(r.pairs.get("src/a.ts src/b.ts")?.support).toBe(1);
    expect(r.pairs.get("src/a.ts src/b.ts")?.recent).toEqual(["bbbbbbb"]);
  });

  test("post-filter count uses canonical-and-tracked, not raw log size", () => {
    // 3 of these are untracked; only 2 survive. With maxFilesPerCommit=2 the
    // commit must NOT be skipped.
    const raw = [
      withSha("abc1234"),
      "M\tsrc/a.ts",
      "M\tsrc/b.ts",
      "M\tREADME.md",
      "M\tpackage.json",
      "M\tdocs/x.md",
    ].join("\n");
    const r = walkCochange(raw, new Set(["src/a.ts", "src/b.ts"]), {
      maxFilesPerCommit: 2,
    });
    expect(r.commitsSkippedAsLargeChange).toBe(0);
    expect(r.pairs.get("src/a.ts src/b.ts")?.support).toBe(1);
  });

  test("ignores untracked files when forming pairs", () => {
    const raw = [
      withSha("abc1234"),
      "M\tsrc/a.ts",
      "M\tREADME.md",
      "M\tsrc/b.ts",
    ].join("\n");
    const r = walkCochange(raw, new Set(["src/a.ts", "src/b.ts"]), {
      maxFilesPerCommit: 50,
    });
    expect(r.pairs.size).toBe(1);
    expect(r.pairs.get("src/a.ts src/b.ts")?.support).toBe(1);
  });

  test("a commit touching only one tracked file emits no pair", () => {
    const raw = [withSha("abc1234"), "M\tsrc/a.ts", "M\tREADME.md"].join("\n");
    const r = walkCochange(raw, new Set(["src/a.ts"]), {
      maxFilesPerCommit: 50,
    });
    expect(r.pairs.size).toBe(0);
    expect(r.perFileChanges.get("src/a.ts")).toBe(1);
  });

  test("rename: pair is keyed by post-rename canonical path", () => {
    // newest → oldest:
    //   c2: rename src/old.ts → src/new.ts, also touches src/b.ts
    //   c1: src/old.ts and src/b.ts touched together (pre-rename)
    const raw = [
      withSha("aaaaaaa"),
      "R100\tsrc/old.ts\tsrc/new.ts",
      "M\tsrc/b.ts",
      withSha("bbbbbbb"),
      "M\tsrc/old.ts",
      "M\tsrc/b.ts",
    ].join("\n");
    const r = walkCochange(raw, new Set(["src/new.ts", "src/b.ts"]), {
      maxFilesPerCommit: 50,
    });
    expect(r.pairs.get("src/b.ts src/new.ts")).toEqual({
      support: 2,
      recent: ["aaaaaaa", "bbbbbbb"],
    });
    expect(r.perFileChanges.get("src/new.ts")).toBe(2);
    expect(r.perFileChanges.get("src/b.ts")).toBe(2);
  });

  test("prefix scopes pair detection to the sub-package", () => {
    const raw = [
      withSha("abc1234"),
      "M\tpackages/core/src/a.ts",
      "M\tpackages/core/src/b.ts",
      "M\tdocs/x.md",
    ].join("\n");
    const r = walkCochange(raw, new Set(["src/a.ts", "src/b.ts"]), {
      prefix: "packages/core",
      maxFilesPerCommit: 50,
    });
    expect(r.pairs.get("src/a.ts src/b.ts")?.support).toBe(1);
  });

  test("empty log produces empty result", () => {
    const r = walkCochange("", new Set(["src/a.ts"]), {
      maxFilesPerCommit: 50,
    });
    expect(r.perFileChanges.size).toBe(0);
    expect(r.pairs.size).toBe(0);
    expect(r.actualWindow).toBe(0);
    expect(r.commitsSkippedAsLargeChange).toBe(0);
  });

  test("commits without a SHA token still count and produce empty recent[]", () => {
    // The walker must accept the legacy `CMT`-only format too.
    const raw = [cmt, "M\tsrc/a.ts", "M\tsrc/b.ts"].join("\n");
    const r = walkCochange(raw, new Set(["src/a.ts", "src/b.ts"]), {
      maxFilesPerCommit: 50,
    });
    expect(r.actualWindow).toBe(1);
    expect(r.pairs.get("src/a.ts src/b.ts")).toEqual({
      support: 1,
      recent: [],
    });
  });
});

describe("makePairKey / parsePairKey", () => {
  test("canonical-orders the pair lexicographically", () => {
    expect(makePairKey("src/z.ts", "src/a.ts")).toBe("src/a.ts src/z.ts");
    expect(makePairKey("src/a.ts", "src/z.ts")).toBe("src/a.ts src/z.ts");
  });

  test("round-trips", () => {
    const key = makePairKey("src/foo/bar.ts", "src/baz.ts");
    expect(parsePairKey(key)).toEqual(["src/baz.ts", "src/foo/bar.ts"]);
  });
});
