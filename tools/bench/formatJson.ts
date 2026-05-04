import {
  aggregate,
  perTagRecall,
  type RunSummary,
  totalNegatives,
  totalPositives,
} from "./metrics.ts";

interface JsonReport {
  configLabel: string;
  fixtureCount: number;
  positives: number;
  negatives: number;
  runs: RunEntry[];
  perTagBaseline: ReturnType<typeof perTagRecall>;
}

interface RunEntry {
  label: string;
  wallMs: number;
  aggregate: ReturnType<typeof aggregate>;
  scenarios: RunSummary["scenarios"];
}

export function formatJson(
  configLabel: string,
  fixtureCount: number,
  runs: RunSummary[],
): JsonReport {
  const baseline = runs[0];
  return {
    configLabel,
    fixtureCount,
    positives: baseline ? totalPositives(baseline) : 0,
    negatives: baseline ? totalNegatives(baseline) : 0,
    runs: runs.map((r) => ({
      label: r.label,
      wallMs: r.wallMs,
      aggregate: aggregate(r),
      scenarios: r.scenarios,
    })),
    perTagBaseline: baseline ? perTagRecall(baseline) : [],
  };
}
