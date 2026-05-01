import ts from "typescript";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import { mkSourceFiles } from "../internal/mkSourceFiles.test-helper.ts";
import {
  parseAllFunctionLikes,
  parseFirstFunctionLike,
} from "../internal/parseFirstFunctionLike.test-helper.ts";
import { awaitCountCollector, computeAwaitCount } from "./await-count.ts";

function compute(src: string): number {
  const { fn } = parseFirstFunctionLike(src);
  return computeAwaitCount(fn);
}

describe("computeAwaitCount", () => {
  test("sync function → 0", () => {
    expect(compute("function f(){ return 1; }")).toBe(0);
  });

  test("async with no await → 0", () => {
    expect(compute("async function f(){ return 1; }")).toBe(0);
  });

  test("single await → 1", () => {
    expect(
      compute("async function f(p: Promise<number>){ return await p; }"),
    ).toBe(1);
  });

  test("multiple awaits sum up", () => {
    expect(
      compute(
        "async function f(a: Promise<number>, b: Promise<number>){ const x = await a; const y = await b; return x + y; }",
      ),
    ).toBe(2);
  });

  test("for-await-of adds 1", () => {
    expect(
      compute(
        "async function f(xs: AsyncIterable<number>){ for await (const x of xs) void x; }",
      ),
    ).toBe(1);
  });

  test("plain for-of does not count", () => {
    expect(
      compute("async function f(xs: number[]){ for (const x of xs) void x; }"),
    ).toBe(0);
  });

  test("for-await-of with inner await counts both", () => {
    expect(
      compute(
        "async function f(xs: AsyncIterable<Promise<number>>){ for await (const x of xs) { await x; } }",
      ),
    ).toBe(2);
  });

  test("nested function: inner awaits do not affect outer", () => {
    const { fns } = parseAllFunctionLikes(
      [
        "async function outer(){",
        "  async function inner(p: Promise<number>){ return await p; }",
        "  return inner;",
        "}",
      ].join("\n"),
    );
    const outer = fns.find(
      (f): f is ts.FunctionDeclaration =>
        f.kind === ts.SyntaxKind.FunctionDeclaration && f.name?.text === "outer",
    );
    const inner = fns.find(
      (f): f is ts.FunctionDeclaration =>
        f.kind === ts.SyntaxKind.FunctionDeclaration && f.name?.text === "inner",
    );
    if (!outer || !inner) throw new Error("functions not found");
    expect(computeAwaitCount(outer)).toBe(0);
    expect(computeAwaitCount(inner)).toBe(1);
  });
});

describe("awaitCountCollector", () => {
  test("returns a map keyed by declaration id", () => {
    const files = mkSourceFiles({
      "src/a.ts": [
        "export function sync(){ return 1; }",
        "export async function asyncy(p: Promise<number>){ return await p; }",
      ].join("\n"),
    });
    const declarations = enumerateDeclarations(files);
    const result = awaitCountCollector.collect({
      rootDir: "/proj",
      declarations,
    });
    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("sync")?.awaitCount).toBe(0);
    expect(byName.get("asyncy")?.awaitCount).toBe(1);
  });
});
