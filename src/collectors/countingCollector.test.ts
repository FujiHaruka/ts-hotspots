import ts from "typescript";
import { describe, expect, test } from "vitest";
import { countMatches, makeCountingCollector } from "./countingCollector.ts";
import { enumerateDeclarations } from "./enumerate-declarations.ts";
import { mkSourceFiles } from "./internal/mkSourceFiles.test-helper.ts";
import { parseFirstFunctionLike } from "./internal/parseFirstFunctionLike.test-helper.ts";

describe("countMatches", () => {
  test("counts predicate hits in body", () => {
    const { fn } = parseFirstFunctionLike(
      "function f(){ a(); b(); c(); return 1; }",
    );
    const count = countMatches(
      fn,
      (node) => node.kind === ts.SyntaxKind.CallExpression,
    );
    expect(count).toBe(3);
  });

  test("excludes hits inside nested functions", () => {
    const { fn } = parseFirstFunctionLike(
      "function f(){ const g = () => { a(); b(); }; return g; }",
    );
    const count = countMatches(
      fn,
      (node) => node.kind === ts.SyntaxKind.CallExpression,
    );
    expect(count).toBe(0);
  });
});

describe("makeCountingCollector", () => {
  test("returns a collector keyed by resultKey", () => {
    const { collector } = makeCountingCollector({
      name: "thrown",
      resultKey: "thrown",
      matches: (n) => n.kind === ts.SyntaxKind.ThrowStatement,
    });
    const files = mkSourceFiles({
      "src/a.ts": [
        "export function quiet(){ return 1; }",
        "export function loud(){ throw new Error('x'); }",
      ].join("\n"),
    });
    const declarations = enumerateDeclarations(files);
    const result = collector.collect({ rootDir: "/proj", declarations });
    const byName = new Map(declarations.map((d) => [d.name, result.get(d.id)]));
    expect(byName.get("quiet")?.thrown).toBe(0);
    expect(byName.get("loud")?.thrown).toBe(1);
  });

  test("wraps predicate errors with collector name and decl coords", () => {
    const { collector } = makeCountingCollector({
      name: "boom",
      resultKey: "boom",
      matches: () => {
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

  test("exposes a count function that uses the same predicate", () => {
    const { count } = makeCountingCollector({
      name: "calls",
      resultKey: "calls",
      matches: (n) => n.kind === ts.SyntaxKind.CallExpression,
    });
    const { fn } = parseFirstFunctionLike(
      "function f(){ a(); b(); c(); return 1; }",
    );
    expect(count(fn)).toBe(3);
  });
});
