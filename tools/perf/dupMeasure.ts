/**
 * `dup` performance measurement harness.
 *
 * Runs `pnpm start dup --phase-timings` N times against the current
 * working tree and reports the per-phase median + p25/p75. Optionally
 * does an A/B comparison against another git ref via `git stash`, and
 * runs the bench harness to verify recall hasn't regressed.
 *
 * Discards the first run as a warm-up — Node 24's strip-only TypeScript
 * mode parses every src/ module at import time, and the JIT needs a
 * pass before scoring stabilises.
 *
 * Usage:
 *   pnpm perf:dup                          # warm + 5 runs, median table
 *   pnpm perf:dup --runs 10                # 1 warm + 10 measured runs
 *   pnpm perf:dup --compare HEAD~1         # A/B vs another ref
 *   pnpm perf:dup --bench                  # also run bench harness
 *   pnpm perf:dup --report-diff            # also diff dismissalIds A vs B
 *   pnpm perf:dup --verbose                # also show LSH/scoring breakdown
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

interface CliArgs {
  runs: number;
  compare: string | undefined;
  bench: boolean;
  reportDiff: boolean;
  verbose: boolean;
}

const USAGE = `pnpm perf:dup [options]

Options:
  --runs <N>          number of warm runs (default 5; +1 cold-start warmup)
  --compare <ref>     A/B compare current worktree against <ref> (uses git stash)
  --bench             also run pnpm bench --no-ablation for recall check
  --report-diff       diff dismissalId set between A and B (only with --compare)
  --verbose           also report LSH per-axis + scoring sub-phase wall
  -h, --help          show this help
`;

function parseCli(argv: readonly string[]): CliArgs {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      runs: { type: "string", default: "5" },
      compare: { type: "string" },
      bench: { type: "boolean", default: false },
      "report-diff": { type: "boolean", default: false },
      verbose: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  const runs = Number.parseInt(values.runs ?? "5", 10);
  if (!Number.isFinite(runs) || runs < 1) {
    process.stderr.write(
      `--runs must be a positive integer (got ${values.runs ?? ""})\n`,
    );
    process.exit(2);
  }
  return {
    runs,
    compare: values.compare,
    bench: values.bench ?? false,
    reportDiff: values["report-diff"] ?? false,
    verbose: values.verbose ?? false,
  };
}

interface PhaseTiming {
  diff: number;
  listBase: number;
  churn: number;
  baseIndex: number;
  headSearch: number;
  report: number;
  total: number;
}

const PHASE_NAMES: readonly (keyof PhaseTiming)[] = [
  "diff",
  "listBase",
  "churn",
  "baseIndex",
  "headSearch",
  "report",
  "total",
];

interface VerboseExtras {
  lshTokenMs: number;
  lshCallMs: number;
  lshStatementMs: number;
  scoringMs: number;
  scoringUsPerPair: number;
  candidatePairs: number;
  reportedGroups: number;
}

interface RunResult {
  timing: PhaseTiming;
  extras: VerboseExtras | undefined;
}

/** Run `pnpm start dup --phase-timings[=verbose]` once and parse stderr. */
function runOnce(verbose: boolean): RunResult {
  const flag = verbose ? "--phase-timings=verbose" : "--phase-timings";
  const res = spawnSync("pnpm", ["--silent", "start", "dup", flag], {
    encoding: "utf-8",
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.status !== 0) {
    process.stderr.write(
      `dup run failed (exit ${String(res.status)}):\n${res.stderr}\n`,
    );
    process.exit(1);
  }
  const timing: PhaseTiming = {
    diff: 0,
    listBase: 0,
    churn: 0,
    baseIndex: 0,
    headSearch: 0,
    report: 0,
    total: 0,
  };
  let lastTs = 0;
  let extras: VerboseExtras | undefined;
  let lshTokenMs = 0;
  let lshCallMs = 0;
  let lshStatementMs = 0;
  let scoringMs = 0;
  let scoringUsPerPair = 0;
  let candidatePairs = 0;
  let reportedGroups = 0;
  for (const raw of res.stderr.split("\n")) {
    const line = raw.trim();
    if (line === "" || !line.startsWith("{")) continue;
    let evt: Record<string, unknown>;
    try {
      evt = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (evt.event === "phase.end" && typeof evt.phase === "string") {
      const phase = evt.phase as keyof PhaseTiming;
      const wall = typeof evt.wallMs === "number" ? evt.wallMs : 0;
      if (phase in timing) timing[phase] = wall;
      if (typeof evt.ts === "number" && evt.ts > lastTs) lastTs = evt.ts;
    } else if (verbose && evt.event === "lsh.summary") {
      const axis = evt.axis as string | undefined;
      const wall = typeof evt.buildWallMs === "number" ? evt.buildWallMs : 0;
      // The reported buildWallMs is just the LSH index build, not the
      // iterate/visit. We keep it as-is — the report column documents
      // the build cost; iterate/visit/scoring lives in the scoring
      // sub-phase + headSearch totals.
      if (axis === "token") lshTokenMs = wall;
      if (axis === "call") lshCallMs = wall;
      if (axis === "statement") lshStatementMs = wall;
    } else if (verbose && evt.event === "scoring.summary") {
      scoringMs = typeof evt.wallMs === "number" ? evt.wallMs : 0;
      scoringUsPerPair = typeof evt.usPerPair === "number" ? evt.usPerPair : 0;
      candidatePairs = typeof evt.pairs === "number" ? evt.pairs : 0;
    } else if (verbose && evt.event === "report.summary") {
      reportedGroups =
        typeof evt.reportedGroups === "number" ? evt.reportedGroups : 0;
    }
  }
  timing.total = lastTs;
  if (verbose) {
    extras = {
      lshTokenMs,
      lshCallMs,
      lshStatementMs,
      scoringMs,
      scoringUsPerPair,
      candidatePairs,
      reportedGroups,
    };
  }
  return { timing, extras };
}

interface PhaseStats {
  median: number;
  p25: number;
  p75: number;
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(
    sorted.length - 1,
    Math.max(0, Math.floor(q * (sorted.length - 1) + 0.5)),
  );
  return sorted[idx] ?? 0;
}

function summarise(values: readonly number[]): PhaseStats {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: quantile(sorted, 0.5),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
  };
}

interface MeasureResult {
  perPhase: Record<keyof PhaseTiming, PhaseStats>;
  extras: VerboseExtras | undefined;
}

function measure(opts: {
  runs: number;
  verbose: boolean;
  label: string;
}): MeasureResult {
  process.stderr.write(`[${opts.label}] warmup run...\n`);
  runOnce(opts.verbose); // discard
  const results: RunResult[] = [];
  for (let i = 0; i < opts.runs; i++) {
    process.stderr.write(
      `[${opts.label}] run ${String(i + 1)}/${String(opts.runs)}...\n`,
    );
    results.push(runOnce(opts.verbose));
  }
  const perPhase = {} as Record<keyof PhaseTiming, PhaseStats>;
  for (const phase of PHASE_NAMES) {
    const values = results.map((r) => r.timing[phase]);
    perPhase[phase] = summarise(values);
  }
  // Extras: median of the verbose extras across runs.
  let extras: VerboseExtras | undefined;
  if (opts.verbose && results.every((r) => r.extras !== undefined)) {
    // The `every` guard above proves r.extras is set on every entry.
    // biome-ignore lint/style/noNonNullAssertion: invariant from `every`
    const pick = (f: (e: VerboseExtras) => number): number =>
      summarise(results.map((r) => f(r.extras!))).median;
    extras = {
      lshTokenMs: pick((e) => e.lshTokenMs),
      lshCallMs: pick((e) => e.lshCallMs),
      lshStatementMs: pick((e) => e.lshStatementMs),
      scoringMs: pick((e) => e.scoringMs),
      scoringUsPerPair: pick((e) => e.scoringUsPerPair),
      candidatePairs: pick((e) => e.candidatePairs),
      reportedGroups: pick((e) => e.reportedGroups),
    };
  }
  return { perPhase, extras };
}

function fmt(n: number): string {
  return n.toFixed(1).padStart(8);
}

function fmtPct(after: number, before: number): string {
  if (before === 0) return "    n/a";
  const delta = ((after - before) / before) * 100;
  const sign = delta >= 0 ? "+" : "";
  return `${sign}${delta.toFixed(1)}%`.padStart(7);
}

function printSingle(result: MeasureResult): void {
  process.stdout.write("\nPhase            | median | p25    | p75   \n");
  process.stdout.write("-----------------|--------|--------|-------\n");
  for (const phase of PHASE_NAMES) {
    const s = result.perPhase[phase];
    process.stdout.write(
      `${phase.padEnd(16)} | ${fmt(s.median)} | ${fmt(s.p25)} | ${fmt(s.p75)}\n`,
    );
  }
  if (result.extras !== undefined) {
    process.stdout.write("\nVerbose extras (median):\n");
    process.stdout.write(
      `  lsh.build  token=${result.extras.lshTokenMs.toFixed(1)}ms  call=${result.extras.lshCallMs.toFixed(1)}ms  statement=${result.extras.lshStatementMs.toFixed(1)}ms\n`,
    );
    process.stdout.write(
      `  scoring    ${result.extras.scoringMs.toFixed(1)}ms  (${result.extras.scoringUsPerPair.toFixed(1)}μs/pair)\n`,
    );
    process.stdout.write(
      `  candidates ${String(result.extras.candidatePairs)}  reportedGroups ${String(result.extras.reportedGroups)}\n`,
    );
  }
}

function printCompare(
  before: MeasureResult,
  after: MeasureResult,
  beforeLabel: string,
  afterLabel: string,
): void {
  process.stdout.write(
    `\nPhase            | ${beforeLabel.padEnd(8)} | ${afterLabel.padEnd(8)} | delta\n`,
  );
  process.stdout.write("-----------------|----------|----------|--------\n");
  for (const phase of PHASE_NAMES) {
    const b = before.perPhase[phase].median;
    const a = after.perPhase[phase].median;
    process.stdout.write(
      `${phase.padEnd(16)} | ${fmt(b)} | ${fmt(a)} | ${fmtPct(a, b)}\n`,
    );
  }
  if (before.extras !== undefined && after.extras !== undefined) {
    process.stdout.write("\nVerbose extras (median):\n");
    const fields: [keyof VerboseExtras, string][] = [
      ["lshTokenMs", "lsh.build token"],
      ["lshCallMs", "lsh.build call"],
      ["lshStatementMs", "lsh.build statement"],
      ["scoringMs", "scoring wallMs"],
      ["scoringUsPerPair", "scoring μs/pair"],
      ["candidatePairs", "candidatePairs"],
      ["reportedGroups", "reportedGroups"],
    ];
    for (const [key, label] of fields) {
      const b = before.extras[key];
      const a = after.extras[key];
      process.stdout.write(
        `  ${label.padEnd(22)} ${fmt(b)} → ${fmt(a)}  (${fmtPct(a, b)})\n`,
      );
    }
  }
}

function gitStash(): boolean {
  const res = spawnSync(
    "git",
    ["stash", "push", "-u", "-m", "perf-dup-measure"],
    {
      encoding: "utf-8",
    },
  );
  if (res.status !== 0) {
    process.stderr.write(`git stash failed: ${res.stderr}\n`);
    process.exit(1);
  }
  // `git stash push` exits 0 even when there's nothing to stash — detect via output.
  return !res.stdout.includes("No local changes to save");
}

function gitStashPop(): void {
  const res = spawnSync("git", ["stash", "pop"], { encoding: "utf-8" });
  if (res.status !== 0) {
    process.stderr.write(
      `git stash pop failed (worktree may be dirty): ${res.stderr}\n`,
    );
    process.exit(1);
  }
}

function gitCheckout(ref: string): void {
  const res = spawnSync("git", ["checkout", ref], { encoding: "utf-8" });
  if (res.status !== 0) {
    process.stderr.write(`git checkout ${ref} failed: ${res.stderr}\n`);
    process.exit(1);
  }
}

function gitCurrentRef(): string {
  // Prefer a symbolic ref (branch) so restore lands the user back on
  // their branch, not a detached HEAD pointing at the SHA.
  const sym = spawnSync("git", ["symbolic-ref", "--quiet", "HEAD"], {
    encoding: "utf-8",
  });
  if (sym.status === 0) {
    const refname = sym.stdout.trim();
    return refname.startsWith("refs/heads/")
      ? refname.slice("refs/heads/".length)
      : refname;
  }
  // Detached HEAD — fall back to the SHA.
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" });
  if (sha.status !== 0) {
    process.stderr.write(`git rev-parse HEAD failed: ${sha.stderr}\n`);
    process.exit(1);
  }
  return sha.stdout.trim();
}

function captureReportIds(): string[] {
  const tmp = mkdtempSync(join(tmpdir(), "perf-dup-"));
  const jsonPath = join(tmp, "report.json");
  const res = spawnSync(
    "sh",
    [
      "-c",
      `pnpm --silent start dup --format json --limit all > ${jsonPath} 2>/dev/null`,
    ],
    { encoding: "utf-8" },
  );
  if (res.status !== 0) {
    rmSync(tmp, { recursive: true, force: true });
    process.stderr.write(`dup --format json failed: ${res.stderr}\n`);
    process.exit(1);
  }
  const jq = spawnSync(
    "jq",
    ["-r", "[.hotspots[].dismissalId] | sort | .[]", jsonPath],
    { encoding: "utf-8" },
  );
  rmSync(tmp, { recursive: true, force: true });
  if (jq.status !== 0) {
    process.stderr.write(`jq failed: ${jq.stderr}\n`);
    process.exit(1);
  }
  return jq.stdout.split("\n").filter((s) => s !== "");
}

function diffReports(
  beforeIds: readonly string[],
  afterIds: readonly string[],
): void {
  const beforeSet = new Set(beforeIds);
  const afterSet = new Set(afterIds);
  let onlyBefore = 0;
  for (const id of beforeIds) if (!afterSet.has(id)) onlyBefore += 1;
  let onlyAfter = 0;
  for (const id of afterIds) if (!beforeSet.has(id)) onlyAfter += 1;
  process.stdout.write("\nReport diff (dismissalId set):\n");
  process.stdout.write(`  before: ${String(beforeIds.length)} groups\n`);
  process.stdout.write(`  after:  ${String(afterIds.length)} groups\n`);
  process.stdout.write(`  only-in-before: ${String(onlyBefore)}\n`);
  process.stdout.write(`  only-in-after:  ${String(onlyAfter)}\n`);
  if (onlyBefore === 0 && onlyAfter === 0) {
    process.stdout.write("  bit-identical ✓\n");
  }
}

interface BenchResult {
  recallAll: string;
  negViolations: string;
  wall: string;
}

function runBench(): BenchResult {
  process.stderr.write("[bench] running pnpm bench --no-ablation...\n");
  const res = spawnSync("pnpm", ["bench", "--no-ablation"], {
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.status !== 0) {
    process.stderr.write(`bench failed: ${res.stderr}\n`);
    process.exit(1);
  }
  // Restore bench artifacts the harness wrote out.
  spawnSync("git", ["checkout", "tools/bench/baseline/summary.md"], {
    encoding: "utf-8",
  });
  spawnSync("rm", ["-f", "tools/bench/baseline/summary.json"], {
    encoding: "utf-8",
  });
  // Parse the baseline row.
  const baselineRow = res.stdout
    .split("\n")
    .find((l) => l.startsWith("| baseline"));
  if (baselineRow === undefined) {
    return { recallAll: "?", negViolations: "?", wall: "?" };
  }
  const cells = baselineRow.split("|").map((s) => s.trim());
  return {
    recallAll: cells[4] ?? "?",
    negViolations: cells[5] ?? "?",
    wall: cells[6] ?? "?",
  };
}

function main(): void {
  const args = parseCli(process.argv);

  if (args.compare === undefined) {
    // Single-mode measurement.
    const result = measure({
      runs: args.runs,
      verbose: args.verbose,
      label: "current",
    });
    printSingle(result);
    if (args.bench) {
      const bench = runBench();
      process.stdout.write(
        `\nBench: recall@all=${bench.recallAll}  neg=${bench.negViolations}  wall=${bench.wall}\n`,
      );
    }
    return;
  }

  // Compare mode.
  const compareRef = args.compare;
  const startRef = gitCurrentRef();
  const stashed = gitStash();
  let beforeIds: string[] = [];
  let afterIds: string[] = [];
  let beforeResult: MeasureResult;
  try {
    gitCheckout(compareRef);
    if (args.reportDiff) beforeIds = captureReportIds();
    beforeResult = measure({
      runs: args.runs,
      verbose: args.verbose,
      label: `${compareRef.slice(0, 8)} (before)`,
    });
  } finally {
    gitCheckout(startRef);
    if (stashed) gitStashPop();
  }
  if (args.reportDiff) afterIds = captureReportIds();
  const afterResult = measure({
    runs: args.runs,
    verbose: args.verbose,
    label: "worktree (after)",
  });
  printCompare(beforeResult, afterResult, compareRef.slice(0, 8), "worktree");
  if (args.reportDiff) diffReports(beforeIds, afterIds);
  if (args.bench) {
    const bench = runBench();
    process.stdout.write(
      `\nBench (after): recall@all=${bench.recallAll}  neg=${bench.negViolations}  wall=${bench.wall}\n`,
    );
  }
}

const isMain = import.meta.url === `file://${process.argv[1] ?? ""}`;
if (isMain) {
  try {
    main();
  } catch (err) {
    process.stderr.write(
      `perf:dup: ${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exit(1);
  }
}
