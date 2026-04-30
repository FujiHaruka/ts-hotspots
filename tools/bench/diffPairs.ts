import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runDetector } from "../../src/dedup/cli/runDetector.ts";
import type { Config } from "../../src/dedup/config/index.ts";
import { defaultConfig } from "../../src/dedup/config/index.ts";
import { groupsToPairs, type ReportPair } from "./groupsToPairs.ts";

/**
 * Inspect *which* pairs are gained / lost when swapping tokenNgramSizes.
 * Used for false-positive triage: the sweep table tells us "+17 net" but
 * not whether those 17 are real duplicates or noise. This script dumps the
 * actual file/line ranges + scores so we can read them.
 */

interface Args {
  base: string;
  head: string;
  repo: string;
  baseline: string;
  variant: string;
  out: string;
}

function parseCli(argv: readonly string[]): Args {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      base: { type: "string" },
      head: { type: "string", default: "HEAD" },
      repo: { type: "string" },
      baseline: { type: "string" },
      variant: { type: "string" },
      out: { type: "string" },
    },
    strict: true,
  });
  if (
    values.base === undefined ||
    values.variant === undefined ||
    values.out === undefined
  ) {
    process.stderr.write("diffPairs: --base, --variant, --out are required\n");
    process.exit(2);
  }
  return {
    base: values.base,
    head: values.head,
    repo: values.repo ?? process.cwd(),
    baseline: values.baseline ?? "",
    variant: values.variant,
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

function loadConfig(path: string): Config {
  if (path === "") return defaultConfig;
  return mergeConfig(JSON.parse(readFileSync(path, "utf-8")));
}

function pairKey(p: ReportPair): string {
  return `${p.left.filePath}:${String(p.left.startLine)}::${p.right.filePath}:${String(p.right.startLine)}`;
}

async function runOnce(
  args: Args,
  config: Config,
): Promise<Map<string, ReportPair>> {
  const report = await runDetector({
    repoPath: args.repo,
    baseRef: args.base,
    headRef: args.head,
    threeDot: false,
    config,
  });
  const m = new Map<string, ReportPair>();
  for (const c of groupsToPairs(report.groups)) m.set(pairKey(c), c);
  return m;
}

function fmtRange(side: ReportPair["left"]): string {
  return `${side.filePath}:${String(side.startLine)}-${String(side.endLine)} (${side.kind})`;
}

function fmtPair(c: ReportPair): string {
  const s = c.scores;
  return [
    `- left:  ${fmtRange(c.left)}`,
    `  right: ${fmtRange(c.right)}`,
    `  scores:   combined=${s.combined.toFixed(3)} token=${s.tokenOverlap.toFixed(3)} stmt=${s.statementKindSimilarity.toFixed(3)} call=${s.callOverlap.toFixed(3)} size=${s.sizeCompatibility.toFixed(3)}`,
    `  evidence: calls=[${c.evidence.sharedCalls.slice(0, 3).join(", ")}] props=[${c.evidence.sharedProperties.slice(0, 3).join(", ")}] stmts=[${c.evidence.matchedStatementKinds.slice(0, 3).join(", ")}]`,
  ].join("\n");
}

async function main(): Promise<number> {
  const args = parseCli(process.argv);
  process.stderr.write(
    `baseline (${args.baseline === "" ? "default" : args.baseline})...\n`,
  );
  const baseline = await runOnce(args, loadConfig(args.baseline));
  process.stderr.write(`variant (${args.variant})...\n`);
  const variant = await runOnce(args, loadConfig(args.variant));

  const onlyInBaseline: ReportPair[] = [];
  const onlyInVariant: ReportPair[] = [];
  for (const [k, v] of baseline) if (!variant.has(k)) onlyInBaseline.push(v);
  for (const [k, v] of variant) if (!baseline.has(k)) onlyInVariant.push(v);

  // Sort by combined desc to see the "best" gains/losses first.
  onlyInBaseline.sort((a, b) => b.scores.combined - a.scores.combined);
  onlyInVariant.sort((a, b) => b.scores.combined - a.scores.combined);

  const lines: string[] = [];
  lines.push(
    `# pair diff: baseline=${args.baseline === "" ? "default" : args.baseline} vs variant=${args.variant}`,
  );
  lines.push("");
  lines.push(`range: ${args.base}..${args.head}`);
  lines.push("");
  lines.push(`## only in baseline (${String(onlyInBaseline.length)})`);
  lines.push("");
  for (const c of onlyInBaseline) lines.push(fmtPair(c), "");
  lines.push(`## only in variant (${String(onlyInVariant.length)})`);
  lines.push("");
  for (const c of onlyInVariant) lines.push(fmtPair(c), "");

  const out = `${lines.join("\n")}\n`;
  writeFileSync(args.out, out, "utf-8");
  process.stdout.write(`baseline pairs: ${String(baseline.size)}\n`);
  process.stdout.write(`variant pairs:  ${String(variant.size)}\n`);
  process.stdout.write(`only in baseline: ${String(onlyInBaseline.length)}\n`);
  process.stdout.write(`only in variant:  ${String(onlyInVariant.length)}\n`);
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
      process.stderr.write(`diffPairs: ${msg}\n`);
      process.exit(1);
    },
  );
}
