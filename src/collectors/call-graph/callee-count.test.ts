import { type FunctionDeclaration, Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import { calleeCountCollector, computeCalleeCount } from "./callee-count.ts";

function parseFn(src: string): FunctionDeclaration {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("/proj/t.ts", src);
  const fn = sf.getFunctions()[0];
  if (!fn) throw new Error("no function in source");
  return fn;
}

describe("computeCalleeCount", () => {
  test("empty function → 0", () => {
    expect(computeCalleeCount(parseFn("function f(){}"))).toBe(0);
  });

  test("single call → 1", () => {
    expect(computeCalleeCount(parseFn("function f(){ g(); }"))).toBe(1);
  });

  test("chained property access call counts once", () => {
    expect(computeCalleeCount(parseFn("function f(){ a.b.c(); }"))).toBe(1);
  });

  test("multiple calls sum up", () => {
    expect(computeCalleeCount(parseFn("function f(){ g(); h(); i(); }"))).toBe(
      3,
    );
  });

  test("optional call `foo?.()` is counted", () => {
    expect(
      computeCalleeCount(
        parseFn("function f(g?: () => void){ g?.(); return 1; }"),
      ),
    ).toBe(1);
  });

  test("NewExpression is not counted", () => {
    expect(
      computeCalleeCount(parseFn("function f(){ return new Error('x'); }")),
    ).toBe(0);
  });

  test("tagged template literal is not counted", () => {
    expect(computeCalleeCount(parseFn("function f(){ return tag`hi`; }"))).toBe(
      0,
    );
  });

  test("calls nested in expressions are counted", () => {
    expect(computeCalleeCount(parseFn("function f(){ return g(h()); }"))).toBe(
      2,
    );
  });

  test("nested function: inner calls do not affect outer", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      [
        "function outer(){",
        "  function inner(){ a(); b(); c(); }",
        "  return inner;",
        "}",
      ].join("\n"),
    );
    const outer = sf.getFunctionOrThrow("outer");
    const inner = outer.getFunctions()[0];
    if (!inner) throw new Error("inner not found");
    expect(computeCalleeCount(outer)).toBe(0);
    expect(computeCalleeCount(inner)).toBe(3);
  });

  test("super() and super.method() are counted", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      [
        "class B { m(){} }",
        "class D extends B { constructor(){ super(); super.m(); } }",
      ].join("\n"),
    );
    const ctor = sf.getClassOrThrow("D").getConstructors()[0];
    if (!ctor) throw new Error("ctor not found");
    expect(computeCalleeCount(ctor)).toBe(2);
  });
});

describe("calleeCountCollector", () => {
  test("returns a map keyed by declaration id", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/proj/src/a.ts",
      [
        "export function quiet(){ return 1; }",
        "export function noisy(){ a(); b(); return 0; }",
      ].join("\n"),
    );
    const declarations = enumerateDeclarations(project, "/proj");
    const result = calleeCountCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });
    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("quiet")?.calleeCount).toBe(0);
    expect(byName.get("noisy")?.calleeCount).toBe(2);
  });
});
