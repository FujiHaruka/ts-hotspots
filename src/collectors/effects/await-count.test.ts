import { type FunctionDeclaration, Project } from "ts-morph";
import { describe, expect, test } from "vitest";
import { enumerateDeclarations } from "../enumerate-declarations.ts";
import { awaitCountCollector, computeAwaitCount } from "./await-count.ts";

function parseFn(src: string): FunctionDeclaration {
  const project = new Project({ useInMemoryFileSystem: true });
  const sf = project.createSourceFile("/proj/t.ts", src);
  const fn = sf.getFunctions()[0];
  if (!fn) throw new Error("no function in source");
  return fn;
}

describe("computeAwaitCount", () => {
  test("sync function → 0", () => {
    expect(computeAwaitCount(parseFn("function f(){ return 1; }"))).toBe(0);
  });

  test("async with no await → 0", () => {
    expect(computeAwaitCount(parseFn("async function f(){ return 1; }"))).toBe(
      0,
    );
  });

  test("single await → 1", () => {
    expect(
      computeAwaitCount(
        parseFn("async function f(p: Promise<number>){ return await p; }"),
      ),
    ).toBe(1);
  });

  test("multiple awaits sum up", () => {
    expect(
      computeAwaitCount(
        parseFn(
          "async function f(a: Promise<number>, b: Promise<number>){ const x = await a; const y = await b; return x + y; }",
        ),
      ),
    ).toBe(2);
  });

  test("for-await-of adds 1", () => {
    expect(
      computeAwaitCount(
        parseFn(
          "async function f(xs: AsyncIterable<number>){ for await (const x of xs) void x; }",
        ),
      ),
    ).toBe(1);
  });

  test("plain for-of does not count", () => {
    expect(
      computeAwaitCount(
        parseFn(
          "async function f(xs: number[]){ for (const x of xs) void x; }",
        ),
      ),
    ).toBe(0);
  });

  test("for-await-of with inner await counts both", () => {
    expect(
      computeAwaitCount(
        parseFn(
          "async function f(xs: AsyncIterable<Promise<number>>){ for await (const x of xs) { await x; } }",
        ),
      ),
    ).toBe(2);
  });

  test("nested function: inner awaits do not affect outer", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    const sf = project.createSourceFile(
      "/proj/t.ts",
      [
        "async function outer(){",
        "  async function inner(p: Promise<number>){ return await p; }",
        "  return inner;",
        "}",
      ].join("\n"),
    );
    const outer = sf.getFunctionOrThrow("outer");
    const inner = outer.getFunctions()[0];
    if (!inner) throw new Error("inner not found");
    expect(computeAwaitCount(outer)).toBe(0);
    expect(computeAwaitCount(inner)).toBe(1);
  });
});

describe("awaitCountCollector", () => {
  test("returns a map keyed by declaration id", () => {
    const project = new Project({ useInMemoryFileSystem: true });
    project.createSourceFile(
      "/proj/src/a.ts",
      [
        "export function sync(){ return 1; }",
        "export async function asyncy(p: Promise<number>){ return await p; }",
      ].join("\n"),
    );
    const declarations = enumerateDeclarations(project, "/proj");
    const result = awaitCountCollector.collect({
      project,
      rootDir: "/proj",
      declarations,
    });
    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("sync")?.awaitCount).toBe(0);
    expect(byName.get("asyncy")?.awaitCount).toBe(1);
  });
});
