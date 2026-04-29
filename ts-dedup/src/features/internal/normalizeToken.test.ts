import ts from "typescript";
import { describe, expect, it } from "vitest";
import { normalizeTokenKind } from "./normalizeToken.ts";

describe("normalizeTokenKind", () => {
  it("collapses identifiers and private identifiers to i", () => {
    expect(normalizeTokenKind(ts.SyntaxKind.Identifier)).toBe("i");
    expect(normalizeTokenKind(ts.SyntaxKind.PrivateIdentifier)).toBe("i");
  });

  it("collapses every string-shaped literal to s", () => {
    expect(normalizeTokenKind(ts.SyntaxKind.StringLiteral)).toBe("s");
    expect(
      normalizeTokenKind(ts.SyntaxKind.NoSubstitutionTemplateLiteral),
    ).toBe("s");
    expect(normalizeTokenKind(ts.SyntaxKind.TemplateHead)).toBe("s");
    expect(normalizeTokenKind(ts.SyntaxKind.TemplateMiddle)).toBe("s");
    expect(normalizeTokenKind(ts.SyntaxKind.TemplateTail)).toBe("s");
  });

  it("collapses numeric and bigint literals to n", () => {
    expect(normalizeTokenKind(ts.SyntaxKind.NumericLiteral)).toBe("n");
    expect(normalizeTokenKind(ts.SyntaxKind.BigIntLiteral)).toBe("n");
  });

  it("collapses true/false to b and null to u", () => {
    expect(normalizeTokenKind(ts.SyntaxKind.TrueKeyword)).toBe("b");
    expect(normalizeTokenKind(ts.SyntaxKind.FalseKeyword)).toBe("b");
    expect(normalizeTokenKind(ts.SyntaxKind.NullKeyword)).toBe("u");
  });

  it("maps control-flow keywords to short two-letter codes", () => {
    expect(normalizeTokenKind(ts.SyntaxKind.IfKeyword)).toBe("If");
    expect(normalizeTokenKind(ts.SyntaxKind.ReturnKeyword)).toBe("Re");
    expect(normalizeTokenKind(ts.SyntaxKind.ForKeyword)).toBe("Fo");
    expect(normalizeTokenKind(ts.SyntaxKind.AwaitKeyword)).toBe("Aw");
  });

  it("maps punctuation and operators to literal source characters", () => {
    expect(normalizeTokenKind(ts.SyntaxKind.OpenBraceToken)).toBe("{");
    expect(normalizeTokenKind(ts.SyntaxKind.SemicolonToken)).toBe(";");
    expect(normalizeTokenKind(ts.SyntaxKind.EqualsEqualsEqualsToken)).toBe(
      "===",
    );
    expect(normalizeTokenKind(ts.SyntaxKind.QuestionDotToken)).toBe("?.");
  });

  it("emits unique forms for explicitly-mapped kinds (modulo intended merges)", () => {
    // Duplicate forms would silently fuse two distinct kinds into the same
    // n-gram bucket. The only intended merges are the placeholder buckets
    // (`i`, `s`, `n`, `b`) that collapse a small family of kinds; all other
    // collisions indicate a typo in the table.
    const intendedMerges: ReadonlyMap<string, ReadonlySet<ts.SyntaxKind>> =
      new Map([
        [
          "i",
          new Set<ts.SyntaxKind>([
            ts.SyntaxKind.Identifier,
            ts.SyntaxKind.PrivateIdentifier,
          ]),
        ],
        [
          "s",
          new Set<ts.SyntaxKind>([
            ts.SyntaxKind.StringLiteral,
            ts.SyntaxKind.NoSubstitutionTemplateLiteral,
            ts.SyntaxKind.TemplateHead,
            ts.SyntaxKind.TemplateMiddle,
            ts.SyntaxKind.TemplateTail,
          ]),
        ],
        [
          "n",
          new Set<ts.SyntaxKind>([
            ts.SyntaxKind.NumericLiteral,
            ts.SyntaxKind.BigIntLiteral,
          ]),
        ],
        [
          "b",
          new Set<ts.SyntaxKind>([
            ts.SyntaxKind.TrueKeyword,
            ts.SyntaxKind.FalseKeyword,
          ]),
        ],
      ]);

    const seen = new Map<string, ts.SyntaxKind>();
    for (const k of Object.values(ts.SyntaxKind)) {
      if (typeof k !== "number") continue;
      const kind = k as ts.SyntaxKind;
      const form = normalizeTokenKind(kind);
      // Skip fall-back forms — they reuse `ts.SyntaxKind[k]` and are
      // unique by enum construction.
      if (form === ts.SyntaxKind[kind]) continue;
      const prev = seen.get(form);
      if (prev === undefined || prev === kind) {
        seen.set(form, kind);
        continue;
      }
      const allowed = intendedMerges.get(form);
      const ok = allowed !== undefined && allowed.has(prev) && allowed.has(kind);
      expect(ok, `unexpected form collision on ${form}`).toBe(true);
    }
  });

  it("never emits the n-gram NUL separator inside a form", () => {
    // The token n-gram concat uses "\x00" as the inter-token separator; if
    // any normalised form contains "\x00" the join becomes ambiguous.
    for (const k of Object.values(ts.SyntaxKind)) {
      if (typeof k !== "number") continue;
      const form = normalizeTokenKind(k as ts.SyntaxKind);
      expect(form.includes("\x00")).toBe(false);
    }
  });

  it("falls back to the raw SyntaxKind name for unmapped kinds", () => {
    // EndOfFileToken is intentionally not in the explicit map.
    const eof = normalizeTokenKind(ts.SyntaxKind.EndOfFileToken);
    expect(eof).toBe(ts.SyntaxKind[ts.SyntaxKind.EndOfFileToken]);
    expect(eof).toBe("EndOfFileToken");
  });

  it("is deterministic across repeated calls", () => {
    for (const kind of [
      ts.SyntaxKind.Identifier,
      ts.SyntaxKind.NumericLiteral,
      ts.SyntaxKind.IfKeyword,
      ts.SyntaxKind.EndOfFileToken,
    ]) {
      expect(normalizeTokenKind(kind)).toBe(normalizeTokenKind(kind));
    }
  });
});
