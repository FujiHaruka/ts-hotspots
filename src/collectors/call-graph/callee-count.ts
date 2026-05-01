import ts from "typescript";
import { makeCountingCollector } from "../countingCollector.ts";

export interface CalleeCountResult {
  calleeCount: number;
}

const matches = (n: ts.Node): boolean =>
  n.kind === ts.SyntaxKind.CallExpression;

export const { collector: calleeCountCollector, count: computeCalleeCount } =
  makeCountingCollector({
    name: "calleeCount",
    resultKey: "calleeCount",
    matches,
  });
