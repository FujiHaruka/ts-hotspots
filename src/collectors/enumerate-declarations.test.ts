import { Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "./enumerate-declarations.ts";

function mkProject(files: Record<string, string>): Project {
  const project = new Project({ useInMemoryFileSystem: true });
  for (const [path, content] of Object.entries(files)) {
    project.createSourceFile(path, content);
  }
  return project;
}

describe("enumerateDeclarations", () => {
  test("collects function declarations, methods, constructor, getter, setter", () => {
    const project = mkProject({
      "/proj/src/a.ts": [
        "export function topLevel() { return 1; }",
        "export class C {",
        "  constructor() {}",
        "  method() { return 2; }",
        "  get prop() { return 3; }",
        "  set prop(v: number) { /* noop */ }",
        "}",
      ].join("\n"),
    });

    const decls = enumerateDeclarations(project, "/proj");
    const byKind = Object.fromEntries(
      decls.map((d) => [d.kind, d.name] as const),
    );

    expect(byKind.function).toBe("topLevel");
    expect(byKind.constructor).toBe("constructor");
    expect(byKind.method).toBe("method");
    expect(byKind.getter).toBe("prop");
    expect(byKind.setter).toBe("prop");
  });

  test("resolves arrow names via VariableDeclaration / PropertyAssignment / PropertyDeclaration", () => {
    const project = mkProject({
      "/proj/src/a.ts": [
        "const varArrow = () => 1;",
        "const obj = { propArrow: () => 2 };",
        "class K { fieldArrow = () => 3; }",
      ].join("\n"),
    });

    const decls = enumerateDeclarations(project, "/proj");
    const arrows = decls
      .filter((d) => d.kind === "arrow")
      .map((d) => d.name)
      .sort();

    expect(arrows).toEqual(["fieldArrow", "propArrow", "varArrow"]);
  });

  test("anonymous arrows passed as arguments resolve to <anonymous>", () => {
    const project = mkProject({
      "/proj/src/a.ts": [
        "declare function run(cb: () => void): void;",
        "run(() => { /* noop */ });",
      ].join("\n"),
    });

    const decls = enumerateDeclarations(project, "/proj");
    const arrow = decls.find((d) => d.kind === "arrow");
    expect(arrow?.name).toBe("<anonymous>");
  });

  test("HOF-wrapped arrow picks up the enclosing VariableDeclaration name", () => {
    const project = mkProject({
      "/proj/src/a.ts": [
        "declare function pipe<T>(...fns: T[]): (arg: T) => T;",
        "export const POST = pipe<() => number>()(() => 1);",
      ].join("\n"),
    });

    const decls = enumerateDeclarations(project, "/proj");
    const arrowNames = decls
      .filter((d) => d.kind === "arrow")
      .map((d) => d.name);
    expect(arrowNames).toEqual(["POST"]);
  });

  test("arrow assigned via BinaryExpression adopts LHS property name", () => {
    const project = mkProject({
      "/proj/src/a.ts": [
        "const exports: Record<string, unknown> = {};",
        "exports.handler = () => 1;",
      ].join("\n"),
    });

    const decls = enumerateDeclarations(project, "/proj");
    const arrow = decls.find((d) => d.kind === "arrow");
    expect(arrow?.name).toBe("handler");
  });

  test("arrow at `export default` adopts `default`", () => {
    const project = mkProject({
      "/proj/src/a.ts": "export default () => 1;",
    });

    const decls = enumerateDeclarations(project, "/proj");
    const arrow = decls.find((d) => d.kind === "arrow");
    expect(arrow?.name).toBe("default");
  });

  test("arrow wrapped in `as` / `satisfies` / `!` still resolves to binding", () => {
    const project = mkProject({
      "/proj/src/a.ts": [
        "const asArrow = (() => 1) as () => number;",
        "const satisfiesArrow = (() => 2) satisfies () => number;",
        "const nonNullArrow = ((() => 3) as (() => number) | null)!;",
      ].join("\n"),
    });

    const decls = enumerateDeclarations(project, "/proj");
    const arrows = decls
      .filter((d) => d.kind === "arrow")
      .map((d) => d.name)
      .sort();
    expect(arrows).toEqual(["asArrow", "nonNullArrow", "satisfiesArrow"]);
  });

  test("skips ambient `declare function` (no body)", () => {
    const project = mkProject({
      "/proj/src/a.ts": [
        "declare function ambient(): void;",
        "export function real() { return 1; }",
      ].join("\n"),
    });

    const decls = enumerateDeclarations(project, "/proj");
    expect(decls.map((d) => d.name)).toEqual(["real"]);
  });

  test("skips .d.ts files", () => {
    const project = mkProject({
      "/proj/src/a.d.ts": "export declare function stub(): void;",
      "/proj/src/b.ts": "export function real() {}",
    });

    const decls = enumerateDeclarations(project, "/proj");
    expect(decls.map((d) => d.name)).toEqual(["real"]);
  });

  test("skips files outside rootDir", () => {
    const project = mkProject({
      "/proj/src/a.ts": "export function inRoot() {}",
      "/other/src/b.ts": "export function outside() {}",
    });

    const decls = enumerateDeclarations(project, "/proj");
    expect(decls.map((d) => d.name)).toEqual(["inRoot"]);
  });

  test("skips node_modules paths", () => {
    const project = mkProject({
      "/proj/src/a.ts": "export function real() {}",
      "/proj/node_modules/lib/index.ts": "export function fromDep() {}",
    });

    const decls = enumerateDeclarations(project, "/proj");
    expect(decls.map((d) => d.name)).toEqual(["real"]);
  });

  test("nested functions are each their own Declaration", () => {
    const project = mkProject({
      "/proj/src/a.ts": [
        "export function outer() {",
        "  function inner() { return 1; }",
        "  return inner();",
        "}",
      ].join("\n"),
    });

    const decls = enumerateDeclarations(project, "/proj");
    expect(decls.map((d) => d.name).sort()).toEqual(["inner", "outer"]);
  });

  test("skips files matching exclude globs", () => {
    const project = mkProject({
      "/proj/src/a.ts": "export function real() {}",
      "/proj/src/a.test.ts": "export function testFn() {}",
      "/proj/src/a.spec.tsx": "export function specFn() {}",
      "/proj/src/nested/b.test.ts": "export function nestedTest() {}",
    });

    const decls = enumerateDeclarations(project, "/proj", {
      exclude: ["**/*.{test,spec}.{ts,tsx,mts,cts}"],
    });
    expect(decls.map((d) => d.name)).toEqual(["real"]);
  });

  test("empty exclude list keeps every file", () => {
    const project = mkProject({
      "/proj/src/a.ts": "export function real() {}",
      "/proj/src/a.test.ts": "export function testFn() {}",
    });

    const decls = enumerateDeclarations(project, "/proj", { exclude: [] });
    expect(decls.map((d) => d.name).sort()).toEqual(["real", "testFn"]);
  });

  test("ids are deterministic and file paths are POSIX-relative", () => {
    const project = mkProject({
      "/proj/src/a.ts": "export function f() {}",
    });

    const [decl] = enumerateDeclarations(project, "/proj");
    expect(decl?.file).toBe("src/a.ts");
    expect(decl?.id.startsWith("src/a.ts:")).toBe(true);
    expect(decl?.line).toBe(1);
  });
});
