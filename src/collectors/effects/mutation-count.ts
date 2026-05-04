import ts from "typescript";
import { makeCountingCollector } from "../countingCollector.ts";

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

function matches(n: ts.Node): boolean {
  if (n.kind === ts.SyntaxKind.BinaryExpression) {
    return ASSIGNMENT_OPERATORS.has(
      (n as ts.BinaryExpression).operatorToken.kind,
    );
  }
  if (n.kind === ts.SyntaxKind.PrefixUnaryExpression) {
    return INCREMENT_DECREMENT.has((n as ts.PrefixUnaryExpression).operator);
  }
  if (n.kind === ts.SyntaxKind.PostfixUnaryExpression) {
    return INCREMENT_DECREMENT.has((n as ts.PostfixUnaryExpression).operator);
  }
  return n.kind === ts.SyntaxKind.DeleteExpression;
}

export const {
  collector: mutationCountCollector,
  count: computeMutationCount,
} = makeCountingCollector({
  name: "mutationCount",
  resultKey: "mutationSiteCount",
  matches,
});
