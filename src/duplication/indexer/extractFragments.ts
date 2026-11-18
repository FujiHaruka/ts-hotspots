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
 * 3. **window**: sliding windows over the `statements` array of `Block`,
 *    `ModuleBlock`, `CaseClause`, `DefaultClause`. A file's top-level
 *    statements are not windowed: they are declarations whose bodies are
 *    already function fragments, and a window over several of them only
 *    absorbs those function-level matches into one oversized pair.
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

    const emittedSpans = new Set<string>();
    const tryEmit = (first: number, endExclusive: number): void => {
      const key = `${String(first)}-${String(endExclusive)}`;
      if (emittedSpans.has(key)) {
        return;
      }
      emittedSpans.add(key);
      const firstStmt = statements[first];
      const lastStmt = statements[endExclusive - 1];
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

    // window fragments: Block, ModuleBlock, CaseClause, DefaultClause.
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

function getStatementsIfAny(
  node: ts.Node,
): readonly ts.Statement[] | undefined {
  switch (node.kind) {
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
