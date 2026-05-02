/**
 * Cochange pipeline orchestrator.
 *
 * `runPipeline(parsedArgs, io, deps)` is the production-path entry:
 * composes source loading, the git log walk, raw metric computation,
 * the gate, dismissal-registry application, serialisation, and
 * stdout/stderr framing. Mirrors `src/architecture/cli/main.ts`.
 *
 * `main(argv, io)` is the standalone entry — builds a private commander
 * program with the same `addCochangeCommand` registrar the root CLI
 * uses, parses argv, and runs the pipeline.
 *
 * The git invocation is injected via `deps.runGitLog` so tests can
 * stub it without spawning a real `git log`. In production the default
 * shells out to git in `runGitLog.ts`.
 *
 * Graceful skip path: non-git, missing git binary, empty walker
 * output — emit a single stderr warning and return an empty
 * `hotspots[]`, mirroring comp's churn graceful-skip shape.
 */

import { resolve as resolvePath } from "node:path";
import { Command, CommanderError } from "commander";
import pkg from "../../../package.json" with { type: "json" };
import {
  buildErrorWriters,
  type CliIO,
  type CliWritable,
  classifyGenericError,
  sniffFormat,
} from "../../cli/streaming.ts";
import { TOOL_NAME } from "../../cli-defaults.ts";
import { DEFAULT_EXCLUDE_GLOBS } from "../../defaults.ts";
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
  renderMarkdownHead,
  renderStatsLine,
} from "../../reporter/render.ts";
import type { DismissedSummary, ReportTool } from "../../schema.ts";
import { findGitRoot } from "../../util/git/findGitRoot.ts";
import { computeMetrics } from "../metrics/computeMetrics.ts";
import { applyGate } from "../ranking/applyGate.ts";
import {
  DEFAULT_CONFIDENCE_MAX_FLOOR,
  LIFT_FLOOR,
} from "../ranking/defaults.ts";
import { sortCandidates } from "../ranking/sort.ts";
import type {
  SerializedCochangeReport,
  SlimCochangeHotspot,
} from "../report/schema.ts";
import { serializeReport } from "../report/serializeJson.ts";
import { serializeMarkdown } from "../report/serializeMarkdown.ts";
import { walkCochange } from "../walk/walkCochange.ts";
import { ArgParseError, type CochangeParsedArgs } from "./args.ts";
import { loadCochangeSources } from "./loadSources.ts";
import { addCochangeCommand } from "./registerCommand.ts";
import { runGitIsShallow, runGitLog, runGitShowPrefix } from "./runGitLog.ts";

const TOOL: ReportTool = { name: TOOL_NAME, version: pkg.version };
const errorWriter = buildErrorWriters("cochange", TOOL);

const REAL_IO: CliIO = {
  stdout: process.stdout,
  stderr: process.stderr,
  cwd: () => process.cwd(),
};

export function writeCochangeParseError(
  io: CliIO,
  argv: readonly string[],
  err: unknown,
): void {
  const message = err instanceof Error ? err.message : String(err);
  errorWriter.pre(io, sniffFormat(argv), "INVALID_ARGS", message, message);
}

function classifyError(err: unknown): { code: string; message: string } {
  if (err instanceof ArgParseError) {
    return { code: "INVALID_ARGS", message: err.message };
  }
  return classifyGenericError(err);
}

function effectiveExcludeGlobs(args: CochangeParsedArgs): string[] {
  return [...DEFAULT_EXCLUDE_GLOBS, ...args.excludeGlobs];
}

/**
 * Dependencies overridable by tests. Production callers pass nothing —
 * the defaults shell out to real git.
 */
export interface CochangeRunDeps {
  runGitLog: typeof runGitLog;
  runGitShowPrefix: typeof runGitShowPrefix;
  runGitIsShallow: typeof runGitIsShallow;
}

const DEFAULT_DEPS: CochangeRunDeps = {
  runGitLog,
  runGitShowPrefix,
  runGitIsShallow,
};

