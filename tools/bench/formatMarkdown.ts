import {
  type AggregateRow,
  aggregate,
  type PhaseBreakdownRow,
  perTagRecall,
  phaseBreakdown,
  type RunSummary,
  totalNegatives,
  totalPositives,
} from "./metrics.ts";

interface FormatInput {
  configLabel: string;
  fixtureCount: number;
  runs: RunSummary[];
}

const f2 = (n: number): string => n.toFixed(2);
const sec = (ms: number): string => `${(ms / 1000).toFixed(2)}s`;

function summaryTable(rows: AggregateRow[]): string {
  const header =
    "| run            | recall@10 | recall@50 | recall@all | neg viol. | wall   |";
  const sep =
    "|----------------|----------:|----------:|-----------:|----------:|-------:|";
  const body = rows
    .map(
      (r) =>
        `| ${r.label.padEnd(14)} |      ${f2(r.recallAt10)} |      ${f2(r.recallAt50)} |       ${f2(r.recallAtAll)} |      ${String(r.negativeViolations).padStart(4)} | ${sec(r.wallMs).padStart(6)} |`,
    )
    .join("\n");
  return `${header}\n${sep}\n${body}`;
}

function phaseTable(rows: PhaseBreakdownRow[]): string {
  const header = "| phase       | mean ms | p90 ms | max ms | share |";
  const sep = "|-------------|--------:|-------:|-------:|------:|";
  const body = rows
    .map(
      (r) =>
        `| ${r.phase.padEnd(11)} | ${r.meanMs.toFixed(1).padStart(7)} | ${r.p90Ms.toFixed(1).padStart(6)} | ${r.maxMs.toFixed(1).padStart(6)} |  ${(r.share * 100).toFixed(0).padStart(3)}% |`,
    )
    .join("\n");
  return `${header}\n${sep}\n${body}`;
}

export function formatMarkdown(input: FormatInput): string {
  const baseline = input.runs[0];
  if (baseline === undefined) {
    return "# ts-dedup bench report\n\n(no runs)\n";
  }
  const positives = totalPositives(baseline);
  const negatives = totalNegatives(baseline);
  const aggRows = input.runs.map(aggregate);
  const tagRows = perTagRecall(baseline);
  const phaseRows = phaseBreakdown(baseline);

  const lines: string[] = [];
  lines.push("# ts-dedup bench report");
  lines.push("");
  lines.push(`config: ${input.configLabel}`);
  lines.push(
    `fixtures: ${String(input.fixtureCount)} (positives: ${String(positives)}, negatives: ${String(negatives)})`,
  );
  lines.push(`wall: ${sec(baseline.wallMs)}`);
  lines.push("");
  lines.push("## summary");
  lines.push("");
  lines.push(summaryTable(aggRows));
  lines.push("");
  if (phaseRows.length > 0) {
    lines.push("## phase breakdown (baseline)");
    lines.push("");
    lines.push(phaseTable(phaseRows));
    lines.push("");
  }
  lines.push("## per-tag recall (baseline)");
  lines.push("");
  lines.push("| tag        | matched / total | recall |");
  lines.push("|------------|----------------:|-------:|");
  for (const row of tagRows) {
    const tagCol = row.tag.padEnd(10);
    const frac = `${String(row.matched)} / ${String(row.total)}`.padStart(15);
    lines.push(`| ${tagCol} | ${frac} |   ${f2(row.recall)} |`);
  }
  lines.push("");

  const failures: string[] = [];
  for (const s of baseline.scenarios) {
    for (const f of s.failures) {
      failures.push(`- ${s.scenarioId}: ${f}`);
    }
  }
  lines.push("## failures (baseline)");
  lines.push("");
  if (failures.length === 0) {
    lines.push("(none)");
  } else {
    for (const line of failures) lines.push(line);
  }
  lines.push("");

  return lines.join("\n");
}
