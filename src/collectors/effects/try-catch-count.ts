import ts from "typescript";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeNode,
} from "../types.ts";
import { walkBodyExcludingNestedFunctions } from "../walk.ts";

export interface TryCatchCountResult {
  tryCatchCount: number;
}

export function computeTryCatchCount(node: FunctionLikeNode): number {
  const body = getBody(node);
  if (!body) return 0;

  let count = 0;
  walkBodyExcludingNestedFunctions(body, (n) => {
    if (n.kind === ts.SyntaxKind.TryStatement) {
      count += 1;
    }
  });
  return count;
}

function getBody(node: FunctionLikeNode): ts.Node | undefined {
  if (node.kind === ts.SyntaxKind.ArrowFunction) {
    return (node as ts.ArrowFunction).body;
  }
  return (node as Exclude<FunctionLikeNode, ts.ArrowFunction>).body;
}

export const tryCatchCountCollector: Collector<TryCatchCountResult> = {
  name: "tryCatchCount",
  collect(ctx: CollectorContext): Map<DeclarationId, TryCatchCountResult> {
    const result = new Map<DeclarationId, TryCatchCountResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, {
          tryCatchCount: computeTryCatchCount(decl.node),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `tryCatchCountCollector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
          { cause: err },
        );
      }
    }
    return result;
  },
};
