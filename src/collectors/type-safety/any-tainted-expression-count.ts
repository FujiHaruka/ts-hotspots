import { SyntaxKind } from "ts-morph";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeNode,
} from "../types.ts";
import { walkBodyExcludingNestedFunctions } from "../walk.ts";
import { getFunctionBody, nodeTypeIsAny } from "./shared.ts";

export interface AnyTaintedExpressionCountResult {
  anyTaintedExpressionCount: number;
}

export function computeAnyTaintedExpressionCount(
  node: FunctionLikeNode,
): number {
  const body = getFunctionBody(node);
  if (!body) return 0;

  let count = 0;
  walkBodyExcludingNestedFunctions(body, (n) => {
    const kind = n.getKind();
    if (
      kind !== SyntaxKind.CallExpression &&
      kind !== SyntaxKind.PropertyAccessExpression &&
      kind !== SyntaxKind.ElementAccessExpression
    ) {
      return;
    }
    if (nodeTypeIsAny(n)) count += 1;
  });
  return count;
}

export const anyTaintedExpressionCountCollector: Collector<AnyTaintedExpressionCountResult> =
  {
    name: "anyTaintedExpressionCount",
    collect(
      ctx: CollectorContext,
    ): Map<DeclarationId, AnyTaintedExpressionCountResult> {
      const result = new Map<DeclarationId, AnyTaintedExpressionCountResult>();
      for (const decl of ctx.declarations) {
        try {
          result.set(decl.id, {
            anyTaintedExpressionCount: computeAnyTaintedExpressionCount(
              decl.node,
            ),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(
            `anyTaintedExpressionCountCollector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
            { cause: err },
          );
        }
      }
      return result;
    },
  };
