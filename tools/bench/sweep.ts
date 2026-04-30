import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { runDetector } from "../../src/duplication/cli/runDetector.ts";
import type { Config } from "../../src/duplication/config/index.ts";
import { defaultConfig } from "../../src/duplication/config/index.ts";
import { groupsToPairs } from "./groupsToPairs.ts";
import { type Fixture, loadFixtures } from "./loadFixtures.ts";
import { matchReport } from "./matchReport.ts";
import {
  type AggregateRow,
  aggregate,
  type RunSummary,
  type ScenarioRunMetrics,
  scenarioMetricsFromMatch,
} from "./metrics.ts";
import { setupRepo } from "./setupRepo.ts";

/**
 * Param sweep harness. Runs every fixture against several config variants
 * and prints a side-by-side comparison. Used to answer "is the default value
 * of X actually well-chosen, or did we just pick a number?".
 *
 * Differs from index.ts (the main bench) in two ways:
 *   - no ablation per variant (each variant is itself the comparison axis)
 *   - all variants share one fixture load
 */

interface VariantSpec {
  label: string;
  configPath: string | null;
}

const DEFAULT_VARIANTS: VariantSpec[] = [
  { label: "[2,3]", configPath: "tools/bench/configs/ngram-2-3.json" },
  { label: "[3,4,5]", configPath: "tools/bench/configs/ngram-3-4-5.json" },
  { label: "[3,4,5,6]", configPath: null },
  { label: "[4,5,6]", configPath: "tools/bench/configs/ngram-4-5-6.json" },
  { label: "[4,5,6,7]", configPath: "tools/bench/configs/ngram-4-5-6-7.json" },
  { label: "[5,6,7,8]", configPath: "tools/bench/configs/ngram-5-6-7-8.json" },
  { label: "[3..8]", configPath: "tools/bench/configs/ngram-3-to-8.json" },
];

interface CliArgs {
  outDir: string;
}

function parseCli(argv: readonly string[]): CliArgs {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      "out-dir": { type: "string", default: "tools/bench/baseline" },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const outDirValue = values["out-dir"];
  return {
    outDir:
      typeof outDirValue === "string" ? outDirValue : "tools/bench/baseline",
  };
}

const USAGE = `Usage: pnpm bench:sweep [options]

Runs the fixture suite for several tokenNgramSizes variants and writes
sweep.md / sweep.json to the out-dir.

Options:
  --out-dir <path>   Where to write sweep.md / sweep.json.
                     Default: tools/bench/baseline
  -h, --help         Show this message.
`;

function mergeConfig(override: unknown): Config {
  if (override === null || typeof override !== "object") return defaultConfig;
  const o = override as Record<string, Record<string, unknown>>;
  const out = JSON.parse(JSON.stringify(defaultConfig)) as Record<
    string,
    Record<string, unknown>
  >;
  for (const key of Object.keys(o)) {
    const section = o[key];
    if (section !== undefined && typeof section === "object") {
      out[key] = { ...out[key], ...section };
    }
  }
  return out as unknown as Config;
}

function loadVariantConfig(spec: VariantSpec): Config {
  if (spec.configPath === null) return defaultConfig;
  const raw = readFileSync(spec.configPath, "utf-8");
  return mergeConfig(JSON.parse(raw));
}

async function runScenario(
  fixture: Fixture,
  config: Config,
): Promise<ScenarioRunMetrics> {
  const repo = setupRepo(fixture.baseFiles, fixture.headFiles);
  try {
    const t0 = Date.now();
    const report = await runDetector({
      repoPath: repo.path,
      baseRef: repo.baseSha,
      headRef: repo.headSha,
      threeDot: false,
      config,
    });
    const wallMs = Date.now() - t0;
    const match = matchReport(
      groupsToPairs(report.groups),
      fixture.expected.expectedPositive,
      fixture.expected.expectedNegative,
    );
    return scenarioMetricsFromMatch(
      fixture.id,
      fixture.expected.tags,
      match,
      wallMs,
    );
  } finally {
    repo.cleanup();
  }
}

async function runVariant(
  fixtures: Fixture[],
  label: string,
  config: Config,
): Promise<RunSummary> {
  const scenarios: ScenarioRunMetrics[] = [];
  const t0 = Date.now();
  for (const fixture of fixtures) {
    scenarios.push(await runScenario(fixture, config));
  }
  return { label, scenarios, wallMs: Date.now() - t0 };
}

