import { type Node, SyntaxKind } from "ts-morph";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeNode,
} from "../types.ts";
import { walkBodyExcludingNestedFunctions } from "../walk.ts";

export interface ReturnCountResult {
  returnCount: number;
}

export function computeReturnCount(node: FunctionLikeNode): number {
  const body = getBody(node);
  if (!body) return 0;

  let count = 0;
  walkBodyExcludingNestedFunctions(body, (n) => {
    if (n.getKind() === SyntaxKind.ReturnStatement) count += 1;
  });
  return count;
}

function getBody(node: FunctionLikeNode): Node | undefined {
  if (node.getKind() === SyntaxKind.ArrowFunction) {
    return node.asKindOrThrow(SyntaxKind.ArrowFunction).getBody();
  }
  return (node as unknown as { getBody(): Node | undefined }).getBody();
}

export const returnCountCollector: Collector<ReturnCountResult> = {
  name: "returnCount",
  collect(ctx: CollectorContext): Map<DeclarationId, ReturnCountResult> {
    const result = new Map<DeclarationId, ReturnCountResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, { returnCount: computeReturnCount(decl.node) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `returnCountCollector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
          { cause: err },
        );
      }
    }
    return result;
  },
};
