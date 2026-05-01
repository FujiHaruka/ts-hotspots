import ts from "typescript";
import { makeCountingCollector, countMatches } from "../countingCollector.ts";
import type { FunctionLikeNode } from "../types.ts";

export interface CalleeCountResult {
  calleeCount: number;
}

const matches = (n: ts.Node): boolean =>
  n.kind === ts.SyntaxKind.CallExpression;

export function computeCalleeCount(node: FunctionLikeNode): number {
  return countMatches(node, matches);
}

export const calleeCountCollector = makeCountingCollector({
  name: "calleeCount",
  resultKey: "calleeCount",
  matches,
});
