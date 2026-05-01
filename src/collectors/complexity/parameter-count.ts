import { makeCollector } from "../makeCollector.ts";
import type { FunctionLikeNode } from "../types.ts";

export interface ParameterCountResult {
  parameterCount: number;
}

export function computeParameterCount(node: FunctionLikeNode): number {
  return node.parameters.length;
}

export const parameterCountCollector = makeCollector<ParameterCountResult>({
  name: "parameterCount",
  compute: (decl) => ({ parameterCount: computeParameterCount(decl.node) }),
});
