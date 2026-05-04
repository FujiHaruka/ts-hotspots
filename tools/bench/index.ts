import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { PhaseTimingsCollector } from "../../src/duplication/cli/perfLog.ts";
import { runDetector } from "../../src/duplication/cli/runDetector.ts";
import type { Config } from "../../src/duplication/config/config.ts";
import { defaultConfig } from "../../src/duplication/config/defaults.ts";
import { formatJson } from "./formatJson.ts";
import { formatMarkdown } from "./formatMarkdown.ts";
import { groupsToPairs } from "./groupsToPairs.ts";
import { type Fixture, loadFixtures } from "./loadFixtures.ts";
import { matchReport } from "./matchReport.ts";
import {
  type RunSummary,
  type ScenarioRunMetrics,
  scenarioMetricsFromMatch,
} from "./metrics.ts";
import { setupRepo } from "./setupRepo.ts";

interface CliArgs {
  only: string | undefined;
  noAblation: boolean;
  configPath: string | undefined;
  outDir: string;
  checkDeterminism: boolean;
  phaseTimings: boolean;
}

function parseCli(argv: readonly string[]): CliArgs {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      only: { type: "string" },
      "no-ablation": { type: "boolean", default: false },
      config: { type: "string" },
      "out-dir": { type: "string", default: "tools/bench/baseline" },
      "check-determinism": { type: "boolean", default: false },
      "phase-timings": { type: "boolean", default: false },
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
    only: values.only,
    noAblation: values["no-ablation"],
    configPath: values.config,
    outDir:
      typeof outDirValue === "string" ? outDirValue : "tools/bench/baseline",
    checkDeterminism: values["check-determinism"],
    phaseTimings: values["phase-timings"],
  };
}

const USAGE = `Usage: pnpm bench [options]

Options:
  --only <id>           Run one fixture (prefix match, e.g. "003").
  --no-ablation         Skip the 3 ablation runs.
  --config <path>       JSON config override (merged over defaults).
  --out-dir <path>      Where to write summary.md / summary.json.
                        Default: tools/bench/baseline
  --check-determinism   Run each fixture twice and diff reports.
  --phase-timings       Collect per-phase wall time and emit a breakdown
                        table in the baseline summary.
  -h, --help            Show this message.
`;

interface ConfigVariant {
  label: string;
  config: Config;
}

/** Apply a partial override onto the default config. Shallow-merge by section. */
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

function buildVariants(base: Config, noAblation: boolean): ConfigVariant[] {
  const variants: ConfigVariant[] = [{ label: "baseline", config: base }];
  if (noAblation) return variants;
  const withToggle = (key: "token" | "statement" | "call"): Config => ({
    ...base,
    features: {
      ...base.features,
      enabled: { ...base.features.enabled, [key]: false },
    },
  });
  variants.push({ label: "token-off", config: withToggle("token") });
  variants.push({ label: "statement-off", config: withToggle("statement") });
  variants.push({ label: "call-off", config: withToggle("call") });
  return variants;
}

async function runScenario(
  fixture: Fixture,
  variant: ConfigVariant,
  checkDeterminism: boolean,
  phaseTimings: boolean,
): Promise<ScenarioRunMetrics> {
  const repo = setupRepo(fixture.baseFiles, fixture.headFiles);
  try {
    const collector = phaseTimings ? new PhaseTimingsCollector() : undefined;
    const t0 = Date.now();
    const report = await runDetector({
      repoPath: repo.path,
      baseRef: repo.baseSha,
      headRef: repo.headSha,
      threeDot: false,
      config: variant.config,
      perfLog: collector,
    });
    const wallMs = Date.now() - t0;

    if (checkDeterminism) {
      const second = await runDetector({
        repoPath: repo.path,
        baseRef: repo.baseSha,
        headRef: repo.headSha,
        threeDot: false,
        config: variant.config,
      });
      const a = JSON.stringify(report);
      const b = JSON.stringify(second);
      if (a !== b) {
        throw new Error(
          `Non-deterministic report for ${fixture.id} (${variant.label})`,
        );
      }
    }

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
      collector?.timings,
    );
  } finally {
    repo.cleanup();
  }
}

async function runVariant(
  fixtures: Fixture[],
  variant: ConfigVariant,
  checkDeterminism: boolean,
  phaseTimings: boolean,
): Promise<RunSummary> {
  const scenarios: ScenarioRunMetrics[] = [];
  const t0 = Date.now();
  for (const fixture of fixtures) {
    const metrics = await runScenario(
      fixture,
      variant,
      checkDeterminism,
      phaseTimings,
    );
    scenarios.push(metrics);
  }
  return { label: variant.label, scenarios, wallMs: Date.now() - t0 };
}

export async function runBench(argv: readonly string[]): Promise<number> {
  const cli = parseCli(argv);

  const suiteRoot = resolve("test/dedup/fixtures/suite");
  const fixtures = loadFixtures(suiteRoot, cli.only);
  if (fixtures.length === 0) {
    process.stderr.write(`no fixtures found in ${suiteRoot}\n`);
    return 1;
  }

  let baseConfig: Config = defaultConfig;
  let configLabel = "defaults";
  if (cli.configPath !== undefined) {
    const raw = readFileSync(cli.configPath, "utf-8");
    baseConfig = mergeConfig(JSON.parse(raw));
    configLabel = cli.configPath;
  }

  const variants = buildVariants(baseConfig, cli.noAblation);

  const runs: RunSummary[] = [];
  for (const variant of variants) {
    process.stderr.write(
      `running ${variant.label} (${String(fixtures.length)} fixtures)...\n`,
    );
    const run = await runVariant(
      fixtures,
      variant,
      cli.checkDeterminism,
      cli.phaseTimings,
    );
    runs.push(run);
  }

  const md = formatMarkdown({
    configLabel,
    fixtureCount: fixtures.length,
    runs,
  });
  const json = formatJson(configLabel, fixtures.length, runs);

  mkdirSync(cli.outDir, { recursive: true });
  const mdPath = join(cli.outDir, "summary.md");
  const jsonPath = join(cli.outDir, "summary.json");
  mkdirSync(dirname(mdPath), { recursive: true });
  writeFileSync(mdPath, md, "utf-8");
  writeFileSync(jsonPath, `${JSON.stringify(json, null, 2)}\n`, "utf-8");

  process.stdout.write(md);
  process.stderr.write(
    `\nwrote ${mdPath} and ${jsonPath} (${String(fixtures.length)} fixtures, ${String(runs.length)} runs)\n`,
  );
  return 0;
}

const isMain = import.meta.url === `file://${process.argv[1] ?? ""}`;
if (isMain) {
  runBench(process.argv).then(
    (code) => {
      process.exit(code);
    },
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`bench: ${msg}\n`);
      process.exit(1);
    },
  );
}
