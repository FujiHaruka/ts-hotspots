import { type FunctionDeclaration, Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import {
  computeParameterCount,
  parameterCountCollector,
} from "./parameter-count.ts";

function parseFn(src: string): FunctionDeclaration {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("/proj/t.ts", src);
  const fn = sf.getFunctions()[0];
  if (!fn) throw new Error("no function in source");
  return fn;
}

describe("computeParameterCount", () => {
  test("no params → 0", () => {
    expect(computeParameterCount(parseFn("function f(){}"))).toBe(0);
  });

  test("two positional params → 2", () => {
    expect(
      computeParameterCount(parseFn("function f(a: number, b: number){}")),
    ).toBe(2);
  });

  test("default, optional, rest → counted", () => {
    expect(
      computeParameterCount(
        parseFn(
          "function f(a: number, b: number = 1, c?: number, ...rest: number[]){}",
        ),
      ),
    ).toBe(4);
  });

  test("destructured param counts as 1", () => {
    expect(
      computeParameterCount(
        parseFn("function f({ a, b }: { a: number; b: number }){}"),
      ),
    ).toBe(1);
  });

  test("generic function: type params excluded", () => {
    expect(
      computeParameterCount(parseFn("function f<T>(x: T){ return x; }")),
    ).toBe(1);
  });

  test("arrow no params → 0", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile("/proj/t.ts", "const f = () => 1;");
    const arrow = sf.getVariableDeclarationOrThrow("f").getInitializerOrThrow();
    expect(computeParameterCount(arrow as never)).toBe(0);
  });

  test("arrow one param → 1", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      "const f = (x: number) => x;",
    );
    const arrow = sf.getVariableDeclarationOrThrow("f").getInitializerOrThrow();
    expect(computeParameterCount(arrow as never)).toBe(1);
  });

  test("method in class", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      "class C { m(a: number, b: number){ return a + b; } }",
    );
    const cls = sf.getClassOrThrow("C");
    const method = cls.getInstanceMethodOrThrow("m");
    expect(computeParameterCount(method)).toBe(2);
  });
});

describe("parameterCountCollector", () => {
  test("returns a map of results keyed by declaration id", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/proj/src/a.ts",
      [
        "export function none(){ return 1; }",
        "export function two(a: number, b: number){ return a + b; }",
      ].join("\n"),
    );
    const declarations = enumerateDeclarations(project, "/proj");
    const result = parameterCountCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });

    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("none")?.parameterCount).toBe(0);
    expect(byName.get("two")?.parameterCount).toBe(2);
  });
});
