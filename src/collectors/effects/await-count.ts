import ts from "typescript";
import { makeCountingCollector } from "../countingCollector.ts";

export interface AwaitCountResult {
  awaitCount: number;
}

function matches(n: ts.Node): boolean {
  if (n.kind === ts.SyntaxKind.AwaitExpression) return true;
  if (n.kind === ts.SyntaxKind.ForOfStatement) {
    return (n as ts.ForOfStatement).awaitModifier !== undefined;
  }
  return false;
}

export const { collector: awaitCountCollector, count: computeAwaitCount } =
  makeCountingCollector({
    name: "awaitCount",
    resultKey: "awaitCount",
    matches,
  });
