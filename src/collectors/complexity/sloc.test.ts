import { type FunctionDeclaration, Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import { computeSloc, slocCollector } from "./sloc.ts";

function parseFn(src: string): FunctionDeclaration {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("/proj/t.ts", src);
  const fn = sf.getFunctions()[0];
  if (!fn) throw new Error("no function in source");
  return fn;
}

describe("computeSloc", () => {
  test("empty single-line body → 1", () => {
    expect(computeSloc(parseFn("function f(){}"))).toBe(1);
  });

  test("multi-line empty body → 2", () => {
    expect(computeSloc(parseFn("function f(){\n}"))).toBe(2);
  });

  test("simple function with 3 code lines → 4 (incl. brace lines)", () => {
    // Counts every non-blank, non-comment-only line in the function span:
    // `function f(){`, `const x = 1;`, `return x;`, `}` = 4.
    const src = ["function f(){", "  const x = 1;", "  return x;", "}"].join(
      "\n",
    );
    expect(computeSloc(parseFn(src))).toBe(4);
  });

  test("blank lines between statements are not counted", () => {
    // 4 non-blank lines (header, const, return, `}`), blank line ignored.
    const src = [
      "function f(){",
      "  const x = 1;",
      "",
      "  return x;",
      "}",
    ].join("\n");
    expect(computeSloc(parseFn(src))).toBe(4);
  });

  test("line-comment alone on a line is not counted", () => {
    const src = [
      "function f(){",
      "  // just a comment",
      "  return 1;",
      "}",
    ].join("\n");
    expect(computeSloc(parseFn(src))).toBe(3);
  });

  test("block comment spanning 3 lines (comment only) contributes 0", () => {
    const src = [
      "function f(){",
      "  /*",
      "   * note",
      "   */",
      "  return 1;",
      "}",
    ].join("\n");
    expect(computeSloc(parseFn(src))).toBe(3);
  });

  test("inline block comment on a code line counts as 1 code line", () => {
    const src = ["function f(){", "  return /* x */ 1;", "}"].join("\n");
    expect(computeSloc(parseFn(src))).toBe(3);
  });

  test("arrow expression body single-line → 1", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      "const f = (x: number) => x + 1;",
    );
    const arrow = sf.getVariableDeclarationOrThrow("f").getInitializerOrThrow();
    expect(computeSloc(arrow as never)).toBe(1);
  });

  test("arrow with multi-line body with blanks", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      [
        "const f = (x: number) => {",
        "  const y = x;",
        "",
        "  return y;",
        "};",
      ].join("\n"),
    );
    const arrow = sf.getVariableDeclarationOrThrow("f").getInitializerOrThrow();
    expect(computeSloc(arrow as never)).toBe(4);
  });
});

describe("slocCollector", () => {
  test("returns a map of results keyed by declaration id", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/proj/src/a.ts",
      [
        "export function simple(){ return 1; }",
        "export function multi(x: number){",
        "  const y = x;",
        "  return y;",
        "}",
      ].join("\n"),
    );
    const declarations = enumerateDeclarations(project, "/proj");
    const result = slocCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });

    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("simple")?.sloc).toBe(1);
    expect(byName.get("multi")?.sloc).toBe(4);
  });
});
