import type ts from "typescript";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeNode,
} from "./types.ts";
import { getFunctionBody, walkBodyExcludingNestedFunctions } from "./walk.ts";

export function countMatches(
  node: FunctionLikeNode,
  matches: (n: ts.Node) => boolean,
): number {
  const body = getFunctionBody(node);
  if (!body) return 0;

  let count = 0;
  walkBodyExcludingNestedFunctions(body, (n) => {
    if (matches(n)) count += 1;
  });
  return count;
}

export interface CountingCollectorOptions<K extends string> {
  name: string;
  resultKey: K;
  matches: (n: ts.Node) => boolean;
}

export function makeCountingCollector<K extends string>(
  opts: CountingCollectorOptions<K>,
): Collector<Record<K, number>> {
  const { name, resultKey, matches } = opts;
  return {
    name,
    collect(ctx: CollectorContext): Map<DeclarationId, Record<K, number>> {
      const result = new Map<DeclarationId, Record<K, number>>();
      for (const decl of ctx.declarations) {
        try {
          const value = countMatches(decl.node, matches);
          result.set(decl.id, { [resultKey]: value } as Record<K, number>);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(
            `${name}Collector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
            { cause: err },
          );
        }
      }
      return result;
    },
  };
}
