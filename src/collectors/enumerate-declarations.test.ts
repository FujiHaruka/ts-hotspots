import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "./enumerate-declarations.ts";
import { mkSourceFiles } from "./internal/mkSourceFiles.test-helper.ts";

describe("enumerateDeclarations", () => {
  test("collects function declarations, methods, constructor, getter, setter", () => {
    const files = mkSourceFiles({
      "src/a.ts": [
        "export function topLevel() { return 1; }",
        "export class C {",
        "  constructor() {}",
        "  method() { return 2; }",
        "  get prop() { return 3; }",
        "  set prop(v: number) { /* noop */ }",
        "}",
      ].join("\n"),
    });

    const decls = enumerateDeclarations(files);
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
    const files = mkSourceFiles({
      "src/a.ts": [
        "const varArrow = () => 1;",
        "const obj = { propArrow: () => 2 };",
        "class K { fieldArrow = () => 3; }",
      ].join("\n"),
    });

    const decls = enumerateDeclarations(files);
    const arrows = decls
      .filter((d) => d.kind === "arrow")
      .map((d) => d.name)
      .sort();

    expect(arrows).toEqual(["fieldArrow", "propArrow", "varArrow"]);
  });

  test("anonymous arrows passed as arguments resolve to <anonymous>", () => {
    const files = mkSourceFiles({
      "src/a.ts": [
        "declare function run(cb: () => void): void;",
        "run(() => { /* noop */ });",
      ].join("\n"),
    });

    const decls = enumerateDeclarations(files);
    const arrow = decls.find((d) => d.kind === "arrow");
    expect(arrow?.name).toBe("<anonymous>");
  });

  test("HOF-wrapped arrow picks up the enclosing VariableDeclaration name", () => {
    const files = mkSourceFiles({
      "src/a.ts": [
        "declare function pipe<T>(...fns: T[]): (arg: T) => T;",
        "export const POST = pipe<() => number>()(() => 1);",
      ].join("\n"),
    });

    const decls = enumerateDeclarations(files);
    const arrowNames = decls
      .filter((d) => d.kind === "arrow")
      .map((d) => d.name);
    expect(arrowNames).toEqual(["POST"]);
  });

  test("arrow assigned via BinaryExpression adopts LHS property name", () => {
    const files = mkSourceFiles({
      "src/a.ts": [
        "const exports: Record<string, unknown> = {};",
        "exports.handler = () => 1;",
      ].join("\n"),
    });

    const decls = enumerateDeclarations(files);
    const arrow = decls.find((d) => d.kind === "arrow");
    expect(arrow?.name).toBe("handler");
  });

  test("arrow at `export default` adopts `default`", () => {
    const files = mkSourceFiles({
      "src/a.ts": "export default () => 1;",
    });

    const decls = enumerateDeclarations(files);
    const arrow = decls.find((d) => d.kind === "arrow");
    expect(arrow?.name).toBe("default");
  });

  test("arrow wrapped in `as` / `satisfies` / `!` still resolves to binding", () => {
    const files = mkSourceFiles({
      "src/a.ts": [
        "const asArrow = (() => 1) as () => number;",
        "const satisfiesArrow = (() => 2) satisfies () => number;",
        "const nonNullArrow = ((() => 3) as (() => number) | null)!;",
      ].join("\n"),
    });

    const decls = enumerateDeclarations(files);
    const arrows = decls
      .filter((d) => d.kind === "arrow")
      .map((d) => d.name)
      .sort();
    expect(arrows).toEqual(["asArrow", "nonNullArrow", "satisfiesArrow"]);
  });

  test("skips ambient `declare function` (no body)", () => {
    const files = mkSourceFiles({
      "src/a.ts": [
        "declare function ambient(): void;",
        "export function real() { return 1; }",
      ].join("\n"),
    });

    const decls = enumerateDeclarations(files);
    expect(decls.map((d) => d.name)).toEqual(["real"]);
  });

  test("skips .d.ts files", () => {
    const files = mkSourceFiles({
      "src/a.d.ts": "export declare function stub(): void;",
      "src/b.ts": "export function real() {}",
    });

    const decls = enumerateDeclarations(files);
    expect(decls.map((d) => d.name)).toEqual(["real"]);
  });

  test("skips node_modules paths", () => {
    const files = mkSourceFiles({
      "src/a.ts": "export function real() {}",
      "node_modules/lib/index.ts": "export function fromDep() {}",
    });

    const decls = enumerateDeclarations(files);
    expect(decls.map((d) => d.name)).toEqual(["real"]);
  });

  test("nested functions are each their own Declaration", () => {
    const files = mkSourceFiles({
      "src/a.ts": [
        "export function outer() {",
        "  function inner() { return 1; }",
        "  return inner();",
        "}",
      ].join("\n"),
    });

    const decls = enumerateDeclarations(files);
    expect(decls.map((d) => d.name).sort()).toEqual(["inner", "outer"]);
  });

  test("skips files matching exclude globs", () => {
    const files = mkSourceFiles({
      "src/a.ts": "export function real() {}",
      "src/a.test.ts": "export function testFn() {}",
      "src/a.spec.tsx": "export function specFn() {}",
      "src/nested/b.test.ts": "export function nestedTest() {}",
    });

    const decls = enumerateDeclarations(files, {
      exclude: ["**/*.{test,spec}.{ts,tsx,mts,cts}"],
    });
    expect(decls.map((d) => d.name)).toEqual(["real"]);
  });

  test("empty exclude list keeps every file", () => {
    const files = mkSourceFiles({
      "src/a.ts": "export function real() {}",
      "src/a.test.ts": "export function testFn() {}",
    });

    const decls = enumerateDeclarations(files, { exclude: [] });
    expect(decls.map((d) => d.name).sort()).toEqual(["real", "testFn"]);
  });

  test("ids are deterministic and file paths are POSIX-relative", () => {
    const files = mkSourceFiles({
      "src/a.ts": "export function f() {}",
    });

    const [decl] = enumerateDeclarations(files);
    expect(decl?.file).toBe("src/a.ts");
    expect(decl?.id.startsWith("src/a.ts:")).toBe(true);
    expect(decl?.line).toBe(1);
  });
});
