import ts from "typescript";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeTsNode,
} from "../types.ts";
import { walkBodyExcludingNestedFunctions } from "../walk-ts.ts";

export interface CalleeCountResult {
  calleeCount: number;
}

export function computeCalleeCount(node: FunctionLikeTsNode): number {
  const body = getBody(node);
  if (!body) return 0;

  let count = 0;
  walkBodyExcludingNestedFunctions(body, (n) => {
    if (n.kind === ts.SyntaxKind.CallExpression) {
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

export const calleeCountCollector: Collector<CalleeCountResult> = {
  name: "calleeCount",
  collect(ctx: CollectorContext): Map<DeclarationId, CalleeCountResult> {
    const result = new Map<DeclarationId, CalleeCountResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, { calleeCount: computeCalleeCount(decl.tsNode) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `calleeCountCollector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
          { cause: err },
        );
      }
    }
    return result;
  },
};
