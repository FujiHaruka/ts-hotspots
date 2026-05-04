import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { runDetector } from "../../src/duplication/cli/runDetector.ts";
import type { Config } from "../../src/duplication/config/config.ts";
import { defaultConfig } from "../../src/duplication/config/defaults.ts";
import { groupsToPairs } from "./groupsToPairs.ts";

/**
 * Run the tokenNgramSizes sweep against the current repository, not
 * fixtures. The fixture suite is too small to differentiate sizes within
 * [3..8]; this probe picks a real `base..head` diff and reports per-variant
 * counts, score distribution, and result-set overlap with the default
 * `[3,4,5,6]`.
 */

interface VariantSpec {
  label: string;
  configPath: string | null;
}

const VARIANTS: VariantSpec[] = [
  { label: "[2,3]", configPath: "tools/bench/configs/ngram-2-3.json" },
  { label: "[2..6]", configPath: "tools/bench/configs/ngram-2-to-6.json" },
  { label: "[3,4,5]", configPath: "tools/bench/configs/ngram-3-4-5.json" },
  { label: "[3,4,5,6]", configPath: null },
  { label: "[3..7]", configPath: "tools/bench/configs/ngram-3-to-7.json" },
  { label: "[4,5,6]", configPath: "tools/bench/configs/ngram-4-5-6.json" },
  { label: "[4,5,6,7]", configPath: "tools/bench/configs/ngram-4-5-6-7.json" },
  { label: "[5,6,7,8]", configPath: "tools/bench/configs/ngram-5-6-7-8.json" },
  { label: "[3..8]", configPath: "tools/bench/configs/ngram-3-to-8.json" },
];

interface Args {
  base: string;
  head: string;
  repo: string;
  out: string;
}

function parseCli(argv: readonly string[]): Args {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      base: { type: "string" },
      head: { type: "string", default: "HEAD" },
      repo: { type: "string" },
      out: { type: "string", default: "tools/bench/baseline/sweep-self.md" },
    },
    strict: true,
  });
  if (values.base === undefined) {
    process.stderr.write("sweepSelf: --base <ref> is required\n");
    process.exit(2);
  }
  return {
    base: values.base,
    head: values.head,
    repo: values.repo ?? process.cwd(),
    out: values.out,
  };
}

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

function loadConfig(spec: VariantSpec): Config {
  if (spec.configPath === null) return defaultConfig;
  const raw = readFileSync(spec.configPath, "utf-8");
  return mergeConfig(JSON.parse(raw));
}

interface VariantResult {
  label: string;
  reported: number;
  candidatePairs: number;
  meanScore: number;
  medianScore: number;
  p90Score: number;
  /** Set of `leftPath::rightPath::startLine` keys (line-tolerant ID for a reported pair). */
  pairKeys: Set<string>;
  wallMs: number;
}

function pairKey(p: {
  left: { filePath: string; startLine: number };
  right: { filePath: string; startLine: number };
}): string {
  return `${p.left.filePath}:${String(p.left.startLine)}::${p.right.filePath}:${String(p.right.startLine)}`;
}

function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(q * (sorted.length - 1) + 0.5)),
  );
  return sorted[idx] ?? 0;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

async function runVariant(
  args: Args,
  spec: VariantSpec,
): Promise<VariantResult> {
  const config = loadConfig(spec);
  const t0 = Date.now();
  const report = await runDetector({
    repoPath: args.repo,
    baseRef: args.base,
    headRef: args.head,
    threeDot: false,
    config,
  });
  const wallMs = Date.now() - t0;

  const pairs = groupsToPairs(report.groups);
  const scores = pairs.map((p) => p.scores.combined);
  const pairKeys = new Set<string>();
  for (const p of pairs) pairKeys.add(pairKey(p));

  const meanScore =
    scores.length === 0
      ? 0
      : scores.reduce((acc: number, s: number) => acc + s, 0) / scores.length;

  return {
    label: spec.label,
    reported: pairs.length,
    candidatePairs: report.summary.pipeline.candidatePairs,
    meanScore,
    medianScore: quantile(scores, 0.5),
    p90Score: quantile(scores, 0.9),
    pairKeys,
    wallMs,
  };
}

async function main(): Promise<number> {
  const args = parseCli(process.argv);
  const results: VariantResult[] = [];
  for (const v of VARIANTS) {
    process.stderr.write(`running ${v.label}...\n`);
    results.push(await runVariant(args, v));
  }

  const baseline = results.find((r) => r.label === "[3,4,5,6]");
  if (baseline === undefined) throw new Error("baseline missing");

  const lines: string[] = [];
  lines.push("# tokenNgramSizes sweep on this repo");
  lines.push("");
  lines.push(`repo: ${args.repo}`);
  lines.push(`range: \`${args.base}..${args.head}\` (two-dot)`);
  lines.push("");
  lines.push("## summary");
  lines.push("");
  lines.push(
    "| sizes        | reported | candidates | mean score | median | p90  | jaccard vs default | wall   |",
  );
  lines.push(
    "|--------------|---------:|-----------:|-----------:|-------:|-----:|-------------------:|-------:|",
  );
  for (const r of results) {
    const j = r === baseline ? 1 : jaccard(baseline.pairKeys, r.pairKeys);
    lines.push(
      `| ${r.label.padEnd(12)} | ${String(r.reported).padStart(8)} | ${String(r.candidatePairs).padStart(10)} |       ${r.meanScore.toFixed(3)} |  ${r.medianScore.toFixed(3)} | ${r.p90Score.toFixed(3)} |               ${j.toFixed(3)} | ${(r.wallMs / 1000).toFixed(2).padStart(5)}s |`,
    );
  }
  lines.push("");
  lines.push("## set diffs vs [3,4,5,6]");
  lines.push("");
  for (const r of results) {
    if (r === baseline) continue;
    let onlyInBaseline = 0;
    let onlyInVariant = 0;
    for (const k of baseline.pairKeys)
      if (!r.pairKeys.has(k)) onlyInBaseline += 1;
    for (const k of r.pairKeys)
      if (!baseline.pairKeys.has(k)) onlyInVariant += 1;
    lines.push(
      `- **${r.label}**: only-in-default=${String(onlyInBaseline)}, only-in-${r.label}=${String(onlyInVariant)}`,
    );
  }
  lines.push("");

  const out = `${lines.join("\n")}\n`;
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, out, "utf-8");
  process.stdout.write(out);
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
      process.stderr.write(`sweepSelf: ${msg}\n`);
      process.exit(1);
    },
  );
}
