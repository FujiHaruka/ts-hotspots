import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import pkg from "../../../package.json" with { type: "json" };
import { defaultConfig } from "../config/index.ts";
import type {
  CloneCandidateReport,
  DuplicationErrorReport,
  ReportTool,
} from "../domain/index.ts";
import { buildMarkdownReport } from "../report/index.ts";
import { ArgParseError, parseCliArgs, USAGE } from "./args.ts";
import { JsonlPerfLogger, type PerfLogger } from "./perfLog.ts";
import { runDetector } from "./runDetector.ts";
import { runWholeRepoDetector } from "./runWholeRepoDetector.ts";

const TOOL: ReportTool = { name: "ts-hotspots", version: pkg.version };

/**
 * Build the error JSON envelope. Mirrors `comp`'s shape so an agent
 * branching on `status` handles both subcommands the same way.
 */
function buildErrorReport(
  code: string,
  message: string,
): DuplicationErrorReport {
  return {
    status: "error",
    tool: TOOL,
    error: { code, message },
  };
}

/**
 * Render the error envelope for `--format markdown`. Until M3 introduces
 * the agent-first prelude, this is a minimal heading + fenced JSON body
 * so the body shape stays in lockstep with `comp`'s error markdown.
 */
function renderMarkdownError(report: DuplicationErrorReport): string {
  return `# ts-hotspots duplication error

\`\`\`json
${JSON.stringify(report, null, 2)}
\`\`\`
`;
}

/**
 * Write a fatal-error envelope to stdout in the requested format and the
 * raw human-readable message to stderr. `code` is one of the strings in
 * the dup error vocabulary (see comments below); `message` is what the
 * agent / human sees as the explanation.
 */
function writeFatalError(
  io: MainIO,
  format: "markdown" | "json",
  code: string,
  message: string,
  humanDetail: string,
): void {
  const report = buildErrorReport(code, message);
  io.stdout.write(
    format === "json"
      ? `${JSON.stringify(report, null, 2)}\n`
      : renderMarkdownError(report),
  );
  io.stderr.write(`ts-hotspots duplication: ${humanDetail}\n`);
}

/**
 * Best-effort `--format` extraction for the case where `parseCliArgs`
 * throws before we have a `ParsedArgs`. We still want a `--format json`
 * caller to receive a JSON envelope on its arg-parse failure.
 */
function sniffFormat(argv: readonly string[]): "markdown" | "json" {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--format=json") return "json";
    if (a === "--format=markdown") return "markdown";
    if (a === "--format") {
      const next = argv[i + 1];
      if (next === "json") return "json";
      if (next === "markdown") return "markdown";
    }
  }
  return "markdown";
}

function classifyError(err: unknown): { code: string; message: string } {
  if (err instanceof ArgParseError) {
    return { code: "INVALID_ARGS", message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  // Heuristic mapping: detector failures bubble up `git`-flavoured
  // messages most of the time. A more exhaustive vocabulary lands when
  // M5 introduces dismissal-side error codes.
  if (/^not in a git repository/.test(message)) {
    return { code: "NOT_A_GIT_REPO", message };
  }
  if (/git/i.test(message) || /spawn/i.test(message)) {
    return { code: "GIT_FAILED", message };
  }
  return { code: "UNKNOWN_ERROR", message };
}

/**
 * Walk up from `start` until a `.git` entry is found, returning that
 * directory. `.git` may be a directory (normal repo) or a file (worktree
 * / submodule), so we test for either via `existsSync`.
 */
function findGitRoot(start: string): string {
  let cur = resolve(start);
  while (true) {
    if (existsSync(join(cur, ".git"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) {
      throw new Error(`not in a git repository: ${start}`);
    }
    cur = parent;
  }
}

export interface DuplicationWritable {
  write: (chunk: string) => unknown;
}

export interface MainIO {
  stdout: DuplicationWritable;
  stderr: DuplicationWritable;
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
      // `parseCliArgs` failed before yielding a `ParsedArgs`, so we don't
      // have `args.format` to consult. Sniff `--format` directly from
      // argv to honour the common `--format json` case; everything else
      // defaults to markdown (the dup default).
      const { code, message } = classifyError(err);
      writeFatalError(
        io,
        sniffFormat(argv),
        code,
        message,
        `${err.message}\n\n${USAGE}`,
      );
      return 1;
    }
    throw err;
  }

  if (args.kind === "help") {
    io.stderr.write(USAGE);
    return 0;
  }

  let repoPath: string;
  try {
    repoPath = findGitRoot(args.path ?? io.cwd());
  } catch (err) {
    const { code, message } = classifyError(err);
    writeFatalError(io, args.format, code, message, message);
    return 1;
  }

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
            tool: TOOL,
          })
        : await runWholeRepoDetector({
            repoPath,
            ref: args.ref,
            config,
            perfLog,
            includeCode: args.includeCode,
            tool: TOOL,
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
      `ts-hotspots duplication: ${sizeLine}, ` +
        `candidates=${String(pipeline.candidatePairs)}, reported=${String(pipeline.reportedPairs)}, ${displayedNote}\n`,
    );
    return 0;
  } catch (err) {
    const { code, message } = classifyError(err);
    const humanDetail =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    writeFatalError(io, args.format, code, message, humanDetail);
    return 1;
  }
}
