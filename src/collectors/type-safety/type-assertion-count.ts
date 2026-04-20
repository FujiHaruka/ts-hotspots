import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeNode,
} from "../types.ts";
import { walkBodyExcludingNestedFunctions } from "../walk.ts";
import {
  getFunctionBody,
  isAssertionKind,
  isConstAssertion,
} from "./shared.ts";

export interface TypeAssertionCountResult {
  typeAssertionCount: number;
}

export function computeTypeAssertionCount(node: FunctionLikeNode): number {
  const body = getFunctionBody(node);
  if (!body) return 0;

  let count = 0;
  walkBodyExcludingNestedFunctions(body, (n) => {
    if (!isAssertionKind(n.getKind())) return;
    if (isConstAssertion(n)) return;
    count += 1;
  });
  return count;
}

export const typeAssertionCountCollector: Collector<TypeAssertionCountResult> =
  {
    name: "typeAssertionCount",
    collect(
      ctx: CollectorContext,
    ): Map<DeclarationId, TypeAssertionCountResult> {
      const result = new Map<DeclarationId, TypeAssertionCountResult>();
      for (const decl of ctx.declarations) {
        try {
          result.set(decl.id, {
            typeAssertionCount: computeTypeAssertionCount(decl.node),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(
            `typeAssertionCountCollector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
            { cause: err },
          );
        }
      }
      return result;
    },
  };
