import { Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import { enumerateSourceFiles } from "../enumerate-source-files.ts";
import { callerCountCollector } from "./caller-count.ts";

function runCollector(files: Record<string, string>, rootDir: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [path, content] of Object.entries(files)) {
    project.createSourceFile(path, content);
  }
  const sourceFiles = enumerateSourceFiles(project, rootDir);
  const declarations = enumerateDeclarations(project, rootDir, {
    files: sourceFiles,
  });
  const result = callerCountCollector.collect({
    project,
    rootDir,
    declarations,
    files: sourceFiles,
  });
  const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
  return { byName, declarations, result };
}

describe("callerCountCollector", () => {
  test("uncalled function → 0", () => {
    const { byName } = runCollector(
      { "/proj/src/a.ts": "export function foo(){ return 1; }" },
      "/proj",
    );
    expect(byName.get("foo")?.callerCount).toBe(0);
  });

  test("direct calls in same file count", () => {
    const { byName } = runCollector(
      {
        "/proj/src/a.ts": [
          "export function foo(){ return 1; }",
          "export function user(){ foo(); foo(); return 0; }",
        ].join("\n"),
      },
      "/proj",
    );
    expect(byName.get("foo")?.callerCount).toBe(2);
  });

  test("cross-file calls count", () => {
    const { byName } = runCollector(
      {
        "/proj/src/a.ts": "export function foo(){ return 1; }",
        "/proj/src/b.ts": [
          "import { foo } from './a.ts';",
          "export function bar(){ foo(); return 0; }",
        ].join("\n"),
      },
      "/proj",
    );
    expect(byName.get("foo")?.callerCount).toBe(1);
  });

  test("`obj.foo()` via property access counts", () => {
    const { byName } = runCollector(
      {
        "/proj/src/a.ts": [
          "export const obj = {",
          "  foo(){ return 1; },",
          "};",
          "export function user(){ obj.foo(); return obj.foo(); }",
        ].join("\n"),
      },
      "/proj",
    );
    expect(byName.get("foo")?.callerCount).toBe(2);
  });

  test("passing as a value (not calling) does not count", () => {
    const { byName } = runCollector(
      {
        "/proj/src/a.ts": [
          "export function foo(){ return 1; }",
          "export function user(){ const xs = [1,2].map(foo); return xs; }",
        ].join("\n"),
      },
      "/proj",
    );
    expect(byName.get("foo")?.callerCount).toBe(0);
  });

  test("recursion counts the self-call", () => {
    const { byName } = runCollector(
      {
        "/proj/src/a.ts":
          "export function foo(n: number): number { return n > 0 ? foo(n - 1) : 0; }",
      },
      "/proj",
    );
    expect(byName.get("foo")?.callerCount).toBe(1);
  });

  test("arrow assigned to const: call counts; raw reference does not", () => {
    const { byName } = runCollector(
      {
        "/proj/src/a.ts": [
          "export const foo = () => 1;",
          "export function user(){ foo(); const ref = foo; return ref; }",
        ].join("\n"),
      },
      "/proj",
    );
    expect(byName.get("foo")?.callerCount).toBe(1);
  });

  test("anonymous inline arrow → 0", () => {
    const { byName } = runCollector(
      {
        "/proj/src/a.ts":
          "export function user(xs: number[]){ return xs.map(x => x * 2); }",
      },
      "/proj",
    );
    expect(byName.get("<anonymous>")?.callerCount).toBe(0);
  });

  test("constructor: `new Foo()` counts toward Foo's constructor", () => {
    const { byName } = runCollector(
      {
        "/proj/src/a.ts": [
          "export class Foo { constructor(public x: number){} }",
          "export function user(){ new Foo(1); new Foo(2); return 0; }",
        ].join("\n"),
      },
      "/proj",
    );
    expect(byName.get("constructor")?.callerCount).toBe(2);
  });

  test("method declared on class: `obj.m()` counts", () => {
    const { byName } = runCollector(
      {
        "/proj/src/a.ts": [
          "export class C { m(){ return 1; } }",
          "export function user(c: C){ c.m(); c.m(); return 0; }",
        ].join("\n"),
      },
      "/proj",
    );
    expect(byName.get("m")?.callerCount).toBe(2);
  });

  test("calls from files outside the measured set are not counted", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/proj/src/a.ts",
      "export function foo(){ return 1; }",
    );
    project.createSourceFile(
      "/proj/src/a.test.ts",
      [
        "import { foo } from './a.ts';",
        "export function check(){ foo(); return 0; }",
      ].join("\n"),
    );
    const sourceFiles = enumerateSourceFiles(project, "/proj", {
      exclude: ["**/*.test.ts"],
    });
    const declarations = enumerateDeclarations(project, "/proj", {
      files: sourceFiles,
    });
    const result = callerCountCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
      files: sourceFiles,
    });
    const foo = declarations.find((d) => d.name === "foo");
    if (!foo) throw new Error("foo not found");
    expect(result.get(foo.id)?.callerCount).toBe(0);
  });
});
