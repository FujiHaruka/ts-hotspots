import { SyntaxKind } from "ts-morph";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeNode,
} from "../types.ts";
import { walkBodyExcludingNestedFunctions } from "../walk.ts";
import { getFunctionBody } from "./shared.ts";

export interface NonNullAssertionResult {
  nonNullAssertionCount: number;
}

export function computeNonNullAssertion(node: FunctionLikeNode): number {
  const body = getFunctionBody(node);
  if (!body) return 0;

  let count = 0;
  walkBodyExcludingNestedFunctions(body, (n) => {
    if (n.getKind() === SyntaxKind.NonNullExpression) count += 1;
  });
  return count;
}

export const nonNullAssertionCollector: Collector<NonNullAssertionResult> = {
  name: "nonNullAssertion",
  collect(ctx: CollectorContext): Map<DeclarationId, NonNullAssertionResult> {
    const result = new Map<DeclarationId, NonNullAssertionResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, {
          nonNullAssertionCount: computeNonNullAssertion(decl.node),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `nonNullAssertionCollector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
          { cause: err },
        );
      }
    }
    return result;
  },
};
