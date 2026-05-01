import ts from "typescript";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeTsNode,
} from "../types.ts";
import { walkBodyExcludingNestedFunctions } from "../walk-ts.ts";

export interface MutationCountResult {
  mutationSiteCount: number;
}

const ASSIGNMENT_OPERATORS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.EqualsToken,
  ts.SyntaxKind.PlusEqualsToken,
  ts.SyntaxKind.MinusEqualsToken,
  ts.SyntaxKind.AsteriskEqualsToken,
  ts.SyntaxKind.SlashEqualsToken,
  ts.SyntaxKind.PercentEqualsToken,
  ts.SyntaxKind.AsteriskAsteriskEqualsToken,
  ts.SyntaxKind.AmpersandEqualsToken,
  ts.SyntaxKind.BarEqualsToken,
  ts.SyntaxKind.CaretEqualsToken,
  ts.SyntaxKind.LessThanLessThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.GreaterThanGreaterThanGreaterThanEqualsToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

const INCREMENT_DECREMENT = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.PlusPlusToken,
  ts.SyntaxKind.MinusMinusToken,
]);

export function computeMutationCount(node: FunctionLikeTsNode): number {
  const body = getBody(node);
  if (!body) return 0;

  let count = 0;
  walkBodyExcludingNestedFunctions(body, (n) => {
    if (n.kind === ts.SyntaxKind.BinaryExpression) {
      const bin = n as ts.BinaryExpression;
      if (ASSIGNMENT_OPERATORS.has(bin.operatorToken.kind)) {
        count += 1;
      }
      return;
    }
    if (n.kind === ts.SyntaxKind.PrefixUnaryExpression) {
      const op = (n as ts.PrefixUnaryExpression).operator;
      if (INCREMENT_DECREMENT.has(op)) {
        count += 1;
      }
      return;
    }
    if (n.kind === ts.SyntaxKind.PostfixUnaryExpression) {
      const op = (n as ts.PostfixUnaryExpression).operator;
      if (INCREMENT_DECREMENT.has(op)) {
        count += 1;
      }
      return;
    }
    if (n.kind === ts.SyntaxKind.DeleteExpression) {
      count += 1;
    }
  });
  return count;
}

function getBody(node: FunctionLikeTsNode): ts.Node | undefined {
  if (node.kind === ts.SyntaxKind.ArrowFunction) {
    return (node as ts.ArrowFunction).body;
  }
  return (node as Exclude<FunctionLikeTsNode, ts.ArrowFunction>).body;
}

export const mutationCountCollector: Collector<MutationCountResult> = {
  name: "mutationCount",
  collect(ctx: CollectorContext): Map<DeclarationId, MutationCountResult> {
    const result = new Map<DeclarationId, MutationCountResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, {
          mutationSiteCount: computeMutationCount(decl.tsNode),
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
