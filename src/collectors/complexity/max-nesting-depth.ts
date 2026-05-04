import ts from "typescript";
import { makeCollector } from "../makeCollector.ts";
import type { FunctionLikeNode } from "../types.ts";
import { getFunctionBody, NESTED_FUNCTION_KINDS } from "../walk.ts";

export interface MaxNestingDepthResult {
  maxNestingDepth: number;
}

export function computeMaxNestingDepth(node: FunctionLikeNode): number {
  const body = getFunctionBody(node);
  if (!body) return 0;

  let max = 0;
  const walk = (n: ts.Node, depth: number): void => {
    if (depth > max) max = depth;
    const kind = n.kind;

    if (kind === ts.SyntaxKind.IfStatement) {
      const ifStmt = n as ts.IfStatement;
      walk(ifStmt.thenStatement, depth + 1);
      const elseStmt = ifStmt.elseStatement;
      if (elseStmt) walk(elseStmt, depth + 1);
      return;
    }

    if (
      kind === ts.SyntaxKind.ForStatement ||
      kind === ts.SyntaxKind.ForInStatement ||
      kind === ts.SyntaxKind.ForOfStatement ||
      kind === ts.SyntaxKind.WhileStatement ||
      kind === ts.SyntaxKind.DoStatement
    ) {
      const stmt = n as
        | ts.ForStatement
        | ts.ForInStatement
        | ts.ForOfStatement
        | ts.WhileStatement
        | ts.DoStatement;
      walk(stmt.statement, depth + 1);
      return;
    }

    if (kind === ts.SyntaxKind.SwitchStatement) {
      const sw = n as ts.SwitchStatement;
      walk(sw.caseBlock, depth + 1);
      return;
    }

    if (kind === ts.SyntaxKind.TryStatement) {
      const tryStmt = n as ts.TryStatement;
      walk(tryStmt.tryBlock, depth + 1);
      if (tryStmt.catchClause) walk(tryStmt.catchClause, depth + 1);
      if (tryStmt.finallyBlock) walk(tryStmt.finallyBlock, depth + 1);
      return;
    }

    // Generic descent, stopping at nested function-like nodes.
    ts.forEachChild(n, (child) => {
      if (NESTED_FUNCTION_KINDS.has(child.kind)) return;
      walk(child, depth);
    });
  };

  walk(body, 0);
  return max;
}

export const maxNestingDepthCollector = makeCollector<MaxNestingDepthResult>({
  name: "maxNestingDepth",
  compute: (decl) => ({
    maxNestingDepth: computeMaxNestingDepth(decl.node),
  }),
});
