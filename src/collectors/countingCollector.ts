import type ts from "typescript";
import { makeCollector } from "./makeCollector.ts";
import type { Collector, FunctionLikeNode } from "./types.ts";
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
  return makeCollector<Record<K, number>>({
    name,
    compute: (decl) =>
      ({ [resultKey]: countMatches(decl.node, matches) }) as Record<K, number>,
  });
}
