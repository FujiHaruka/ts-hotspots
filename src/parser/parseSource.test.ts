import ts from "typescript";
import { describe, expect, test } from "vitest";
import { parseSource } from "./parseSource.ts";

describe("parseSource", () => {
  test("returns the source file path verbatim", () => {
    const { sourceFile, filePath } = parseSource("a.ts", "const x = 1;");
    expect(filePath).toBe("a.ts");
    expect(sourceFile.fileName).toBe("a.ts");
  });

  test("parses .tsx as TSX (JSX self-closing element becomes a JsxSelfClosingElement)", () => {
    const { sourceFile } = parseSource("ui.tsx", "const x = <div />;");
    const stmt = sourceFile.statements[0] as ts.VariableStatement;
    const init = stmt.declarationList.declarations[0]?.initializer;
    expect(init?.kind).toBe(ts.SyntaxKind.JsxSelfClosingElement);
  });

  test("parses .ts as plain TS (the same source is read as a type assertion, not JSX)", () => {
    const { sourceFile } = parseSource("a.ts", "const x = <div />;");
    const stmt = sourceFile.statements[0] as ts.VariableStatement;
    const init = stmt.declarationList.declarations[0]?.initializer;
    // In .ts, `<div />` is parsed as a TypeAssertionExpression (or fails to
    // parse cleanly) — never as a JSX element.
    expect(init?.kind).not.toBe(ts.SyntaxKind.JsxSelfClosingElement);
  });

  test("parses .mts and .cts as plain TS (no JSX recognition)", () => {
    const mts = parseSource("a.mts", "const x = <div />;").sourceFile
      .statements[0] as ts.VariableStatement;
    expect(mts.declarationList.declarations[0]?.initializer?.kind).not.toBe(
      ts.SyntaxKind.JsxSelfClosingElement,
    );
    const cts = parseSource("a.cts", "const x = <div />;").sourceFile
      .statements[0] as ts.VariableStatement;
    expect(cts.declarationList.declarations[0]?.initializer?.kind).not.toBe(
      ts.SyntaxKind.JsxSelfClosingElement,
    );
  });

  test("setParentNodes is enabled (node.parent is reachable)", () => {
    const { sourceFile } = parseSource("a.ts", "function f() { return 1; }");
    const fn = sourceFile.statements[0] as ts.FunctionDeclaration;
    expect(fn.parent).toBe(sourceFile);
  });
});
