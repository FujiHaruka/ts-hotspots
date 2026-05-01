import ts from "typescript";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeTsNode,
} from "../types.ts";

export interface MaxNestingDepthResult {
  maxNestingDepth: number;
}

const NESTED_FUNCTION_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.Constructor,
]);

export function computeMaxNestingDepth(node: FunctionLikeTsNode): number {
  const body = getBody(node);
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

function getBody(node: FunctionLikeTsNode): ts.Node | undefined {
  if (node.kind === ts.SyntaxKind.ArrowFunction) {
    return (node as ts.ArrowFunction).body;
  }
  return (node as Exclude<FunctionLikeTsNode, ts.ArrowFunction>).body;
}

export const maxNestingDepthCollector: Collector<MaxNestingDepthResult> = {
  name: "maxNestingDepth",
  collect(ctx: CollectorContext): Map<DeclarationId, MaxNestingDepthResult> {
    const result = new Map<DeclarationId, MaxNestingDepthResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, {
          maxNestingDepth: computeMaxNestingDepth(decl.tsNode),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `maxNestingDepthCollector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
          { cause: err },
        );
      }
    }
    return result;
  },
};
