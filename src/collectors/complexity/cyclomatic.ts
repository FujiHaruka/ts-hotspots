import { type Node, SyntaxKind } from "ts-morph";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeNode,
} from "../types.ts";
import { walkBodyExcludingNestedFunctions } from "../walk.ts";

export interface CyclomaticResult {
  cyclomaticComplexity: number;
}

const INCREMENT_KINDS = new Set<SyntaxKind>([
  SyntaxKind.IfStatement,
  SyntaxKind.ConditionalExpression,
  SyntaxKind.CaseClause,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.CatchClause,
]);

const LOGICAL_OPERATOR_KINDS = new Set<SyntaxKind>([
  SyntaxKind.AmpersandAmpersandToken,
  SyntaxKind.BarBarToken,
  SyntaxKind.QuestionQuestionToken,
]);

export function computeCyclomatic(node: FunctionLikeNode): number {
  const body = getBody(node);
  if (!body) return 1;

  let score = 1;
  walkBodyExcludingNestedFunctions(body, (n) => {
    const kind = n.getKind();
    if (INCREMENT_KINDS.has(kind)) {
      score += 1;
      return;
    }
    if (kind === SyntaxKind.BinaryExpression) {
      const binary = n.asKindOrThrow(SyntaxKind.BinaryExpression);
      const opKind = binary.getOperatorToken().getKind();
      if (LOGICAL_OPERATOR_KINDS.has(opKind)) {
        score += 1;
      }
    }
  });
  return score;
}

function getBody(node: FunctionLikeNode): Node | undefined {
  if (node.getKind() === SyntaxKind.ArrowFunction) {
    return node.asKindOrThrow(SyntaxKind.ArrowFunction).getBody();
  }
  return (node as unknown as { getBody(): Node | undefined }).getBody();
}

export const cyclomaticCollector: Collector<CyclomaticResult> = {
  name: "cyclomatic",
  collect(ctx: CollectorContext): Map<DeclarationId, CyclomaticResult> {
    const result = new Map<DeclarationId, CyclomaticResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, {
          cyclomaticComplexity: computeCyclomatic(decl.node),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `cyclomaticCollector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
          { cause: err },
        );
      }
    }
    return result;
  },
};
