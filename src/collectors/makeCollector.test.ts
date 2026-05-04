import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "./enumerate-declarations.ts";
import { mkSourceFiles } from "./internal/mkSourceFiles.test-helper.ts";
import { makeCollector } from "./makeCollector.ts";

describe("makeCollector", () => {
  test("runs compute over each declaration and keys by decl.id", () => {
    const collector = makeCollector<{ paramCount: number }>({
      name: "paramCount",
      compute: (decl) => ({ paramCount: decl.node.parameters.length }),
    });
    const files = mkSourceFiles({
      "src/a.ts": [
        "export function zero(){ return 1; }",
        "export function one(a: number){ return a; }",
        "export function three(a: number, b: number, c: number){ return a + b + c; }",
      ].join("\n"),
    });
    const declarations = enumerateDeclarations(files);
    const result = collector.collect({ rootDir: "/proj", declarations });
    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("zero")?.paramCount).toBe(0);
    expect(byName.get("one")?.paramCount).toBe(1);
    expect(byName.get("three")?.paramCount).toBe(3);
  });

  test("wraps compute errors with collector name and decl coords", () => {
    const collector = makeCollector<{ kaboom: number }>({
      name: "boom",
      compute: () => {
        throw new Error("kaboom");
      },
    });
    const files = mkSourceFiles({
      "src/a.ts": "export function f(){ return 1; }",
    });
    const declarations = enumerateDeclarations(files);
    expect(() => collector.collect({ rootDir: "/proj", declarations })).toThrow(
      /boomCollector failed at src\/a\.ts:1.*kaboom/,
    );
  });
});
