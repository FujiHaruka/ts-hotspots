import { Command, CommanderError } from "commander";
import pkg from "../../../package.json" with { type: "json" };
import {
  loadRegistry,
  pruneRegistry,
  registryIdSet,
  saveRegistry,
  withProjectPath,
} from "../../dismissal/store.ts";
import {
  renderJson,
  renderMarkdownBody,
  renderMarkdownErrorBody,
  renderMarkdownHead,
  renderMarkdownPreError,
  renderStatsLine,
} from "../../reporter/render.ts";
import { findGitRoot } from "../../util/git/findGitRoot.ts";
import { defaultConfig } from "../config/index.ts";
import type {
  CloneCandidateReport,
  DismissedSummary,
  DuplicationErrorReport,
  ReportTool,
} from "../domain/index.ts";
import { serializeReport } from "../report/serializeReport.ts";
import { ArgParseError, type ParsedArgs } from "./args.ts";
import { JsonlPerfLogger, type PerfLogger } from "./perfLog.ts";
import {
  addDuplicationCommand,
  normalizePhaseTimingsArgv,
} from "./registerCommand.ts";
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
 * Write a fatal error before any streaming has begun. JSON mode emits
 * the error envelope to stdout; Markdown mode emits the agent-first
 * pre-error block (heading + message), since no head has been flushed
 * yet so there is no JSON fence to close.
 */
function writePreStreamError(
  io: MainIO,
  format: "markdown" | "json",
  code: string,
  message: string,
  humanDetail: string,
): void {
  const report = buildErrorReport(code, message);
  io.stdout.write(
    format === "json"
      ? renderJson(report)
      : renderMarkdownPreError("duplication", message),
  );
  io.stderr.write(`ts-hotspots duplication: ${humanDetail}\n`);
}

/**
 * Write a fatal error after the Markdown head has been flushed. JSON
 * mode never streams a head, so JSON callers should use
 * `writePreStreamError` exclusively; this branch is markdown-only and
 * closes the open JSON fence with the error envelope as its body.
 */
function writePostStreamError(
  io: MainIO,
  format: "markdown" | "json",
  code: string,
  message: string,
  humanDetail: string,
): void {
  const report = buildErrorReport(code, message);
  io.stdout.write(
    format === "json" ? renderJson(report) : renderMarkdownErrorBody(report),
  );
  io.stderr.write(`ts-hotspots duplication: ${humanDetail}\n`);
}

/**
 * Best-effort `--format` extraction for the case where commander throws
 * before we have a `ParsedArgs`. We still want a `--format json` caller
 * to receive a JSON envelope on its arg-parse failure.
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

/**
 * Format an arg-parse failure surfaced by commander at the root CLI
 * level (e.g. `--ref` and `--diff` together, an unknown dup flag, a bad
 * `--limit` value). Mirrors the in-process error envelope that dup's
 * own `main(argv, io)` produces — markdown pre-error block or JSON
 * envelope on stdout, `ts-hotspots duplication:` prefix on stderr — so
 * dup's failure surface is identical whether the caller invoked us
 * through `src/cli.ts` or through `main(argv, io)`.
 */
export function writeDuplicationParseError(
  io: MainIO,
  argv: readonly string[],
  err: unknown,
): void {
  const message = err instanceof Error ? err.message : String(err);
  writePreStreamError(io, sniffFormat(argv), "INVALID_ARGS", message, message);
}

