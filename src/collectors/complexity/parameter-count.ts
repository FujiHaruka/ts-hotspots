import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeTsNode,
} from "../types.ts";

export interface ParameterCountResult {
  parameterCount: number;
}

export function computeParameterCount(node: FunctionLikeTsNode): number {
  return node.parameters.length;
}

export const parameterCountCollector: Collector<ParameterCountResult> = {
  name: "parameterCount",
  collect(ctx: CollectorContext): Map<DeclarationId, ParameterCountResult> {
    const result = new Map<DeclarationId, ParameterCountResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, {
          parameterCount: computeParameterCount(decl.tsNode),
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `parameterCountCollector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
          { cause: err },
        );
      }
    }
    return result;
  },
};
