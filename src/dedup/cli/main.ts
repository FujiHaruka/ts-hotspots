import { resolve } from "node:path";
import { defaultConfig } from "../config/index.ts";
import type { CloneCandidateReport } from "../domain/index.ts";
import { buildMarkdownReport } from "../report/index.ts";
import { ArgParseError, parseCliArgs, USAGE } from "./args.ts";
import { JsonlPerfLogger, type PerfLogger } from "./perfLog.ts";
import { runDetector } from "./runDetector.ts";
import { runWholeRepoDetector } from "./runWholeRepoDetector.ts";

export interface DedupWritable {
  write: (chunk: string) => unknown;
}

export interface MainIO {
  stdout: DedupWritable;
  stderr: DedupWritable;
  cwd: () => string;
}

const REAL_IO: MainIO = {
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: () => process.cwd(),
};

/**
 * CLI entry point. Returns an exit code instead of calling `process.exit`
 * so it can be exercised from tests.
 *
 * Behaviour:
 *   - `--help` / `-h`        → write usage to stderr, return 0.
 *   - missing required flag  → write error + usage hint to stderr, return 1.
 *   - any other thrown error → message to stderr, return 1.
 *   - on success             → report to stdout (Markdown by default, JSON
 *                              with `--format json`), stats line to stderr,
 *                              return 0 even when zero candidates were
 *                              reported.
 *   - `--phase-timings`      → in addition to the stats line, emit a
 *                              JSON Lines perf log to stderr (one event
 *                              per line, interleaved with the run).
 */
export async function main(
  argv: readonly string[],
  io: MainIO = REAL_IO,
): Promise<number> {
  let args: ReturnType<typeof parseCliArgs>;
  try {
    args = parseCliArgs(argv);
  } catch (err) {
    if (err instanceof ArgParseError) {
      io.stderr.write(`ts-hotspots dedup: ${err.message}\n\n${USAGE}`);
      return 1;
    }
    throw err;
  }

  if (args.kind === "help") {
    io.stderr.write(USAGE);
    return 0;
  }

  const repoPath = resolve(args.repoPath || io.cwd());

  const config =
    args.excludeGlobs.length === 0
      ? defaultConfig
      : {
          ...defaultConfig,
          exclude: {
            globs: [...defaultConfig.exclude.globs, ...args.excludeGlobs],
          },
        };

  const perfLog: PerfLogger | undefined =
    args.phaseTimings !== undefined
      ? new JsonlPerfLogger(io.stderr, args.phaseTimings)
      : undefined;

  try {
    const report: CloneCandidateReport =
      args.mode === "pr"
        ? await runDetector({
            repoPath,
            baseRef: args.baseRef,
            headRef: args.headRef,
            threeDot: args.threeDot,
            config,
            perfLog,
            includeCode: args.includeCode,
          })
        : await runWholeRepoDetector({
            repoPath,
            ref: args.ref,
            config,
            perfLog,
            includeCode: args.includeCode,
          });

    // Cap the group list at `--limit` (default 50). The runner produces
    // the full sorted list; we truncate at the display layer so the limit is
    // a presentation concern, not a pipeline one.
    const fullCount = report.groups.length;
    if (Number.isFinite(args.limit) && fullCount > args.limit) {
      report.groups = report.groups.slice(0, args.limit);
    }

    const output =
      args.format === "json"
        ? `${JSON.stringify(report, null, 2)}\n`
        : buildMarkdownReport(report);
    io.stdout.write(output);

    const summary = report.summary;
    const base = summary.scope.base;
    const pipeline = summary.pipeline;
    const displayed = report.groups.length;
    let fragmentsAcross = 0;
    for (const g of report.groups) fragmentsAcross += g.size;
    const sizeLine =
      summary.mode === "pr" && summary.scope.changed !== undefined
        ? `base=${String(base.files)} files/${String(base.fragments)} fragments, ` +
          `changed=${String(summary.scope.changed.files)} files/${String(summary.scope.changed.fragments)} fragments`
        : `repo=${String(base.files)} files/${String(base.fragments)} fragments`;
    const displayedNote =
      displayed === fullCount
        ? `displayed=${String(displayed)} groups (${String(fragmentsAcross)} fragments)`
        : `displayed=${String(displayed)} of ${String(fullCount)} groups (${String(fragmentsAcross)} fragments)`;
    io.stderr.write(
      `ts-hotspots dedup: ${sizeLine}, ` +
        `candidates=${String(pipeline.candidatePairs)}, reported=${String(pipeline.reportedPairs)}, ${displayedNote}\n`,
    );
    return 0;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    io.stderr.write(`ts-hotspots dedup: ${msg}\n`);
    return 1;
  }
}
