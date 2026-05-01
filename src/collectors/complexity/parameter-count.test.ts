import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import { mkSourceFiles } from "../internal/mkSourceFiles.test-helper.ts";
import { parseFirstFunctionLike } from "../internal/parseFirstFunctionLike.test-helper.ts";
import {
  computeParameterCount,
  parameterCountCollector,
} from "./parameter-count.ts";

function compute(src: string): number {
  const { fn } = parseFirstFunctionLike(src);
  return computeParameterCount(fn);
}

describe("computeParameterCount", () => {
  test("no params → 0", () => {
    expect(compute("function f(){}")).toBe(0);
  });

  test("two positional params → 2", () => {
    expect(compute("function f(a: number, b: number){}")).toBe(2);
  });

  test("default, optional, rest → counted", () => {
    expect(
      compute(
        "function f(a: number, b: number = 1, c?: number, ...rest: number[]){}",
      ),
    ).toBe(4);
  });

  test("destructured param counts as 1", () => {
    expect(
      compute("function f({ a, b }: { a: number; b: number }){}"),
    ).toBe(1);
  });

  test("generic function: type params excluded", () => {
    expect(compute("function f<T>(x: T){ return x; }")).toBe(1);
  });

  test("arrow no params → 0", () => {
    expect(compute("const f = () => 1;")).toBe(0);
  });

  test("arrow one param → 1", () => {
    expect(compute("const f = (x: number) => x;")).toBe(1);
  });

  test("method in class", () => {
    expect(
      compute("class C { m(a: number, b: number){ return a + b; } }"),
    ).toBe(2);
  });
});

describe("parameterCountCollector", () => {
  test("returns a map of results keyed by declaration id", () => {
    const files = mkSourceFiles({
      "src/a.ts": [
        "export function none(){ return 1; }",
        "export function two(a: number, b: number){ return a + b; }",
      ].join("\n"),
    });
    const declarations = enumerateDeclarations(files);
    const result = parameterCountCollector.collect({
      rootDir: "/proj",
      declarations,
    });

    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("none")?.parameterCount).toBe(0);
    expect(byName.get("two")?.parameterCount).toBe(2);
  });
});
