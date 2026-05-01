import ts from "typescript";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeTsNode,
} from "../types.ts";
import { walkBodyExcludingNestedFunctions } from "../walk-ts.ts";

export interface AwaitCountResult {
  awaitCount: number;
}

export function computeAwaitCount(node: FunctionLikeTsNode): number {
  const body = getBody(node);
  if (!body) return 0;

  let count = 0;
  walkBodyExcludingNestedFunctions(body, (n) => {
    if (n.kind === ts.SyntaxKind.AwaitExpression) {
      count += 1;
      return;
    }
    if (n.kind === ts.SyntaxKind.ForOfStatement) {
      const forOf = n as ts.ForOfStatement;
      if (forOf.awaitModifier !== undefined) {
        count += 1;
      }
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

export const awaitCountCollector: Collector<AwaitCountResult> = {
  name: "awaitCount",
  collect(ctx: CollectorContext): Map<DeclarationId, AwaitCountResult> {
    const result = new Map<DeclarationId, AwaitCountResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, { awaitCount: computeAwaitCount(decl.tsNode) });
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
