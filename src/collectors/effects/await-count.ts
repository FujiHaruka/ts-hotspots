import { type Node, SyntaxKind } from "ts-morph";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeNode,
} from "../types.ts";
import { walkBodyExcludingNestedFunctions } from "../walk.ts";

export interface AwaitCountResult {
  awaitCount: number;
}

export function computeAwaitCount(node: FunctionLikeNode): number {
  const body = getBody(node);
  if (!body) return 0;

  let count = 0;
  walkBodyExcludingNestedFunctions(body, (n) => {
    const kind = n.getKind();
    if (kind === SyntaxKind.AwaitExpression) {
      count += 1;
      return;
    }
    if (kind === SyntaxKind.ForOfStatement) {
      const forOf = n.asKindOrThrow(SyntaxKind.ForOfStatement);
      if (forOf.isAwaited()) {
        count += 1;
      }
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

export const awaitCountCollector: Collector<AwaitCountResult> = {
  name: "awaitCount",
  collect(ctx: CollectorContext): Map<DeclarationId, AwaitCountResult> {
    const result = new Map<DeclarationId, AwaitCountResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, { awaitCount: computeAwaitCount(decl.node) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `awaitCountCollector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
          { cause: err },
        );
      }
    }
    return result;
  },
};
