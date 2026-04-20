import type { Project } from "ts-morph";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeNode,
} from "../types.ts";
import { walkBodyExcludingNestedFunctions } from "../walk.ts";
import {
  getFunctionBody,
  getUnderlyingChecker,
  isAssertionKind,
  isConstAssertion,
  isEmptyLiteralAssertion,
  isUnsafeCast,
} from "./shared.ts";

export interface UnsafeCastCountResult {
  unsafeCastCount: number;
}

export function computeUnsafeCastCount(
  node: FunctionLikeNode,
  project: Project,
): number {
  const body = getFunctionBody(node);
  if (!body) return 0;

  const checker = getUnderlyingChecker(project);

  let count = 0;
  walkBodyExcludingNestedFunctions(body, (n) => {
    if (!isAssertionKind(n.getKind())) return;
    if (isConstAssertion(n)) return;
    if (isEmptyLiteralAssertion(n)) return;
    if (isUnsafeCast(n, checker)) count += 1;
  });
  return count;
}

export const unsafeCastCountCollector: Collector<UnsafeCastCountResult> = {
  name: "unsafeCastCount",
  collect(ctx: CollectorContext): Map<DeclarationId, UnsafeCastCountResult> {
    const result = new Map<DeclarationId, UnsafeCastCountResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, {
          unsafeCastCount: computeUnsafeCastCount(decl.node, ctx.project),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `unsafeCastCountCollector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
          { cause: err },
        );
      }
    }
    return result;
  },
};
