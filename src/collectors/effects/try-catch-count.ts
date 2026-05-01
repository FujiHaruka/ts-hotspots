import ts from "typescript";
import { makeCountingCollector } from "../countingCollector.ts";

export interface TryCatchCountResult {
  tryCatchCount: number;
}

const matches = (n: ts.Node): boolean =>
  n.kind === ts.SyntaxKind.TryStatement;

export const {
  collector: tryCatchCountCollector,
  count: computeTryCatchCount,
} = makeCountingCollector({
  name: "tryCatchCount",
  resultKey: "tryCatchCount",
  matches,
});
