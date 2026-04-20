import { type Node, SyntaxKind } from "ts-morph";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeNode,
} from "../types.ts";

export interface MaxNestingDepthResult {
  maxNestingDepth: number;
}

const NESTED_FUNCTION_KINDS = new Set<SyntaxKind>([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.ArrowFunction,
  SyntaxKind.FunctionExpression,
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
  SyntaxKind.Constructor,
]);

export function computeMaxNestingDepth(node: FunctionLikeNode): number {
  const body = getBody(node);
  if (!body) return 0;

  let max = 0;
  const walk = (n: Node, depth: number): void => {
    if (depth > max) max = depth;
    const kind = n.getKind();

    if (kind === SyntaxKind.IfStatement) {
      const ifStmt = n.asKindOrThrow(SyntaxKind.IfStatement);
      const thenStmt = ifStmt.getThenStatement();
      walk(thenStmt, depth + 1);
      const elseStmt = ifStmt.getElseStatement();
      if (elseStmt) walk(elseStmt, depth + 1);
      return;
    }

    if (
      kind === SyntaxKind.ForStatement ||
      kind === SyntaxKind.ForInStatement ||
      kind === SyntaxKind.ForOfStatement ||
      kind === SyntaxKind.WhileStatement ||
      kind === SyntaxKind.DoStatement
    ) {
      const stmt = n as unknown as { getStatement(): Node };
      walk(stmt.getStatement(), depth + 1);
      return;
    }

    if (kind === SyntaxKind.SwitchStatement) {
      const sw = n.asKindOrThrow(SyntaxKind.SwitchStatement);
      walk(sw.getCaseBlock(), depth + 1);
      return;
    }

    if (kind === SyntaxKind.TryStatement) {
      const tryStmt = n.asKindOrThrow(SyntaxKind.TryStatement);
      walk(tryStmt.getTryBlock(), depth + 1);
      const catchClause = tryStmt.getCatchClause();
      if (catchClause) walk(catchClause, depth + 1);
      const finallyBlock = tryStmt.getFinallyBlock();
      if (finallyBlock) walk(finallyBlock, depth + 1);
      return;
    }

    // Generic descent, stopping at nested function-like nodes.
    for (const child of n.getChildren()) {
      if (NESTED_FUNCTION_KINDS.has(child.getKind())) continue;
      walk(child, depth);
    }
  };

  walk(body, 0);
  return max;
}

function getBody(node: FunctionLikeNode): Node | undefined {
  if (node.getKind() === SyntaxKind.ArrowFunction) {
    return node.asKindOrThrow(SyntaxKind.ArrowFunction).getBody();
  }
  return (node as unknown as { getBody(): Node | undefined }).getBody();
}

export const maxNestingDepthCollector: Collector<MaxNestingDepthResult> = {
  name: "maxNestingDepth",
  collect(ctx: CollectorContext): Map<DeclarationId, MaxNestingDepthResult> {
    const result = new Map<DeclarationId, MaxNestingDepthResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, {
          maxNestingDepth: computeMaxNestingDepth(decl.node),
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
