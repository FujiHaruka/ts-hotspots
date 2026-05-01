import { describe, expect, it } from "vitest";
import type { Fragment, FragmentFeatures, Posting } from "../domain/index.ts";
import { buildInvertedIndex, type IndexInput } from "./invertedIndex.ts";

function makeFragment(overrides: Partial<Fragment> & { id: string }): Fragment {
  return {
    id: overrides.id,
    filePath: overrides.filePath ?? `${overrides.id}.ts`,
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

describe("buildInvertedIndex", () => {
  it("registers features of a single fragment under the correct keys (one posting per kind)", () => {
    const frag = makeFragment({ id: "f1" });
    const features = makeFeatures(
      "f1",
      ["token:A B C"],
      ["statement:IF|RET"],
      ["call:findById"],
    );
    const input: IndexInput = { fragment: frag, features };

    const index = buildInvertedIndex([input]);

    expect(index.postings.size).toBe(3);
    const tokenPostings = index.postings.get("token:A B C");
    const stmtPostings = index.postings.get("statement:IF|RET");
    const callPostings = index.postings.get("call:findById");
    expect(tokenPostings).toHaveLength(1);
    expect(stmtPostings).toHaveLength(1);
    expect(callPostings).toHaveLength(1);
    expect(tokenPostings?.[0]?.featureKind).toBe("token");
    expect(stmtPostings?.[0]?.featureKind).toBe("statement");
    expect(callPostings?.[0]?.featureKind).toBe("call");
  });

  it("puts two postings when two fragments share a feature key", () => {
    const f1 = makeFragment({ id: "f1" });
    const f2 = makeFragment({ id: "f2" });
    const features1 = makeFeatures("f1", ["token:SHARED"]);
    const features2 = makeFeatures("f2", ["token:SHARED"]);

    const index = buildInvertedIndex([
      { fragment: f1, features: features1 },
      { fragment: f2, features: features2 },
    ]);

    const postings = index.postings.get("token:SHARED");
    expect(postings).toHaveLength(2);
    expect(postings?.map((p) => p.fragmentId)).toEqual(["f1", "f2"]);
  });

  it("dedupes postings when the same fragment emits the same key multiple times", () => {
    const f1 = makeFragment({ id: "f1" });
    const features = makeFeatures(
      "f1",
      ["token:X", "token:X", "token:X"],
      ["statement:S", "statement:S"],
      ["call:c", "call:c"],
    );

    const index = buildInvertedIndex([{ fragment: f1, features }]);

    expect(index.postings.get("token:X")).toHaveLength(1);
    expect(index.postings.get("statement:S")).toHaveLength(1);
    expect(index.postings.get("call:c")).toHaveLength(1);
  });

  it("preserves filePath / startLine / endLine / featureKind from the fragment", () => {
    const f1 = makeFragment({
      id: "f1",
      filePath: "src/a.ts",
      startLine: 12,
      endLine: 34,
    });
    const features = makeFeatures(
      "f1",
      ["token:T"],
      ["statement:ST"],
      ["call:c"],
    );

    const index = buildInvertedIndex([{ fragment: f1, features }]);

    const check = (p: Posting | undefined, kind: Posting["featureKind"]) => {
      expect(p).toBeDefined();
      if (p === undefined) throw new Error("unreachable");
      expect(p.fragmentId).toBe("f1");
      expect(p.filePath).toBe("src/a.ts");
      expect(p.startLine).toBe(12);
      expect(p.endLine).toBe(34);
      expect(p.featureKind).toBe(kind);
    };
    check(index.postings.get("token:T")?.[0], "token");
    check(index.postings.get("statement:ST")?.[0], "statement");
    check(index.postings.get("call:c")?.[0], "call");
  });

  it("returns an empty index for empty input", () => {
    const index = buildInvertedIndex([]);
    expect(index.postings.size).toBe(0);
  });

  it("is deterministic: identical input produces identical Map iteration order", () => {
    const inputs: IndexInput[] = [
      {
        fragment: makeFragment({ id: "f1" }),
        features: makeFeatures(
          "f1",
          ["token:A", "token:B"],
          ["statement:S1"],
          ["call:x"],
        ),
      },
      {
        fragment: makeFragment({ id: "f2" }),
        features: makeFeatures(
          "f2",
          ["token:B", "token:C"],
          ["statement:S2"],
          ["call:y"],
        ),
      },
    ];

    const a = buildInvertedIndex(inputs);
    const b = buildInvertedIndex(inputs);

    const keysA = Array.from(a.postings.keys());
    const keysB = Array.from(b.postings.keys());
    expect(keysA).toEqual(keysB);
    for (const k of keysA) {
      const pa = a.postings.get(k);
      const pb = b.postings.get(k);
      expect(pa).toEqual(pb);
    }
  });
});