function applyDismissalRegistry(
  rootDir: string,
  hotspots: SlimCochangeHotspot[],
  stderr: CliWritable,
): { hotspots: SlimCochangeHotspot[]; summary?: DismissedSummary } {
  const original = loadRegistry(rootDir, {
    onWarning: (msg) => {
      stderr.write(`${msg}\n`);
    },
  });
  if (original.entries.length === 0) return { hotspots };

  const currentIds = new Set<string>();
  for (const h of hotspots) currentIds.add(h.dismissalId);
  const { registry: pruned, prunedCount } = pruneRegistry(original, currentIds);
  if (prunedCount > 0) {
    saveRegistry(rootDir, withProjectPath(pruned, rootDir));
    const noun = prunedCount === 1 ? "dismissal" : "dismissals";
    stderr.write(
      renderStatsLine(
        "cochange",
        `pruned ${String(prunedCount)} expired ${noun} (pair changed since dismiss)`,
      ),
    );
  }
  const activeIds = registryIdSet(pruned);
  const kept: SlimCochangeHotspot[] = [];
  let filteredThisRun = 0;
  for (const h of hotspots) {
    if (activeIds.has(h.dismissalId)) {
      filteredThisRun += 1;
    } else {
      kept.push(h);
    }
  }
  return {
    hotspots: kept,
    summary: {
      active: pruned.entries.length,
      filteredThisRun,
      prunedThisRun: prunedCount,
    },
  };
}

export async function runPipeline(
  args: CochangeParsedArgs,
  io: CliIO,
  deps: CochangeRunDeps = DEFAULT_DEPS,
): Promise<number> {
  const startDir = args.path === undefined ? io.cwd() : resolvePath(args.path);
  let repoPath: string;
  try {
    repoPath = findGitRoot(startDir);
  } catch (err) {
    const { code, message } = classifyError(err);
    errorWriter.pre(io, args.format, code, message, message);
    return 1;
  }

  if (args.format === "markdown") {
    io.stdout.write(renderMarkdownHead("cochange"));
  }

  try {
    const exclude = effectiveExcludeGlobs(args);
    const filePaths = await loadCochangeSources({
      rootDir: repoPath,
      excludeGlobs: exclude,
    });
    const fileSet = new Set(filePaths);

    const ref = args.ref ?? "HEAD";
    const prefixRaw = deps.runGitShowPrefix(repoPath);
    const prefix =
      prefixRaw === undefined ? "" : prefixRaw.trim().replace(/\/$/, "");

    const rawLog = deps.runGitLog({
      rootDir: repoPath,
      ref,
      window: args.window,
    });

    const isShallow = deps.runGitIsShallow(repoPath);

    const reportInput = buildReportInput({
      args,
      rawLog,
      fileSet,
      prefix,
      analyzedFileCount: filePaths.length,
    });

    if (rawLog === undefined) {
      io.stderr.write(
        "ts-hotspots cochange: git log failed; emitting empty report\n",
      );
    } else if (isShallow) {
      io.stderr.write(
        "ts-hotspots cochange: history may be incomplete (shallow clone)\n",
      );
    }

    const fullReport = serializeReport(reportInput, { verbose: args.verbose });

    const { hotspots: hotspotsAfterDismissal, summary: dismissed } =
      applyDismissalRegistry(repoPath, fullReport.hotspots, io.stderr);

    const finalHotspots = Number.isFinite(args.limit)
      ? hotspotsAfterDismissal.slice(0, args.limit)
      : hotspotsAfterDismissal;

    const outReport: SerializedCochangeReport = {
      ...fullReport,
      hotspots: finalHotspots,
    };
    if (dismissed !== undefined) outReport.dismissed = dismissed;

    io.stdout.write(
      args.format === "json"
        ? renderJson(outReport)
        : renderMarkdownBody(outReport),
    );

    io.stderr.write(
      renderStatsLine(
        "cochange",
        buildStatsPayload(reportInput, finalHotspots.length, dismissed),
      ),
    );
    return 0;
  } catch (err) {
    const { code, message } = classifyError(err);
    const detail =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    errorWriter.post(io, args.format, code, message, detail);
    return 1;
  }
}

