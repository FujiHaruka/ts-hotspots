import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import {
  PhaseTimingsCollector,
  type PhaseTimingsRecord,
} from "../../src/cli/perfLog.ts";
import { runDetector } from "../../src/cli/runDetector.ts";
import { defaultConfig } from "../../src/config/index.ts";

type PhaseTimings = PhaseTimingsRecord;

/**
 * One-shot scaling probe. Runs `runDetector` against a chosen base..head
 * pair on the current repository three times, takes the median of each
 * phase, and writes a Markdown summary. Used to check whether any phase
 * scales super-linearly once the base side grows beyond fixture sizes —
 * the bench harness on small fixtures can't answer that because git
 * subprocess overhead dominates there.
 */
interface Args {
  base: string;
  head: string;
  repo: string;
  out: string;
  runs: number;
}

function parseCli(argv: readonly string[]): Args {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      base: { type: "string" },
      head: { type: "string", default: "HEAD" },
      repo: { type: "string" },
      out: { type: "string", default: "tools/bench/baseline/scale.md" },
      runs: { type: "string", default: "3" },
    },
    strict: true,
  });
  if (values.base === undefined) {
    process.stderr.write("scale: --base <ref> is required\n");
    process.exit(2);
  }
  const runs = Number.parseInt(values.runs, 10);
  if (!Number.isFinite(runs) || runs < 1) {
    process.stderr.write("scale: --runs must be a positive integer\n");
    process.exit(2);
  }
  return {
    base: values.base,
    head: values.head,
    repo: values.repo ?? process.cwd(),
    out: values.out,
    runs,
  };
}

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0;
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

async function main(): Promise<number> {
  const args = parseCli(process.argv);
  const samples: PhaseTimings[] = [];
  let baseFiles = 0;
  let baseFragments = 0;
  let changedFiles = 0;
  let changedFragments = 0;
  let candidatePairs = 0;
  let reportedPairs = 0;

  for (let i = 0; i < args.runs; i += 1) {
    process.stderr.write(`run ${String(i + 1)} / ${String(args.runs)}...\n`);
    const collector = new PhaseTimingsCollector();
    const report = await runDetector({
      repoPath: args.repo,
      baseRef: args.base,
      headRef: args.head,
      threeDot: false,
      config: defaultConfig,
      perfLog: collector,
    });
    samples.push(collector.timings);
    const { scope, pipeline } = report.summary;
    baseFiles = scope.base.files;
    baseFragments = scope.base.fragments;
    changedFiles = scope.changed?.files ?? 0;
    changedFragments = scope.changed?.fragments ?? 0;
    candidatePairs = pipeline.candidatePairs;
    reportedPairs = pipeline.reportedPairs;
  }

  const phases = [
    "diff",
    "listBase",
    "baseIndex",
    "headSearch",
    "report",
  ] as const;
  const medians: Record<(typeof phases)[number], number> = {
    diff: median(samples.map((s) => s.diff)),
    listBase: median(samples.map((s) => s.listBase)),
    baseIndex: median(samples.map((s) => s.baseIndex)),
    headSearch: median(samples.map((s) => s.headSearch)),
    report: median(samples.map((s) => s.report)),
  };
  const total = phases.reduce((acc, p) => acc + medians[p], 0);

  const fmt = (n: number): string => n.toFixed(1);
  const pct = (n: number): string =>
    total === 0 ? " 0%" : `${((n / total) * 100).toFixed(0).padStart(2)}%`;

  const lines: string[] = [];
  lines.push("# ts-dedup scale probe");
  lines.push("");
  lines.push(`repo: ${args.repo}`);
  lines.push(`range: \`${args.base}..${args.head}\` (two-dot)`);
  lines.push(`runs: ${String(args.runs)} (median of per-phase ms below)`);
  lines.push("");
  lines.push("## input size");
  lines.push("");
  lines.push(`- base files: ${String(baseFiles)}`);
  lines.push(`- base fragments: ${String(baseFragments)}`);
  lines.push(`- changed files: ${String(changedFiles)}`);
  lines.push(`- changed fragments: ${String(changedFragments)}`);
  lines.push(`- candidate pairs: ${String(candidatePairs)}`);
  lines.push(`- reported pairs: ${String(reportedPairs)}`);
  lines.push("");
  lines.push("## phase breakdown (median)");
  lines.push("");
  lines.push("| phase       | median ms | share |");
  lines.push("|-------------|----------:|------:|");
  for (const p of phases) {
    lines.push(
      `| ${p.padEnd(11)} | ${fmt(medians[p]).padStart(9)} |  ${pct(medians[p])} |`,
    );
  }
  lines.push(
    `| **total**   | ${fmt(total).padStart(9)} | 100% |`,
  );
  lines.push("");

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${lines.join("\n")}\n`, "utf-8");
  process.stdout.write(`${lines.join("\n")}\n`);
  process.stderr.write(`\nwrote ${args.out}\n`);
  return 0;
}

const isMain = import.meta.url === `file://${process.argv[1] ?? ""}`;
if (isMain) {
  main().then(
    (code) => {
      process.exit(code);
    },
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`scale: ${msg}\n`);
      process.exit(1);
    },
  );
}

