import { type Node, SyntaxKind } from "ts-morph";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeNode,
} from "../types.ts";
import { walkBodyExcludingNestedFunctions } from "../walk.ts";

export interface StatementCountResult {
  statementCount: number;
}

// Kinds considered statements for this metric. `Block` is intentionally
// excluded (it is a container rather than a standalone statement).
const STATEMENT_KINDS = new Set<SyntaxKind>([
  SyntaxKind.VariableStatement,
  SyntaxKind.ExpressionStatement,
  SyntaxKind.IfStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.ReturnStatement,
  SyntaxKind.SwitchStatement,
  SyntaxKind.ThrowStatement,
  SyntaxKind.TryStatement,
  SyntaxKind.BreakStatement,
  SyntaxKind.ContinueStatement,
  SyntaxKind.LabeledStatement,
  SyntaxKind.EmptyStatement,
  SyntaxKind.DebuggerStatement,
  SyntaxKind.WithStatement,
]);

export function computeStatementCount(node: FunctionLikeNode): number {
  const body = getBody(node);
  if (!body) return 0;

  // Arrow functions with an expression body: no statements.
  if (body.getKind() !== SyntaxKind.Block) return 0;

  let count = 0;
  walkBodyExcludingNestedFunctions(body, (n) => {
    if (n === body) return;
    if (STATEMENT_KINDS.has(n.getKind())) count += 1;
  });
  return count;
}

function getBody(node: FunctionLikeNode): Node | undefined {
  if (node.getKind() === SyntaxKind.ArrowFunction) {
    return node.asKindOrThrow(SyntaxKind.ArrowFunction).getBody();
  }
  return (node as unknown as { getBody(): Node | undefined }).getBody();
}

export const statementCountCollector: Collector<StatementCountResult> = {
  name: "statementCount",
  collect(ctx: CollectorContext): Map<DeclarationId, StatementCountResult> {
    const result = new Map<DeclarationId, StatementCountResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, {
          statementCount: computeStatementCount(decl.node),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `statementCountCollector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
          { cause: err },
        );
      }
    }
    return result;
  },
};