interface BuildReportInputArgs {
  args: CochangeParsedArgs;
  rawLog: string | undefined;
  fileSet: ReadonlySet<string>;
  prefix: string;
  analyzedFileCount: number;
}

function buildReportInput(input: BuildReportInputArgs): {
  candidates: ReturnType<typeof sortCandidates>;
  perFileChanges: ReadonlyMap<string, number>;
  windowCommits: number;
  analyzedFileCount: number;
  pairCandidateCountBeforeGate: number;
  pairsAfterGate: number;
  commitsSkippedAsLargeChange: number;
  requestedWindow: number;
  actualWindow: number;
  tool: ReportTool;
} {
  const { args, rawLog, fileSet, prefix, analyzedFileCount } = input;
  if (rawLog === undefined) {
    return {
      candidates: [],
      perFileChanges: new Map(),
      windowCommits: 0,
      analyzedFileCount,
      pairCandidateCountBeforeGate: 0,
      pairsAfterGate: 0,
      commitsSkippedAsLargeChange: 0,
      requestedWindow: args.window,
      actualWindow: 0,
      tool: TOOL,
    };
  }
  const walkResult = walkCochange(rawLog, fileSet, {
    prefix,
    maxFilesPerCommit: args.maxFilesPerCommit,
  });
  const metricsMap = computeMetrics(walkResult);
  const pairsBeforeGate = metricsMap.size;
  const gated = applyGate(metricsMap, walkResult.pairs, {
    minSupport: args.minSupport,
    confidenceMaxFloor: DEFAULT_CONFIDENCE_MAX_FLOOR,
    liftFloor: LIFT_FLOOR,
  });
  const pairsAfterGate = gated.length;
  const sorted = sortCandidates(gated, { limit: args.limit });
  return {
    candidates: sorted,
    perFileChanges: walkResult.perFileChanges,
    windowCommits: walkResult.actualWindow,
    analyzedFileCount,
    pairCandidateCountBeforeGate: pairsBeforeGate,
    pairsAfterGate,
    commitsSkippedAsLargeChange: walkResult.commitsSkippedAsLargeChange,
    requestedWindow: args.window,
    actualWindow: walkResult.actualWindow,
    tool: TOOL,
  };
}

function buildStatsPayload(
  reportInput: ReturnType<typeof buildReportInput>,
  displayed: number,
  dismissed: DismissedSummary | undefined,
): string {
  let payload =
    `files=${String(reportInput.analyzedFileCount)}, ` +
    `window=${String(reportInput.actualWindow)}/${String(reportInput.requestedWindow)} commits, ` +
    `pairsBeforeGate=${String(reportInput.pairCandidateCountBeforeGate)}, ` +
    `pairsAfterGate=${String(reportInput.pairsAfterGate)}, ` +
    `displayed=${String(displayed)}`;
  if (reportInput.commitsSkippedAsLargeChange > 0) {
    payload += `, skippedLarge=${String(reportInput.commitsSkippedAsLargeChange)}`;
  }
  if (dismissed !== undefined && dismissed.active > 0) {
    payload += `, dismissed=${String(dismissed.active)}`;
  }
  return payload;
}

export async function main(
  argv: readonly string[],
  io: CliIO = REAL_IO,
): Promise<number> {
  let parsed: CochangeParsedArgs | undefined;
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

  addCochangeCommand(program, (args) => {
    parsed = args;
  });

  try {
    await program.parseAsync(["node", TOOL_NAME, "cochange", ...argv]);
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === "commander.helpDisplayed") return 0;
      const message = err.message;
      errorWriter.pre(io, sniffFormat(argv), "INVALID_ARGS", message, message);
      return 1;
    }
    if (err instanceof ArgParseError) {
      errorWriter.pre(
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
    io.stderr.write(
      "ts-hotspots cochange: internal error — command did not run\n",
    );
    return 1;
  }

  return runPipeline(parsed, io);
}

// `serializeMarkdown` is exposed here so callers that want the
// human-card render can reach it through the same module surface as
// the JSON serializer used by `runPipeline`.
export { serializeMarkdown };
