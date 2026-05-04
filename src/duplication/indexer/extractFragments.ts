import ts from "typescript";
import type { ParsedSource } from "../../parser/parseSource.ts";
import type { Config } from "../config/config.ts";
import type { Fragment, FragmentKind } from "../domain/fragment.ts";
import { FragmentIdAllocator } from "./internal/fragmentId.ts";

/**
 * Extract Type-3 duplication candidate fragments from a parsed source.
 *
 * Three granularities are emitted, all nested occurrences included:
 *
 * 1. **function**: function / method / arrow / ctor / getter / setter /
 *    function expression. Nodes without a body (ambient / abstract) are
 *    skipped.
 * 2. **block**: `if`, `for` (+ `for-in` / `for-of`), `while`, `do-while`,
 *    `try`, `catch`, `switch`. Both outer and inner matches are emitted.
 * 3. **window**: sliding windows over the `statements` array of
 *    `SourceFile`, `Block`, `ModuleBlock`, `CaseClause`, `DefaultClause`.
 *
 * Visit order is the same as `ts.forEachChild`, giving deterministic output.
 */
export function extractFragments(
  parsed: ParsedSource,
  config: Config,
): Fragment[] {
  const { filePath, sourceFile } = parsed;
  const fragments: Fragment[] = [];
  const idAllocator = new FragmentIdAllocator(filePath);

  const emit = (
    node: ts.Node,
    kind: FragmentKind,
    astNodeKind: string,
  ): void => {
    const start = node.getStart(sourceFile);
    const end = node.getEnd();
    const startLine =
      ts.getLineAndCharacterOfPosition(sourceFile, start).line + 1;
    const endLine = ts.getLineAndCharacterOfPosition(sourceFile, end).line + 1;
    const id = idAllocator.allocate(startLine, endLine, kind);
    fragments.push({
      id,
      filePath,
      startLine,
      endLine,
      kind,
      text: sourceFile.text.slice(start, end),
      astNodeKind,
    });
  };

  const emitWindow = (
    firstStatement: ts.Statement,
    lastStatement: ts.Statement,
  ): void => {
    const start = firstStatement.getStart(sourceFile);
    const end = lastStatement.getEnd();
    const startLine =
      ts.getLineAndCharacterOfPosition(sourceFile, start).line + 1;
    const endLine = ts.getLineAndCharacterOfPosition(sourceFile, end).line + 1;
    const id = idAllocator.allocate(startLine, endLine, "window");
    fragments.push({
      id,
      filePath,
      startLine,
      endLine,
      kind: "window",
      text: sourceFile.text.slice(start, end),
      astNodeKind: "StatementWindow",
    });
  };

  const emitWindowsForStatements = (
    statements: readonly ts.Statement[],
  ): void => {
    const n = statements.length;
    if (n < 2) {
      return;
    }
    const sizes = config.fragment.statementWindowSizes;
    const stride = config.fragment.statementWindowStride;
    if (sizes.length === 0 || stride <= 0) {
      return;
    }
    const minSize = Math.min(...sizes);

    // Pure import / re-export statements carry no logic and are a known
    // source of false positives (barrel files, header import blocks):
    // they collapse to identical token n-grams and matching
    // `ImportDeclaration` / `ExportDeclaration` statement-kind n-grams.
    // Trim them off the leading and trailing edges of every emitted
    // window so adjacent import blocks don't bleed into the indexed
    // text. Structural statements in the middle are left intact —
    // mixed-interior windows are rare in real TS code, and splitting
    // them would complicate dedup without buying much.
    const structuralOnly: boolean[] = statements.map(isStructuralOnlyStatement);

    // Dedup by trimmed `(firstIdx, lastIdx)` span: trimming can collapse
    // two raw ranges (different sizes, or stride vs tail) to the same
    // pair, which would otherwise emit multiple fragments for one line
    // range.
    const emittedSpans = new Set<string>();
    const tryEmit = (rawStart: number, rawEndExclusive: number): void => {
      let first = rawStart;
      let last = rawEndExclusive - 1;
      while (first <= last && structuralOnly[first] === true) {
        first++;
      }
      while (last >= first && structuralOnly[last] === true) {
        last--;
      }
      if (last - first + 1 < 2) {
        return;
      }
      const key = `${String(first)}-${String(last)}`;
      if (emittedSpans.has(key)) {
        return;
      }
      emittedSpans.add(key);
      const firstStmt = statements[first];
      const lastStmt = statements[last];
      if (firstStmt !== undefined && lastStmt !== undefined) {
        emitWindow(firstStmt, lastStmt);
      }
    };

    // Short-block fallback: if there are fewer statements than the
    // smallest configured size, treat the whole block as one window.
    if (n < minSize) {
      tryEmit(0, n);
      return;
    }

    for (const size of sizes) {
      if (n < size) {
        continue;
      }
      let lastStart = -1;
      for (let start = 0; start + size <= n; start += stride) {
        tryEmit(start, start + size);
        lastStart = start;
      }
      // Tail fallback: ensure the last statement is covered. Dedup via
      // `emittedSpans` makes this safe even when the tail span coincides
      // with a window already emitted in the stride loop.
      const tailStart = n - size;
      if (tailStart > lastStart) {
        tryEmit(tailStart, n);
      }
    }
  };

  const visit = (node: ts.Node): void => {
    // function-like fragments
    if (isFunctionLike(node)) {
      if (hasBody(node)) {
        emit(node, "function", ts.SyntaxKind[node.kind]);
      }
    }

    // block fragments
    if (isBlockLike(node)) {
      emit(node, "block", ts.SyntaxKind[node.kind]);
    }

    // window fragments: any node with a `statements` array (SourceFile,
    // Block, ModuleBlock, CaseClause, DefaultClause).
    const statements = getStatementsIfAny(node);
    if (statements !== undefined) {
      emitWindowsForStatements(statements);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return fragments;
}

function isFunctionLike(node: ts.Node): boolean {
  switch (node.kind) {
    case ts.SyntaxKind.FunctionDeclaration:
    case ts.SyntaxKind.MethodDeclaration:
    case ts.SyntaxKind.ArrowFunction:
    case ts.SyntaxKind.FunctionExpression:
    case ts.SyntaxKind.Constructor:
    case ts.SyntaxKind.GetAccessor:
    case ts.SyntaxKind.SetAccessor:
      return true;
    default:
      return false;
  }
}

interface MaybeHasBody {
  body?: ts.Node;
}

function hasBody(node: ts.Node): boolean {
  // All function-like nodes that can have a body expose it as `.body`.
  // Ambient / abstract declarations have `body === undefined`.
  return (node as MaybeHasBody).body !== undefined;
}

function isBlockLike(node: ts.Node): boolean {
  switch (node.kind) {
    case ts.SyntaxKind.IfStatement:
    case ts.SyntaxKind.ForStatement:
    case ts.SyntaxKind.ForInStatement:
    case ts.SyntaxKind.ForOfStatement:
    case ts.SyntaxKind.WhileStatement:
    case ts.SyntaxKind.DoStatement:
    case ts.SyntaxKind.TryStatement:
    case ts.SyntaxKind.CatchClause:
    case ts.SyntaxKind.SwitchStatement:
      return true;
    default:
      return false;
  }
}

function isStructuralOnlyStatement(stmt: ts.Statement): boolean {
  switch (stmt.kind) {
    case ts.SyntaxKind.ImportDeclaration:
    case ts.SyntaxKind.ExportDeclaration:
    case ts.SyntaxKind.ImportEqualsDeclaration:
    case ts.SyntaxKind.ExportAssignment:
      return true;
    case ts.SyntaxKind.ExpressionStatement: {
      // ECMAScript directive prologue (`"use client"`, `"use strict"`, …)
      // parses as `ExpressionStatement(StringLiteral)`. Treat it like an
      // import edge so a leading directive does not block the trim loop
      // from reaching the imports that usually follow.
      const expr = (stmt as ts.ExpressionStatement).expression;
      return ts.isStringLiteral(expr);
    }
    default:
      return false;
  }
}

function getStatementsIfAny(
  node: ts.Node,
): readonly ts.Statement[] | undefined {
  switch (node.kind) {
    case ts.SyntaxKind.SourceFile:
      return (node as ts.SourceFile).statements;
    case ts.SyntaxKind.Block:
      return (node as ts.Block).statements;
    case ts.SyntaxKind.ModuleBlock:
      return (node as ts.ModuleBlock).statements;
    case ts.SyntaxKind.CaseClause:
      return (node as ts.CaseClause).statements;
    case ts.SyntaxKind.DefaultClause:
      return (node as ts.DefaultClause).statements;
    default:
      return undefined;
  }
}
