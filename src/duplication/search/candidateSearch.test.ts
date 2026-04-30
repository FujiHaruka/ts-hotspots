import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import type { Config } from "../config/index.ts";
import type { Fragment, FragmentFeatures } from "../domain/index.ts";
import { buildInvertedIndex, type IndexInput } from "../index_/invertedIndex.ts";
import { searchCandidates } from "./candidateSearch.ts";

function makeFragment(id: string, overrides: Partial<Fragment> = {}): Fragment {
  return {
    id,
    filePath: overrides.filePath ?? `${id}.ts`,
    startLine: overrides.startLine ?? 1,
    endLine: overrides.endLine ?? 10,
    kind: overrides.kind ?? "function",
    text: overrides.text ?? "",
    astNodeKind: overrides.astNodeKind ?? "FunctionDeclaration",
  };
}

function makeFeatures(
  fragmentId: string,
  tokens: string[] = [],
  statements: string[] = [],
  calls: string[] = [],
): FragmentFeatures {
  return { fragmentId, tokens, statements, calls };
}

describe("searchCandidates", () => {
  it("picks up a base fragment matching on tokens only (OR)", () => {
    const base: IndexInput[] = [
      {
        fragment: makeFragment("base1"),
        features: makeFeatures(
          "base1",
          ["token:T1"],
          ["statement:OTHER"],
          ["call:other"],
        ),
      },
    ];
    const index = buildInvertedIndex(base);

    const changed = makeFragment("ch1");
    const changedFeats = makeFeatures(
      "ch1",
      ["token:T1"],
      ["statement:S"],
      ["call:c"],
    );

    const result = searchCandidates(changed, changedFeats, index, defaultConfig);

    expect(result).toHaveLength(1);
    expect(result[0]?.baseFragmentId).toBe("base1");
    expect(result[0]?.hitCounts).toEqual({ token: 1, statement: 0, call: 0 });
  });

  it("picks up a base fragment matching on statements only", () => {
    const base: IndexInput[] = [
      {
        fragment: makeFragment("base1"),
        features: makeFeatures(
          "base1",
          ["token:A"],
          ["statement:S1"],
          ["call:a"],
        ),
      },
    ];
    const index = buildInvertedIndex(base);

    const changed = makeFragment("ch1");
    const changedFeats = makeFeatures(
      "ch1",
      ["token:X"],
      ["statement:S1"],
      ["call:y"],
    );

    const result = searchCandidates(changed, changedFeats, index, defaultConfig);

    expect(result).toHaveLength(1);
    expect(result[0]?.baseFragmentId).toBe("base1");
    expect(result[0]?.hitCounts).toEqual({ token: 0, statement: 1, call: 0 });
  });

  it("picks up a base fragment matching on calls only", () => {
    const base: IndexInput[] = [
      {
        fragment: makeFragment("base1"),
        features: makeFeatures(
          "base1",
          ["token:A"],
          ["statement:S"],
          ["call:findById"],
        ),
      },
    ];
    const index = buildInvertedIndex(base);

    const changed = makeFragment("ch1");
    const changedFeats = makeFeatures(
      "ch1",
      ["token:X"],
      ["statement:S2"],
      ["call:findById"],
    );

    const result = searchCandidates(changed, changedFeats, index, defaultConfig);

    expect(result).toHaveLength(1);
    expect(result[0]?.baseFragmentId).toBe("base1");
    expect(result[0]?.hitCounts).toEqual({ token: 0, statement: 0, call: 1 });
  });

  it("aggregates hitCounts correctly across multiple kinds", () => {
    const base: IndexInput[] = [
      {
        fragment: makeFragment("base1"),
        features: makeFeatures(
          "base1",
          ["token:T1", "token:T2"],
          ["statement:S1"],
          ["call:c1", "call:c2"],
        ),
      },
    ];
    const index = buildInvertedIndex(base);

    const changed = makeFragment("ch1");
    const changedFeats = makeFeatures(
      "ch1",
      ["token:T1", "token:T2", "token:T3"],
      ["statement:S1", "statement:S2"],
      ["call:c1", "call:c2", "call:c3"],
    );

    const result = searchCandidates(changed, changedFeats, index, defaultConfig);

    expect(result).toHaveLength(1);
    expect(result[0]?.hitCounts).toEqual({ token: 2, statement: 1, call: 2 });
  });

  it("excludes self-matches (same fragmentId)", () => {
    const base: IndexInput[] = [
      {
        fragment: makeFragment("shared"),
        features: makeFeatures(
          "shared",
          ["token:T1"],
          ["statement:S1"],
          ["call:c1"],
        ),
      },
      {
        fragment: makeFragment("other"),
        features: makeFeatures(
          "other",
          ["token:T1"],
          ["statement:S1"],
          ["call:c1"],
        ),
      },
    ];
    const index = buildInvertedIndex(base);

    const changed = makeFragment("shared");
    const changedFeats = makeFeatures(
      "shared",
      ["token:T1"],
      ["statement:S1"],
      ["call:c1"],
    );

    const result = searchCandidates(changed, changedFeats, index, defaultConfig);

    expect(result).toHaveLength(1);
    expect(result[0]?.baseFragmentId).toBe("other");
  });

  it("truncates to maxCandidatesPerFragment deterministically", () => {
    const base: IndexInput[] = [];
    // 10 base fragments, all match on token:SHARED.
    // base05 has 2 hits (token + call), others have 1 hit.
    for (let i = 0; i < 10; i++) {
      const id = `base${i.toString().padStart(2, "0")}`;
      const calls = i === 5 ? ["call:extra"] : [];
      base.push({
        fragment: makeFragment(id),
        features: makeFeatures(id, ["token:SHARED"], [], calls),
      });
    }
    const index = buildInvertedIndex(base);

    const changed = makeFragment("ch1");
    const changedFeats = makeFeatures(
      "ch1",
      ["token:SHARED"],
      [],
      ["call:extra"],
    );

    const narrow: Config = {
      ...defaultConfig,
      search: { ...defaultConfig.search, maxCandidatesPerFragment: 3 },
    };
    const result = searchCandidates(changed, changedFeats, index, narrow);

    expect(result).toHaveLength(3);
    // base05 has the highest sum (2) so comes first.
    expect(result[0]?.baseFragmentId).toBe("base05");
    // Remaining ties: baseFragmentId ascending.
    expect(result[1]?.baseFragmentId).toBe("base00");
    expect(result[2]?.baseFragmentId).toBe("base01");
  });

  it("tie-breaks on baseFragmentId ascending when scores are equal", () => {
    const base: IndexInput[] = [
      {
        fragment: makeFragment("zzz"),
        features: makeFeatures("zzz", ["token:T"]),
      },
      {
        fragment: makeFragment("aaa"),
        features: makeFeatures("aaa", ["token:T"]),
      },
      {
        fragment: makeFragment("mmm"),
        features: makeFeatures("mmm", ["token:T"]),
      },
    ];
    const index = buildInvertedIndex(base);

    const changed = makeFragment("ch1");
    const changedFeats = makeFeatures("ch1", ["token:T"]);

    const result = searchCandidates(changed, changedFeats, index, defaultConfig);

    expect(result.map((c) => c.baseFragmentId)).toEqual(["aaa", "mmm", "zzz"]);
  });

  it("returns an empty array when nothing matches", () => {
    const base: IndexInput[] = [
      {
        fragment: makeFragment("base1"),
        features: makeFeatures(
          "base1",
          ["token:A"],
          ["statement:S"],
          ["call:a"],
        ),
      },
    ];
    const index = buildInvertedIndex(base);

    const changed = makeFragment("ch1");
    const changedFeats = makeFeatures(
      "ch1",
      ["token:X"],
      ["statement:Y"],
      ["call:z"],
    );

    const result = searchCandidates(changed, changedFeats, index, defaultConfig);
    expect(result).toEqual([]);
  });

  it("returns an empty array when changed feature is empty", () => {
    const base: IndexInput[] = [
      {
        fragment: makeFragment("base1"),
        features: makeFeatures(
          "base1",
          ["token:A"],
          ["statement:S"],
          ["call:a"],
        ),
      },
    ];
    const index = buildInvertedIndex(base);

    const changed = makeFragment("ch1");
    const changedFeats = makeFeatures("ch1", [], [], []);

    const result = searchCandidates(changed, changedFeats, index, defaultConfig);
    expect(result).toEqual([]);
  });

  it("is deterministic: identical inputs produce identical outputs including order", () => {
    const base: IndexInput[] = [];
    for (let i = 0; i < 8; i++) {
      const id = `b${i.toString()}`;
      base.push({
        fragment: makeFragment(id),
        features: makeFeatures(
          id,
          [`token:T${(i % 3).toString()}`],
          [`statement:S${(i % 2).toString()}`],
          [`call:c${(i % 4).toString()}`],
        ),
      });
    }
    const index = buildInvertedIndex(base);

    const changed = makeFragment("ch1");
    const changedFeats = makeFeatures(
      "ch1",
      ["token:T0", "token:T1", "token:T2"],
      ["statement:S0", "statement:S1"],
      ["call:c0", "call:c1", "call:c2", "call:c3"],
    );

    const r1 = searchCandidates(changed, changedFeats, index, defaultConfig);
    const r2 = searchCandidates(changed, changedFeats, index, defaultConfig);
    expect(r1).toEqual(r2);
  });

  it("handles 500 base fragments x 500 changed fragments within 3 seconds", () => {
    const numBase = 500;
    const numChanged = 500;
    const base: IndexInput[] = [];
    for (let i = 0; i < numBase; i++) {
      const id = `base${i.toString().padStart(4, "0")}`;
      const tokens: string[] = [];
      const statements: string[] = [];
      const calls: string[] = [];
      // ~20 tokens per fragment with ~half shared across the corpus.
      for (let j = 0; j < 20; j++) {
        tokens.push(`token:T${((i + j) % 50).toString()}`);
      }
      for (let j = 0; j < 5; j++) {
        statements.push(`statement:S${((i + j) % 10).toString()}`);
      }
      for (let j = 0; j < 8; j++) {
        calls.push(`call:c${((i + j) % 20).toString()}`);
      }
      base.push({
        fragment: makeFragment(id),
        features: makeFeatures(id, tokens, statements, calls),
      });
    }
    const index = buildInvertedIndex(base);

    const start = Date.now();
    let totalResults = 0;
    for (let k = 0; k < numChanged; k++) {
      const cid = `ch${k.toString().padStart(4, "0")}`;
      const tokens: string[] = [];
      const statements: string[] = [];
      const calls: string[] = [];
      for (let j = 0; j < 20; j++) {
        tokens.push(`token:T${((k + j) % 50).toString()}`);
      }
      for (let j = 0; j < 5; j++) {
        statements.push(`statement:S${((k + j) % 10).toString()}`);
      }
      for (let j = 0; j < 8; j++) {
        calls.push(`call:c${((k + j) % 20).toString()}`);
      }
      const changed = makeFragment(cid);
      const changedFeats = makeFeatures(cid, tokens, statements, calls);
      const res = searchCandidates(changed, changedFeats, index, defaultConfig);
      totalResults += res.length;
    }
    const elapsed = Date.now() - start;

    expect(totalResults).toBeGreaterThan(0);
    expect(elapsed).toBeLessThan(3000);
  });

  describe("same-file overlap skip", () => {
    function singleTokenFragment(
      id: string,
      filePath: string,
      startLine: number,
      endLine: number,
    ): IndexInput {
      return {
        fragment: makeFragment(id, { filePath, startLine, endLine }),
        features: makeFeatures(id, ["token:T"], [], []),
      };
    }

    it("keeps disjoint same-file pairs (e.g. two non-overlapping methods)", () => {
      const base: IndexInput[] = [
        singleTokenFragment("base", "src/foo.ts", 40, 60),
      ];
      const index = buildInvertedIndex(base);

      const changed = makeFragment("ch", {
        filePath: "src/foo.ts",
        startLine: 10,
        endLine: 30,
      });
      const feats = makeFeatures("ch", ["token:T"], [], []);

      const result = searchCandidates(changed, feats, index, defaultConfig);
      expect(result).toHaveLength(1);
      expect(result[0]?.baseFragmentId).toBe("base");
    });

    it("drops same-file pairs that touch on a single boundary line", () => {
      const base: IndexInput[] = [
        singleTokenFragment("base", "src/foo.ts", 30, 60),
      ];
      const index = buildInvertedIndex(base);

      const changed = makeFragment("ch", {
        filePath: "src/foo.ts",
        startLine: 1,
        endLine: 30,
      });
      const feats = makeFeatures("ch", ["token:T"], [], []);

      const result = searchCandidates(changed, feats, index, defaultConfig);
      expect(result).toEqual([]);
    });

    it("drops same-file pairs where one range fully contains the other", () => {
      const base: IndexInput[] = [
        singleTokenFragment("base", "src/foo.ts", 5, 12),
      ];
      const index = buildInvertedIndex(base);

      const changed = makeFragment("ch", {
        filePath: "src/foo.ts",
        startLine: 1,
        endLine: 30,
      });
      const feats = makeFeatures("ch", ["token:T"], [], []);

      const result = searchCandidates(changed, feats, index, defaultConfig);
      expect(result).toEqual([]);
    });

    it("drops same-file pairs with sliding-window 35-line overlap", () => {
      // Mirrors the rank-10 noise from the genesis-vs-jscpd eval:
      // client-helpers.ts:82-172 vs :138-224.
      const base: IndexInput[] = [
        singleTokenFragment("base", "src/client-helpers.ts", 138, 224),
      ];
      const index = buildInvertedIndex(base);

      const changed = makeFragment("ch", {
        filePath: "src/client-helpers.ts",
        startLine: 82,
        endLine: 172,
      });
      const feats = makeFeatures("ch", ["token:T"], [], []);

      const result = searchCandidates(changed, feats, index, defaultConfig);
      expect(result).toEqual([]);
    });

    it("keeps cross-file pairs whose line ranges happen to overlap", () => {
      const base: IndexInput[] = [
        singleTokenFragment("base", "src/bar.ts", 10, 30),
      ];
      const index = buildInvertedIndex(base);

      const changed = makeFragment("ch", {
        filePath: "src/foo.ts",
        startLine: 10,
        endLine: 30,
      });
      const feats = makeFeatures("ch", ["token:T"], [], []);

      const result = searchCandidates(changed, feats, index, defaultConfig);
      expect(result).toHaveLength(1);
      expect(result[0]?.baseFragmentId).toBe("base");
    });

    it("returns an empty array when overlap skip removes every hit", () => {
      const base: IndexInput[] = [
        singleTokenFragment("a", "src/foo.ts", 5, 25),
        singleTokenFragment("b", "src/foo.ts", 8, 40),
      ];
      const index = buildInvertedIndex(base);

      const changed = makeFragment("ch", {
        filePath: "src/foo.ts",
        startLine: 1,
        endLine: 50,
      });
      const feats = makeFeatures("ch", ["token:T"], [], []);

      const result = searchCandidates(changed, feats, index, defaultConfig);
      expect(result).toEqual([]);
    });

    it("applies overlap skip even on the top-K min-heap path", () => {
      // Build a corpus that exceeds maxCandidatesPerFragment so the heap
      // path is taken. Two same-file overlapping postings must still be
      // dropped before reaching the heap.
      const base: IndexInput[] = [];
      for (let i = 0; i < 5; i++) {
        base.push(
          singleTokenFragment(
            `cross${i.toString()}`,
            `src/other${i.toString()}.ts`,
            1,
            10,
          ),
        );
      }
      base.push(singleTokenFragment("overlapA", "src/foo.ts", 1, 50));
      base.push(singleTokenFragment("overlapB", "src/foo.ts", 40, 80));
      const index = buildInvertedIndex(base);

      const changed = makeFragment("ch", {
        filePath: "src/foo.ts",
        startLine: 20,
        endLine: 60,
      });
      const feats = makeFeatures("ch", ["token:T"], [], []);

      const narrow: Config = {
        ...defaultConfig,
        search: { ...defaultConfig.search, maxCandidatesPerFragment: 3 },
      };
      const result = searchCandidates(changed, feats, index, narrow);
      const ids = result.map((c) => c.baseFragmentId);
      expect(ids).not.toContain("overlapA");
      expect(ids).not.toContain("overlapB");
      expect(ids).toHaveLength(3);
    });
  });

  describe("token DF cap", () => {
    /**
     * Build a corpus large enough for the DF cap to kick in (>= 100
     * fragments). All fragments share `token:NOISE`; only fragments 0
     * and 1 also share `token:SIGNAL`. With the default `maxTokenDocumentFrequency`,
     * `NOISE` should be skipped and the result driven entirely by `SIGNAL`.
     */
    function buildCorpus(): { index: ReturnType<typeof buildInvertedIndex> } {
      const base: IndexInput[] = [];
      for (let i = 0; i < 200; i++) {
        const id = `b${i.toString().padStart(3, "0")}`;
        const tokens = ["token:NOISE"];
        if (i === 0 || i === 1) tokens.push("token:SIGNAL");
        base.push({
          fragment: makeFragment(id),
          features: makeFeatures(id, tokens, [], []),
        });
      }
      return { index: buildInvertedIndex(base) };
    }

    it("skips token-axis postings whose document frequency exceeds the cap", () => {
      const { index } = buildCorpus();
      const changed = makeFragment("query");
      const feats = makeFeatures(
        "query",
        ["token:NOISE", "token:SIGNAL"],
        [],
        [],
      );
      const result = searchCandidates(changed, feats, index, defaultConfig);
      const ids = result.map((c) => c.baseFragmentId).sort();
      expect(ids).toEqual(["b000", "b001"]);
    });

    it("keeps every posting when the cap is set to 1.0 (disabled)", () => {
      const { index } = buildCorpus();
      const changed = makeFragment("query");
      const feats = makeFeatures(
        "query",
        ["token:NOISE", "token:SIGNAL"],
        [],
        [],
      );
      const off: Config = {
        ...defaultConfig,
        search: {
          ...defaultConfig.search,
          maxTokenDocumentFrequency: 1.0,
          maxCandidatesPerFragment: 1000,
        },
      };
      const result = searchCandidates(changed, feats, index, off);
      // 200 base fragments minus self-match (none, query id is "query")
      expect(result.length).toBe(200);
    });
  });
});
