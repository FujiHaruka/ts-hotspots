import ts from "typescript";
import { makeCountingCollector, countMatches } from "../countingCollector.ts";
import type { FunctionLikeNode } from "../types.ts";

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

export function computeAwaitCount(node: FunctionLikeNode): number {
  return countMatches(node, matches);
}

export const awaitCountCollector = makeCountingCollector({
  name: "awaitCount",
  resultKey: "awaitCount",
  matches,
});