interface SweepRow extends AggregateRow {
  /** scenarioIds whose recall@all dropped vs the [3,4,5,6] baseline run. */
  recallRegressions: string[];
  /** scenarioIds whose negativeViolations went up vs baseline. */
  precisionRegressions: string[];
}

function compareToBaseline(
  baseline: RunSummary,
  run: RunSummary,
): { recall: string[]; precision: string[] } {
  const recall: string[] = [];
  const precision: string[] = [];
  const baseById = new Map(baseline.scenarios.map((s) => [s.scenarioId, s]));
  for (const s of run.scenarios) {
    const b = baseById.get(s.scenarioId);
    if (b === undefined) continue;
    if (s.matchedAll < b.matchedAll) recall.push(s.scenarioId);
    if (s.negativeViolations > b.negativeViolations)
      precision.push(s.scenarioId);
  }
  return { recall, precision };
}

function fmtPct(n: number): string {
  return n.toFixed(2);
}

function fmtMs(ms: number): string {
  return `${(ms / 1000).toFixed(2)}s`;
}

function buildMarkdown(rows: SweepRow[], fixtureCount: number): string {
  const lines: string[] = [];
  lines.push("# ts-dedup tokenNgramSizes sweep");
  lines.push("");
  lines.push(`fixtures: ${String(fixtureCount)}`);
  lines.push("");
  lines.push("## summary");
  lines.push("");
  lines.push(
    "| sizes        | recall@10 | recall@50 | recall@all | neg viol. | wall   |",
  );
  lines.push(
    "|--------------|----------:|----------:|-----------:|----------:|-------:|",
  );
  for (const row of rows) {
    lines.push(
      `| ${row.label.padEnd(12)} |      ${fmtPct(row.recallAt10)} |      ${fmtPct(row.recallAt50)} |       ${fmtPct(row.recallAtAll)} |        ${String(row.negativeViolations).padStart(2)} | ${fmtMs(row.wallMs).padStart(6)} |`,
    );
  }
  lines.push("");
  lines.push("## regressions vs [3,4,5,6] baseline");
  lines.push("");
  for (const row of rows) {
    const recall =
      row.recallRegressions.length === 0
        ? "—"
        : row.recallRegressions.join(", ");
    const prec =
      row.precisionRegressions.length === 0
        ? "—"
        : row.precisionRegressions.join(", ");
    lines.push(`### ${row.label}`);
    lines.push(`- recall drops: ${recall}`);
    lines.push(`- precision drops: ${prec}`);
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

interface SweepJson {
  fixtureCount: number;
  rows: SweepRow[];
}

export async function runSweep(argv: readonly string[]): Promise<number> {
  const cli = parseCli(argv);
  const suiteRoot = resolve("test/dedup/fixtures/suite");
  const fixtures = loadFixtures(suiteRoot);
  if (fixtures.length === 0) {
    process.stderr.write(`no fixtures found in ${suiteRoot}\n`);
    return 1;
  }

  const variants = DEFAULT_VARIANTS;
  const runs: RunSummary[] = [];
  for (const v of variants) {
    process.stderr.write(`running ${v.label}...\n`);
    const config = loadVariantConfig(v);
    runs.push(await runVariant(fixtures, v.label, config));
  }

  const baselineRun = runs.find((r) => r.label === "[3,4,5,6]");
  if (baselineRun === undefined) {
    throw new Error("baseline variant [3,4,5,6] missing from sweep");
  }

  const rows: SweepRow[] = runs.map((run) => {
    const agg = aggregate(run);
    const diff = compareToBaseline(baselineRun, run);
    return {
      ...agg,
      recallRegressions: diff.recall,
      precisionRegressions: diff.precision,
    };
  });

  const md = buildMarkdown(rows, fixtures.length);
  const json: SweepJson = { fixtureCount: fixtures.length, rows };

  mkdirSync(cli.outDir, { recursive: true });
  const mdPath = join(cli.outDir, "sweep.md");
  const jsonPath = join(cli.outDir, "sweep.json");
  writeFileSync(mdPath, md, "utf-8");
  writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`, "utf-8");

  process.stdout.write(md);
  process.stderr.write(
    `\nwrote ${mdPath} and ${jsonPath} (${String(fixtures.length)} fixtures, ${String(runs.length)} variants)\n`,
  );
  return 0;
}

const isMain = import.meta.url === `file://${process.argv[1] ?? ""}`;
if (isMain) {
  runSweep(process.argv).then(
    (code) => {
      process.exit(code);
    },
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`sweep: ${msg}\n`);
      process.exit(1);
    },
  );
}
