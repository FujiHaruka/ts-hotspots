import { calleeCountCollector } from "../collectors/call-graph/callee-count.ts";
import { cognitiveCollector } from "../collectors/complexity/cognitive.ts";
import { maxNestingDepthCollector } from "../collectors/complexity/max-nesting-depth.ts";
import { parameterCountCollector } from "../collectors/complexity/parameter-count.ts";
import { slocCollector } from "../collectors/complexity/sloc.ts";
import { awaitCountCollector } from "../collectors/effects/await-count.ts";
import { mutationCountCollector } from "../collectors/effects/mutation-count.ts";
import { tryCatchCountCollector } from "../collectors/effects/try-catch-count.ts";
import type { CollectorContext } from "../collectors/types.ts";
import { computeBodyHash } from "../dismissal/hash.ts";
import type { SourceFileInfo } from "../loader/types.ts";
import type { FunctionEntry, FunctionMetrics } from "../schema.ts";
import {
  buildFunctionLocation,
  compareFunctionByLocation,
} from "./function-location.ts";

interface AggregateContext extends CollectorContext {
  files: readonly SourceFileInfo[];
  churn?: ReadonlyMap<string, number>;
}

interface AggregateResult {
  functions: FunctionEntry[];
}

// Each collector contributes one or more keys of FunctionMetrics. Adding a
// collector means appending it here — the per-declaration loop below picks it
// up automatically.
const METRIC_COLLECTORS = [
  cognitiveCollector,
  slocCollector,
  parameterCountCollector,
  maxNestingDepthCollector,
  calleeCountCollector,
  tryCatchCountCollector,
  awaitCountCollector,
  mutationCountCollector,
];

export function aggregate(ctx: AggregateContext): AggregateResult {
  const runs = METRIC_COLLECTORS.map((c) => ({
    name: c.name,
    results: c.collect(ctx),
  }));

  const functions = ctx.declarations.map<FunctionEntry>((d) => {
    const metrics: Partial<FunctionMetrics> = {};
    for (const { name, results } of runs) {
      const partial = results.get(d.id);
      if (partial === undefined) {
        throw new Error(`missing metric from ${name} for ${d.id}`);
      }
      Object.assign(metrics, partial);
    }
    metrics.commitCount = ctx.churn?.get(d.file) ?? 0;
    return {
      location: buildFunctionLocation(d.file, d.line, d.endLine),
      name: d.name,
      kind: d.kind,
      metrics: omitZeros(metrics),
      bodyHash: computeBodyHash(d.node, d.sourceFile),
    };
  });

  functions.sort(compareFunctionByLocation);

  return { functions };
}

function omitZeros<T extends object>(obj: T): Partial<T> {
  const result: Partial<T> = {};
  for (const key of Object.keys(obj) as (keyof T)[]) {
    const v = obj[key];
    if (v !== 0) result[key] = v;
  }
  return result;
}
