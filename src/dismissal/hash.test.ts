import { describe, expect, test } from "vitest";
import { parseFirstFunctionLike } from "../collectors/internal/parseFirstFunctionLike.test-helper.ts";
import { computeBodyHash, hashText, membersToDupDismissalId } from "./hash.ts";

function hashOf(source: string): string {
  const { sourceFile, fn } = parseFirstFunctionLike(source);
  return computeBodyHash(fn, sourceFile);
}

describe("computeBodyHash", () => {
  test("identical code produces identical hash", () => {
    const a = hashOf("function f(x: number) { return x + 1; }");
    const b = hashOf("function f(x: number) { return x + 1; }");
    expect(a).toBe(b);
    expect(a.startsWith("sha256:")).toBe(true);
  });

  test("whitespace-only reformatting does not change hash", () => {
    const a = hashOf("function f(x: number) { return x + 1; }");
    const b = hashOf(
      ["function f(x: number) {", "    return x + 1;", "}"].join("\n"),
    );
    expect(a).toBe(b);
  });

  test("added comments do not change hash", () => {
    const a = hashOf("function f(x: number) { return x + 1; }");
    const b = hashOf(
      [
        "function f(x: number) {",
        "  // add one",
        "  /* block */",
        "  return x + 1;",
        "}",
      ].join("\n"),
    );
    expect(a).toBe(b);
  });

  test("body edit changes the hash", () => {
    const a = hashOf("function f(x: number) { return x + 1; }");
    const b = hashOf("function f(x: number) { return x + 2; }");
    expect(a).not.toBe(b);
  });

  test("signature rename changes the hash", () => {
    const a = hashOf("function f(x: number) { return x + 1; }");
    const b = hashOf("function g(x: number) { return x + 1; }");
    expect(a).not.toBe(b);
  });

  test("hashText is stable for equivalent inputs", () => {
    expect(hashText("  return 1;  ")).toBe(hashText("return 1;"));
  });
});

describe("membersToDupDismissalId", () => {
  test("returns dup:<sha256> form", () => {
    const id = membersToDupDismissalId([hashText("a"), hashText("b")]);
    expect(id.startsWith("dup:")).toBe(true);
    expect(id.length).toBe("dup:".length + 64);
  });

  test("is invariant under member reordering", () => {
    const a = hashText("function one() { return 1; }");
    const b = hashText("function two() { return 2; }");
    const c = hashText("function three() { return 3; }");
    const forward = membersToDupDismissalId([a, b, c]);
    const reversed = membersToDupDismissalId([c, b, a]);
    expect(forward).toBe(reversed);
  });

  test("changes when membership changes", () => {
    const a = hashText("function one() { return 1; }");
    const b = hashText("function two() { return 2; }");
    const c = hashText("function three() { return 3; }");
    const ab = membersToDupDismissalId([a, b]);
    const abc = membersToDupDismissalId([a, b, c]);
    expect(ab).not.toBe(abc);
  });

  test("accepts both prefixed and bare hashes (sha256: stripped)", () => {
    const a = hashText("foo");
    const b = hashText("bar");
    const idPrefixed = membersToDupDismissalId([a, b]);
    const idBare = membersToDupDismissalId([
      a.replace(/^sha256:/, ""),
      b.replace(/^sha256:/, ""),
    ]);
    expect(idPrefixed).toBe(idBare);
  });
});
