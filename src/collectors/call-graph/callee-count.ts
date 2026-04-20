import { type Node, SyntaxKind } from "ts-morph";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeNode,
} from "../types.ts";
import { walkBodyExcludingNestedFunctions } from "../walk.ts";

export interface CalleeCountResult {
  calleeCount: number;
}

export function computeCalleeCount(node: FunctionLikeNode): number {
  const body = getBody(node);
  if (!body) return 0;

  let count = 0;
  walkBodyExcludingNestedFunctions(body, (n) => {
    if (n.getKind() === SyntaxKind.CallExpression) {
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

export const calleeCountCollector: Collector<CalleeCountResult> = {
  name: "calleeCount",
  collect(ctx: CollectorContext): Map<DeclarationId, CalleeCountResult> {
    const result = new Map<DeclarationId, CalleeCountResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, { calleeCount: computeCalleeCount(decl.node) });
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
