import { Project, SyntaxKind } from "ts-morph";
import { describe, expect, test } from "vitest";
import { computeBodyHash, hashText } from "./hash.ts";

function firstFunction(source: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("x.ts", source);
  const node = sf.getFirstDescendantByKindOrThrow(
    SyntaxKind.FunctionDeclaration,
  );
  return node;
}

describe("computeBodyHash", () => {
  test("identical code produces identical hash", () => {
    const a = computeBodyHash(
      firstFunction("function f(x: number) { return x + 1; }"),
    );
    const b = computeBodyHash(
      firstFunction("function f(x: number) { return x + 1; }"),
    );
    expect(a).toBe(b);
    expect(a.startsWith("sha256:")).toBe(true);
  });

  test("whitespace-only reformatting does not change hash", () => {
    const a = computeBodyHash(
      firstFunction("function f(x: number) { return x + 1; }"),
    );
    const b = computeBodyHash(
      firstFunction(
        ["function f(x: number) {", "    return x + 1;", "}"].join("\n"),
      ),
    );
    expect(a).toBe(b);
  });

  test("added comments do not change hash", () => {
    const a = computeBodyHash(
      firstFunction("function f(x: number) { return x + 1; }"),
    );
    const b = computeBodyHash(
      firstFunction(
        [
          "function f(x: number) {",
          "  // add one",
          "  /* block */",
          "  return x + 1;",
          "}",
        ].join("\n"),
      ),
    );
    expect(a).toBe(b);
  });

  test("body edit changes the hash", () => {
    const a = computeBodyHash(
      firstFunction("function f(x: number) { return x + 1; }"),
    );
    const b = computeBodyHash(
      firstFunction("function f(x: number) { return x + 2; }"),
    );
    expect(a).not.toBe(b);
  });

  test("signature rename changes the hash", () => {
    const a = computeBodyHash(
      firstFunction("function f(x: number) { return x + 1; }"),
    );
    const b = computeBodyHash(
      firstFunction("function g(x: number) { return x + 1; }"),
    );
    expect(a).not.toBe(b);
  });

  test("hashText is stable for equivalent inputs", () => {
    expect(hashText("  return 1;  ")).toBe(hashText("return 1;"));
  });
});
