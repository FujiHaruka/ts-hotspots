import { describe, expect, it } from "vitest";
import { parseSource } from "../../parser/parseSource.ts";
import { extractExports } from "./extractExports.ts";

function exportsOf(text: string) {
  const parsed = parseSource("src/x.ts", text);
  return extractExports(parsed);
}

describe("extractExports — local exports", () => {
  it("captures every common declaration kind", () => {
    const result = exportsOf(`
      export function fn() {}
      export class Cls {}
      export const c = 1;
      export type T = number;
      export interface I {}
      export enum E { A }
    `);
    const summary = [...result.local.values()].map((l) => ({
      name: l.exportName,
      kind: l.exportKind,
    }));
    expect(summary).toEqual([
      { name: "fn", kind: "function" },
      { name: "Cls", kind: "class" },
      { name: "c", kind: "const" },
      { name: "T", kind: "type" },
      { name: "I", kind: "interface" },
      { name: "E", kind: "enum" },
    ]);
  });

  it("emits one const per binding for `export const a = 1, b = 2`", () => {
    const result = exportsOf(`export const a = 1, b = 2;`);
    expect([...result.local.keys()]).toEqual(["a", "b"]);
  });

  it("captures `export default` of a named class as both name and 'default'", () => {
    const result = exportsOf(`export default class Foo {}`);
    expect([...result.local.keys()].sort()).toEqual(["Foo", "default"]);
    expect(result.local.get("default")?.exportKind).toBe("default");
  });

  it("captures `export default expr` as a single 'default' entry", () => {
    const result = exportsOf(`const x = 1; export default x;`);
    expect([...result.local.keys()]).toEqual(["default"]);
  });

  it("ignores `export = X` (CJS)", () => {
    const result = exportsOf(`const x = 1; export = x;`);
    expect(result.local.size).toBe(0);
  });

  it("promotes `const foo; export { foo };` into the local map", () => {
    const result = exportsOf(`const foo = 1; export { foo };`);
    expect(result.local.get("foo")?.exportKind).toBe("const");
  });

  it("promotes renamed bare `export { foo as bar };`", () => {
    const result = exportsOf(`const foo = 1; export { foo as bar };`);
    expect(result.local.get("bar")?.exportKind).toBe("const");
    // `foo` itself is not a public name without an explicit `export`.
    expect(result.local.has("foo")).toBe(false);
  });
});

describe("extractExports — re-exports", () => {
  it("collects `export { x } from '…'` into namedReexports", () => {
    const result = exportsOf(`export { foo, bar as baz } from './m';`);
    expect(result.namedReexports.get("foo")).toEqual({
      exportName: "foo",
      remoteName: "foo",
      moduleSpecifier: "./m",
      isTypeOnly: false,
    });
    expect(result.namedReexports.get("baz")).toEqual({
      exportName: "baz",
      remoteName: "bar",
      moduleSpecifier: "./m",
      isTypeOnly: false,
    });
  });

  it("collects `export * from '…'` into starReexports", () => {
    const result = exportsOf(`
      export * from './a';
      export * from './b';
    `);
    expect(result.starReexports.map((s) => s.moduleSpecifier)).toEqual([
      "./a",
      "./b",
    ]);
  });

  it("treats `export * as ns from '…'` as a star re-export", () => {
    const result = exportsOf(`export * as ns from './m';`);
    expect(result.starReexports[0]?.moduleSpecifier).toBe("./m");
  });

  it("propagates type-only flags from declaration and per-specifier", () => {
    const result = exportsOf(`
      export type { A } from './m';
      export { type B, C } from './n';
    `);
    expect(result.namedReexports.get("A")?.isTypeOnly).toBe(true);
    expect(result.namedReexports.get("B")?.isTypeOnly).toBe(true);
    expect(result.namedReexports.get("C")?.isTypeOnly).toBe(false);
  });
});

describe("extractExports — endLine", () => {
  it("captures the last line of multi-line function declarations", () => {
    const result = exportsOf(
      "export function fn() {\n  const x = 1;\n  return x;\n}\n",
    );
    const fn = result.local.get("fn");
    expect(fn?.line).toBe(1);
    expect(fn?.endLine).toBe(4);
  });

  it("captures multi-line classes including the closing brace line", () => {
    const result = exportsOf("export class Cls {\n  foo() {}\n  bar() {}\n}\n");
    const cls = result.local.get("Cls");
    expect(cls?.line).toBe(1);
    expect(cls?.endLine).toBe(4);
  });

  it("captures spans for `export const` arrow bodies", () => {
    const result = exportsOf("export const fn = () => {\n  return 1;\n};\n");
    const fn = result.local.get("fn");
    expect(fn?.line).toBe(1);
    expect(fn?.endLine).toBe(3);
  });

  it("treats single-line declarations as line === endLine", () => {
    const result = exportsOf(`export const PI = 3.14;`);
    const c = result.local.get("PI");
    expect(c?.line).toBe(1);
    expect(c?.endLine).toBe(1);
  });

  it("captures spans for type and interface declarations", () => {
    const result = exportsOf(
      "export type T =\n  | 'a'\n  | 'b';\nexport interface I {\n  x: number;\n}\n",
    );
    expect(result.local.get("T")?.line).toBe(1);
    expect(result.local.get("T")?.endLine).toBe(3);
    expect(result.local.get("I")?.line).toBe(4);
    expect(result.local.get("I")?.endLine).toBe(6);
  });

  it("captures spans for default exports of expressions", () => {
    const result = exportsOf(`const x = 1;\nexport default x;`);
    const def = result.local.get("default");
    expect(def?.line).toBe(2);
    expect(def?.endLine).toBe(2);
  });

  it("captures spans for `const foo; export { foo };` (pass-3 promotion)", () => {
    const result = exportsOf(
      "const foo = (x: number) => {\n  return x + 1;\n};\nexport { foo };\n",
    );
    const foo = result.local.get("foo");
    expect(foo?.line).toBe(1);
    expect(foo?.endLine).toBe(3);
  });
});
