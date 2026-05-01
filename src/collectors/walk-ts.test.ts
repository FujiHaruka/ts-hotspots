import { describe, expect, test } from "vitest";
import ts from "typescript";
import { parseSource } from "../parser/parseSource.ts";
import { walkBodyExcludingNestedFunctions } from "./walk-ts.ts";

function findFirstFunction(sourceFile: ts.SourceFile): ts.FunctionDeclaration {
  const fn = sourceFile.statements.find(
    (s): s is ts.FunctionDeclaration =>
      s.kind === ts.SyntaxKind.FunctionDeclaration,
  );
  if (!fn) throw new Error("no function found");
  return fn;
}

describe("walkBodyExcludingNestedFunctions", () => {
  test("visits the root and all descendants in the same function", () => {
    const { sourceFile } = parseSource(
      "a.ts",
      "function f() { if (true) { const x = 1; } }",
    );
    const fn = findFirstFunction(sourceFile);
    const body = fn.body;
    if (!body) throw new Error("no body");

    const kinds: ts.SyntaxKind[] = [];
    walkBodyExcludingNestedFunctions(body, (n) => kinds.push(n.kind));

    expect(kinds[0]).toBe(ts.SyntaxKind.Block); // root visited
    expect(kinds).toContain(ts.SyntaxKind.IfStatement);
    expect(kinds).toContain(ts.SyntaxKind.VariableDeclaration);
  });

  test("does not descend into nested function declarations", () => {
    const { sourceFile } = parseSource(
      "a.ts",
      `function outer() {
        function inner() {
          const shouldNotBeVisited = 1;
        }
        const outerVar = 2;
      }`,
    );
    const fn = findFirstFunction(sourceFile);
    const body = fn.body;
    if (!body) throw new Error("no body");

    const identifiers: string[] = [];
    walkBodyExcludingNestedFunctions(body, (n) => {
      if (n.kind === ts.SyntaxKind.Identifier) {
        identifiers.push((n as ts.Identifier).text);
      }
    });

    expect(identifiers).toContain("outerVar");
    // The nested function declaration is short-circuited entirely — neither
    // its name nor anything below it is visited.
    expect(identifiers).not.toContain("inner");
    expect(identifiers).not.toContain("shouldNotBeVisited");
  });

  test("does not descend into nested arrow / method / accessor / ctor", () => {
    const { sourceFile } = parseSource(
      "a.ts",
      `function outer() {
        const arrow = () => { const arrowInner = 1; };
        class C {
          method() { const methodInner = 2; }
          get prop() { const getterInner = 3; return 0; }
          set prop(v: number) { const setterInner = 4; }
          constructor() { const ctorInner = 5; }
        }
      }`,
    );
    const fn = findFirstFunction(sourceFile);
    const body = fn.body;
    if (!body) throw new Error("no body");

    const identifiers: string[] = [];
    walkBodyExcludingNestedFunctions(body, (n) => {
      if (n.kind === ts.SyntaxKind.Identifier) {
        identifiers.push((n as ts.Identifier).text);
      }
    });

    expect(identifiers).not.toContain("arrowInner");
    expect(identifiers).not.toContain("methodInner");
    expect(identifiers).not.toContain("getterInner");
    expect(identifiers).not.toContain("setterInner");
    expect(identifiers).not.toContain("ctorInner");
  });

  test("the body itself is visited even though it is a function-like child", () => {
    const { sourceFile } = parseSource("a.ts", "const f = () => { return 1; };");
    const stmt = sourceFile.statements[0] as ts.VariableStatement;
    const decl = stmt.declarationList.declarations[0];
    if (!decl) throw new Error("no declaration");
    const arrow = decl.initializer as ts.ArrowFunction;
    const body = arrow.body;

    const visited: ts.SyntaxKind[] = [];
    walkBodyExcludingNestedFunctions(body, (n) => visited.push(n.kind));

    // Even though the root is technically a function-like context, walk visits it.
    expect(visited.length).toBeGreaterThan(0);
    expect(visited).toContain(ts.SyntaxKind.ReturnStatement);
  });
});
