import { type Node, SyntaxKind } from "ts-morph";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeNode,
} from "../types.ts";
import { walkBodyExcludingNestedFunctions } from "../walk.ts";

export interface MutationCountResult {
  mutationSiteCount: number;
}

const ASSIGNMENT_OPERATORS = new Set<SyntaxKind>([
  SyntaxKind.EqualsToken,
  SyntaxKind.PlusEqualsToken,
  SyntaxKind.MinusEqualsToken,
  SyntaxKind.AsteriskEqualsToken,
  SyntaxKind.SlashEqualsToken,
  SyntaxKind.PercentEqualsToken,
  SyntaxKind.AsteriskAsteriskEqualsToken,
  SyntaxKind.AmpersandEqualsToken,
  SyntaxKind.BarEqualsToken,
  SyntaxKind.CaretEqualsToken,
  SyntaxKind.LessThanLessThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanEqualsToken,
  SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  SyntaxKind.AmpersandAmpersandEqualsToken,
  SyntaxKind.BarBarEqualsToken,
  SyntaxKind.QuestionQuestionEqualsToken,
]);

const INCREMENT_DECREMENT = new Set<SyntaxKind>([
  SyntaxKind.PlusPlusToken,
  SyntaxKind.MinusMinusToken,
]);

export function computeMutationCount(node: FunctionLikeNode): number {
  const body = getBody(node);
  if (!body) return 0;

  let count = 0;
  walkBodyExcludingNestedFunctions(body, (n) => {
    const kind = n.getKind();
    if (kind === SyntaxKind.BinaryExpression) {
      const bin = n.asKindOrThrow(SyntaxKind.BinaryExpression);
      if (ASSIGNMENT_OPERATORS.has(bin.getOperatorToken().getKind())) {
        count += 1;
      }
      return;
    }
    if (kind === SyntaxKind.PrefixUnaryExpression) {
      const op = n
        .asKindOrThrow(SyntaxKind.PrefixUnaryExpression)
        .getOperatorToken();
      if (INCREMENT_DECREMENT.has(op)) {
        count += 1;
      }
      return;
    }
    if (kind === SyntaxKind.PostfixUnaryExpression) {
      const op = n
        .asKindOrThrow(SyntaxKind.PostfixUnaryExpression)
        .getOperatorToken();
      if (INCREMENT_DECREMENT.has(op)) {
        count += 1;
      }
      return;
    }
    if (kind === SyntaxKind.DeleteExpression) {
      count += 1;
    }
  });
  return count;
}

function getBody(node: FunctionLikeNode): Node | undefined {
  if (node.getKind() === SyntaxKind.ArrowFunction) {
    return node.asKindOrThrow(SyntaxKind.ArrowFunction).getBody();
  }
  return (node as unknown as { getBody(): Node | undefined }).getBody();
}

export const mutationCountCollector: Collector<MutationCountResult> = {
  name: "mutationCount",
  collect(ctx: CollectorContext): Map<DeclarationId, MutationCountResult> {
    const result = new Map<DeclarationId, MutationCountResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, {
          mutationSiteCount: computeMutationCount(decl.node),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `mutationCountCollector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
          { cause: err },
        );
      }
    }
    return result;
  },
};