function classifyError(err: unknown): { code: string; message: string } {
  if (err instanceof ArgParseError) {
    return { code: "INVALID_ARGS", message: err.message };
  }
  const message = err instanceof Error ? err.message : String(err);
  // Heuristic mapping: detector failures bubble up `git`-flavoured
  // messages most of the time. A more exhaustive vocabulary lands when
  // M5 introduces dismissal-side error codes.
  if (message.startsWith("not in a git repository")) {
    return { code: "NOT_A_GIT_REPO", message };
  }
  if (/git/i.test(message) || /spawn/i.test(message)) {
    return { code: "GIT_FAILED", message };
  }
  return { code: "UNKNOWN_ERROR", message };
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

function buildStatsPayload(
  report: CloneCandidateReport,
  fullCount: number,
): string {
  const summary = report.summary;
  const base = summary.scope.base;
  const pipeline = summary.pipeline;
  const displayed = report.groups.length;
  let fragmentsAcross = 0;
  for (const g of report.groups) fragmentsAcross += g.size;
  const sizeLine =
    summary.mode === "diff" && summary.scope.changed !== undefined
      ? `base=${String(base.files)} files/${String(base.fragments)} fragments, ` +
        `changed=${String(summary.scope.changed.files)} files/${String(summary.scope.changed.fragments)} fragments`
      : `repo=${String(base.files)} files/${String(base.fragments)} fragments`;
  const displayedNote =
    displayed === fullCount
      ? `displayed=${String(displayed)} groups (${String(fragmentsAcross)} fragments)`
      : `displayed=${String(displayed)} of ${String(fullCount)} groups (${String(fragmentsAcross)} fragments)`;
  let payload =
    `${sizeLine}, ` +
    `candidates=${String(pipeline.candidatePairs)}, reported=${String(pipeline.reportedPairs)}, ${displayedNote}`;
  if (report.dismissed !== undefined && report.dismissed.active > 0) {
    payload += `, dismissed=${String(report.dismissed.active)}`;
  }
  return payload;
}

/**
 * Apply the dismissal registry to a freshly built report. Prunes entries
 * whose group is no longer reported (group composition changed — see
 * `membersToDupDismissalId` for the auto-expiration bias) and filters
 * surviving entries out of the displayed groups list.
 *
 * Returns the mutated report (groups list shortened in place) and a
 * `DismissedSummary` parallel to `comp`'s. Side-effect: the registry is
 * rewritten when at least one entry was pruned.
 */
function applyDismissalRegistry(
  rootDir: string,
  report: CloneCandidateReport,
  stderr: DuplicationWritable,
): DismissedSummary | undefined {
  const original = loadRegistry(rootDir, {
    onWarning: (msg) => {
      stderr.write(`${msg}\n`);
    },
  });
  if (original.entries.length === 0) return undefined;

  const currentIds = new Set<string>();
  for (const g of report.groups) currentIds.add(g.dismissalId);
  const { registry: pruned, prunedCount } = pruneRegistry(original, currentIds);
  if (prunedCount > 0) {
    saveRegistry(rootDir, withProjectPath(pruned, rootDir));
    const noun = prunedCount === 1 ? "dismissal" : "dismissals";
    stderr.write(
      renderStatsLine(
        "duplication",
        `pruned ${String(prunedCount)} expired ${noun} (group composition changed since dismiss)`,
      ),
    );
  }
  const activeIds = registryIdSet(pruned);
  const kept: CloneCandidateReport["groups"] = [];
  let filteredThisRun = 0;
  for (const g of report.groups) {
    if (activeIds.has(g.dismissalId)) {
      filteredThisRun += 1;
    } else {
      kept.push(g);
    }
  }
  report.groups = kept;
  return {
    active: pruned.entries.length,
    filteredThisRun,
    prunedThisRun: prunedCount,
  };
}

/**
 * Run the duplication detector pipeline against pre-parsed args. Used
 * both from `main(argv, io)` here and from the root CLI in `src/cli.ts`
 * once commander has handed us a `ParsedArgs`. Returns an exit code
 * instead of calling `process.exit` so callers can compose.
 *
 * Markdown streaming: the agent-first head (instruction + opening JSON
 * fence) is flushed to stdout *before* the detector starts so consumers
 * with short stdin timeouts (e.g. `claude --permission-mode plan`'s 3s
 * detect window) see well-formed Markdown immediately. Once the head is
 * out, any post-stream failure closes the fence with the error envelope
 * as its JSON body so the document remains parseable.
 */
export async function runPipeline(
  args: ParsedArgs,
  io: MainIO,
): Promise<number> {
  let repoPath: string;
  try {
    repoPath = findGitRoot(args.path ?? io.cwd());
  } catch (err) {
    const { code, message } = classifyError(err);
    writePreStreamError(io, args.format, code, message, message);
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

  if (args.format === "markdown") {
    io.stdout.write(renderMarkdownHead("duplication"));
  }

  const churnRunOpts = args.churn.enabled
    ? {
        window: args.churn.window,
        ref:
          args.churn.ref ?? (args.mode === "diff" ? args.headRef : args.ref),
        onWarning: (msg: string) => {
          io.stderr.write(`${msg}\n`);
        },
      }
    : undefined;

  try {
    const report: CloneCandidateReport =
      args.mode === "diff"
        ? await runDetector({
            repoPath,
            baseRef: args.baseRef,
            headRef: args.headRef,
            threeDot: args.threeDot,
            config,
            perfLog,
            includeCode: args.verbose,
            tool: TOOL,
            churn: churnRunOpts,
          })
        : await runWholeRepoDetector({
            repoPath,
            ref: args.ref,
            config,
            perfLog,
            includeCode: args.verbose,
            tool: TOOL,
            churn: churnRunOpts,
          });

    const dismissed = applyDismissalRegistry(repoPath, report, io.stderr);
    if (dismissed !== undefined) report.dismissed = dismissed;

    const fullCount = report.groups.length;
    if (Number.isFinite(args.limit) && fullCount > args.limit) {
      report.groups = report.groups.slice(0, args.limit);
    }

    const output = serializeReport(report, { verbose: args.verbose });
    io.stdout.write(
      args.format === "json" ? renderJson(output) : renderMarkdownBody(output),
    );
    io.stderr.write(
      renderStatsLine("duplication", buildStatsPayload(report, fullCount)),
    );
    return 0;
  } catch (err) {
    const { code, message } = classifyError(err);
    const humanDetail =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    writePostStreamError(io, args.format, code, message, humanDetail);
    return 1;
  }
}

/**
 * CLI entry point used by the duplication-only test surface and as the
 * legacy public API. The root CLI in `src/cli.ts` builds its own
 * commander program with the same `addDuplicationCommand` registrar, so
 * this function is not on the production path — it stays so tests can
 * exercise the dup pipeline end-to-end without going through comp's
 * top-level routing.
 *
 * Returns an exit code instead of calling `process.exit`.
 *
 * Behaviour:
 *   - `--help` / `-h`        → commander writes usage to stdout, return 0.
 *   - missing required flag  → write error envelope, return 1.
 *   - any other thrown error → message to stderr, return 1.
 *   - on success             → report to stdout (Markdown by default,
 *                              JSON with `--format json`), stats line to
 *                              stderr, return 0 even when zero candidates
 *                              were reported.
 *   - `--phase-timings`      → in addition to the stats line, emit a
 *                              JSON Lines perf log to stderr (one event
 *                              per line, interleaved with the run).
 */
export async function main(
  argv: readonly string[],
  io: MainIO = REAL_IO,
): Promise<number> {
  let parsed: ParsedArgs | undefined;
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: (s) => {
      io.stdout.write(s);
    },
    writeErr: (s) => {
      io.stderr.write(s);
    },
  });

  addDuplicationCommand(program, (args) => {
    parsed = args;
  });

  try {
    await program.parseAsync([
      "node",
      "ts-hotspots",
      "duplication",
      ...normalizePhaseTimingsArgv(argv),
    ]);
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === "commander.helpDisplayed") return 0;
      const message = err.message;
      writePreStreamError(io, sniffFormat(argv), "INVALID_ARGS", message, message);
      return 1;
    }
    if (err instanceof ArgParseError) {
      writePreStreamError(
        io,
        sniffFormat(argv),
        "INVALID_ARGS",
        err.message,
        err.message,
      );
      return 1;
    }
    throw err;
  }

  if (parsed === undefined) {
    // Unreachable in practice: commander either invokes the action
    // (sets `parsed`) or throws. Belt-and-braces: surface the anomaly
    // rather than silently returning 0.
    io.stderr.write(
      "ts-hotspots duplication: internal error — command did not run\n",
    );
    return 1;
  }

  return runPipeline(parsed, io);
}
