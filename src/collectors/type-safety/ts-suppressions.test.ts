import { type FunctionDeclaration, Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import {
  computeTsSuppressions,
  tsSuppressionsCollector,
} from "./ts-suppressions.ts";

function parseFn(src: string): FunctionDeclaration {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("/proj/t.ts", src);
  const fn = sf.getFunctions()[0];
  if (!fn) throw new Error("no function in source");
  return fn;
}

describe("computeTsSuppressions", () => {
  test("empty body → all zero", () => {
    expect(computeTsSuppressions(parseFn("function f(){}"))).toEqual({
      tsIgnoreCount: 0,
      tsExpectErrorCount: 0,
      tsNocheckCount: 0,
    });
  });

  test("no suppression comments → all zero", () => {
    expect(
      computeTsSuppressions(
        parseFn("function f(){ // normal comment\n return 1; }"),
      ),
    ).toEqual({
      tsIgnoreCount: 0,
      tsExpectErrorCount: 0,
      tsNocheckCount: 0,
    });
  });

  test("single @ts-ignore line comment", () => {
    expect(
      computeTsSuppressions(
        parseFn(
          "function f(x: number){\n  // @ts-ignore\n  x.foo();\n  return 0;\n}",
        ),
      ),
    ).toEqual({
      tsIgnoreCount: 1,
      tsExpectErrorCount: 0,
      tsNocheckCount: 0,
    });
  });

  test("single @ts-expect-error line comment", () => {
    expect(
      computeTsSuppressions(
        parseFn(
          "function f(x: number){\n  // @ts-expect-error\n  x.foo();\n  return 0;\n}",
        ),
      ),
    ).toEqual({
      tsIgnoreCount: 0,
      tsExpectErrorCount: 1,
      tsNocheckCount: 0,
    });
  });

  test("multiple suppressions of mixed kinds", () => {
    expect(
      computeTsSuppressions(
        parseFn(
          [
            "function f(x: number){",
            "  // @ts-ignore",
            "  x.foo();",
            "  // @ts-expect-error",
            "  x.bar();",
            "  // @ts-ignore",
            "  x.baz();",
            "  return 0;",
            "}",
          ].join("\n"),
        ),
      ),
    ).toEqual({
      tsIgnoreCount: 2,
      tsExpectErrorCount: 1,
      tsNocheckCount: 0,
    });
  });

  test("block comment with @ts-ignore counts", () => {
    expect(
      computeTsSuppressions(
        parseFn(
          [
            "function f(x: number){",
            "  /* @ts-ignore */",
            "  x.foo();",
            "  return 0;",
            "}",
          ].join("\n"),
        ),
      ),
    ).toEqual({
      tsIgnoreCount: 1,
      tsExpectErrorCount: 0,
      tsNocheckCount: 0,
    });
  });

  test("block comment containing @ts-nocheck inside function body counts", () => {
    expect(
      computeTsSuppressions(
        parseFn(
          [
            "function f(x: number){",
            "  /* @ts-nocheck */",
            "  return x;",
            "}",
          ].join("\n"),
        ),
      ),
    ).toEqual({
      tsIgnoreCount: 0,
      tsExpectErrorCount: 0,
      tsNocheckCount: 1,
    });
  });

  test("comment with @ts-ignore outside function body is not counted", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      ["// @ts-ignore", "function f(x: number){", "  return x;", "}"].join(
        "\n",
      ),
    );
    const fn = sf.getFunctionOrThrow("f");
    expect(computeTsSuppressions(fn)).toEqual({
      tsIgnoreCount: 0,
      tsExpectErrorCount: 0,
      tsNocheckCount: 0,
    });
  });

  test("@ts-nocheck at file top is not counted for any function", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      ["// @ts-nocheck", "function f(x: number){", "  return x;", "}"].join(
        "\n",
      ),
    );
    const fn = sf.getFunctionOrThrow("f");
    expect(computeTsSuppressions(fn)).toEqual({
      tsIgnoreCount: 0,
      tsExpectErrorCount: 0,
      tsNocheckCount: 0,
    });
  });

  test("suppressions inside nested function do not count for outer", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      [
        "function outer(x: number){",
        "  function inner(y: number){",
        "    // @ts-ignore",
        "    return (y as any).foo;",
        "  }",
        "  return inner(x);",
        "}",
      ].join("\n"),
    );
    const outer = sf.getFunctionOrThrow("outer");
    const inner = outer.getFunctions()[0];
    if (!inner) throw new Error("inner not found");
    expect(computeTsSuppressions(outer)).toEqual({
      tsIgnoreCount: 0,
      tsExpectErrorCount: 0,
      tsNocheckCount: 0,
    });
    expect(computeTsSuppressions(inner)).toEqual({
      tsIgnoreCount: 1,
      tsExpectErrorCount: 0,
      tsNocheckCount: 0,
    });
  });

  test("same comment text is not double-counted across adjacent nodes", () => {
    // A leading comment attached to an expression statement may be surfaced
    // when visiting both the statement and its children; dedupe by pos.
    expect(
      computeTsSuppressions(
        parseFn(
          [
            "function f(x: number){",
            "  // @ts-ignore",
            "  x.toString().length;",
            "  return 0;",
            "}",
          ].join("\n"),
        ),
      ),
    ).toEqual({
      tsIgnoreCount: 1,
      tsExpectErrorCount: 0,
      tsNocheckCount: 0,
    });
  });

  test("arrow with expression body — leading comment on expression counts", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      ["const f = (x: number) =>", "  // @ts-ignore", "  (x as any).foo;"].join(
        "\n",
      ),
    );
    const arrow = sf.getVariableDeclarationOrThrow("f").getInitializerOrThrow();
    expect(computeTsSuppressions(arrow as never)).toEqual({
      tsIgnoreCount: 1,
      tsExpectErrorCount: 0,
      tsNocheckCount: 0,
    });
  });
});

describe("tsSuppressionsCollector", () => {
  test("returns a map of results keyed by declaration id", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/proj/src/a.ts",
      [
        "export function clean(){ return 1; }",
        "export function dirty(x: number){",
        "  // @ts-ignore",
        "  x.foo();",
        "  // @ts-expect-error",
        "  x.bar();",
        "  return 0;",
        "}",
      ].join("\n"),
    );
    const declarations = enumerateDeclarations(project, "/proj");
    const result = tsSuppressionsCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });

    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("clean")).toEqual({
      tsIgnoreCount: 0,
      tsExpectErrorCount: 0,
      tsNocheckCount: 0,
    });
    expect(byName.get("dirty")).toEqual({
      tsIgnoreCount: 1,
      tsExpectErrorCount: 1,
      tsNocheckCount: 0,
    });
  });
});
