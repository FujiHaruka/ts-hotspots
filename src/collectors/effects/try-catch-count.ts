import ts from "typescript";
import { makeCountingCollector, countMatches } from "../countingCollector.ts";
import type { FunctionLikeNode } from "../types.ts";

export interface TryCatchCountResult {
  tryCatchCount: number;
}

const matches = (n: ts.Node): boolean =>
  n.kind === ts.SyntaxKind.TryStatement;

export function computeTryCatchCount(node: FunctionLikeNode): number {
  return countMatches(node, matches);
}

export const tryCatchCountCollector = makeCountingCollector({
  name: "tryCatchCount",
  resultKey: "tryCatchCount",
  matches,
});
