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

export interface CountingCollectorBundle<K extends string> {
  collector: Collector<Record<K, number>>;
  count: (node: FunctionLikeNode) => number;
}

export function makeCountingCollector<K extends string>(
  opts: CountingCollectorOptions<K>,
): CountingCollectorBundle<K> {
  const { name, resultKey, matches } = opts;
  const count = (node: FunctionLikeNode) => countMatches(node, matches);
  const collector = makeCollector<Record<K, number>>({
    name,
    compute: (decl) =>
      ({ [resultKey]: count(decl.node) }) as Record<K, number>,
  });
  return { collector, count };
}
