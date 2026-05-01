import { existsSync, statSync } from "node:fs";
import { relative, resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import pkg from "../package.json" with { type: "json" };
import { aggregate } from "./aggregator/aggregate.ts";
import { splitFunctionLocation } from "./aggregator/function-location.ts";
import {
  collectFunctionRefKeys,
  computeFunctionAxisMeta,
  computeFunctionCoOccurrence,
  computeFunctionHotspotCandidates,
  emptyFunctionRankings,
  filterFunctionRankings,
  functionRefKey,
  isFunctionAxisId,
  rankFunctions,
} from "./aggregator/rank.ts";
import { runDismiss, runListDismissed, runUndismiss } from "./cli/dismiss.ts";
import { collectChurn } from "./collectors/churn/commit-count.ts";
import { enumerateDeclarations } from "./collectors/enumerate-declarations.ts";
import { DEFAULT_EXCLUDE_GLOBS } from "./defaults.ts";
import { bodyHashToCompDismissalId } from "./dismissal/hash.ts";
import {
  loadRegistry,
  pruneRegistry,
  registryIdSet,
  saveRegistry,
  withProjectPath,
} from "./dismissal/store.ts";
import { main as runDuplicationMain } from "./duplication/cli/main.ts";
import {
  listRepoSources,
  NotAGitRepositoryError,
} from "./loader/listRepoSources.ts";
import { loadProject } from "./loader/load-project.ts";
import {
  renderJson,
  renderMarkdownBody,
  renderMarkdownErrorBody,
  renderMarkdownHead,
  renderMarkdownPreError,
  renderStatsLine,
} from "./reporter/render.ts";
import type {
  AxisMeta,
  DismissedSummary,
  ErrorReport,
  FunctionAxisId,
  FunctionCoOccurrenceEntry,
  FunctionEntry,
  FunctionReport,
  HotspotCandidate,
  PrInfo,
  RankedFunctionEntry,
  ReportProject,
} from "./schema.ts";
import { FUNCTION_AXIS_IDS } from "./schema.ts";
import { findGitRoot } from "./util/git/findGitRoot.ts";
import { listChangedFilePaths } from "./util/git/listChangedFilePaths.ts";
import {
  parseRevRange,
  type RevRange,
  RevRangeParseError,
} from "./util/git/parseRevRange.ts";
import { resolveDiffEndpoints } from "./util/git/runner.ts";

export interface WritableLike {
  write: (chunk: string) => void;
}

// Per-axis ranking depth used internally to seed hotspot candidate
// computation. Not user-facing — bumping this widens the candidate pool
// before `--limit` truncation.
const INTERNAL_AXIS_TOP_N = 10;

export const DEFAULT_LIMIT = 20;
export const DEFAULT_FORMAT = "markdown" as const;
export const DEFAULT_CHURN_WINDOW = 200;
export const DEFAULT_CHURN_REF = "HEAD";

type ReportFormat = "markdown" | "json";

interface ChurnCliOptions {
  churnWindow?: number;
  churnRef?: string;
  churn?: boolean;
}

interface FunctionCliOptions extends ChurnCliOptions {
  exclude?: string[];
  limit?: number;
  metrics?: string[];
  file?: string;
  verbose?: boolean;
  format?: ReportFormat;
  pr?: RevRange;
}

interface DismissCliOptions {
  reason: string;
  path?: string;
}

interface ListDismissedCliOptions {
  json?: boolean;
  path?: string;
}

interface UndismissCliOptions {
  path?: string;
}

function parsePositiveInt(label: string, value: string): number {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n) || n <= 0 || String(n) !== value.trim()) {
    throw new InvalidArgumentError(`${label} must be a positive integer`);
  }
  return n;
}

function parseLimit(value: string): number {
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === "all") return Number.POSITIVE_INFINITY;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isFinite(n) || n <= 0 || !/^\d+$/.test(trimmed)) {
    throw new InvalidArgumentError(
      "--limit must be a positive integer or 'all'",
    );
  }
  return n;
}

function parseFormat(value: string): ReportFormat {
  if (value === "markdown" || value === "json") return value;
  throw new InvalidArgumentError("--format must be 'markdown' or 'json'");
}

function parsePr(value: string): RevRange {
  try {
    return parseRevRange(value);
  } catch (err) {
    if (err instanceof RevRangeParseError) {
      throw new InvalidArgumentError(err.message);
    }
    throw err;
  }
}

function parseChurnWindow(value: string): number {
  return parsePositiveInt("--churn-window", value);
}

function parseMetrics(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

type PendingInvocation =
  | {
      kind: "complexity";
      positional: string | undefined;
      options: FunctionCliOptions;
    }
  | {
      kind: "dismiss";
      id: string;
      reason: string;
      path: string | undefined;
    }
  | {
      kind: "list-dismissed";
      json: boolean;
      path: string | undefined;
    }
  | {
      kind: "undismiss";
      id: string;
      path: string | undefined;
    }
  | {
      kind: "duplication";
      argv: string[];
    };

export function buildCli(onInvoke: (inv: PendingInvocation) => void): Command {
  const program = new Command();
  program.enablePositionalOptions();
  program
    .name("ts-hotspots")
    .description("TypeScript metrics reporter")
    .version(pkg.version);

  program
    .command("complexity [path]")
    .alias("comp")
    .description(
      "rank functions and files by complexity / size / churn (per-function hotspot candidates)",
    )
    .option(
      "-e, --exclude <glob...>",
      "extra path glob(s) to exclude on top of the built-in defaults (node_modules, dist, generated files, test files, ...)",
    )
    .option(
      "--limit <N|all>",
      "max entries in hotspots[] (default: 20). Pass 'all' to keep every candidate.",
      parseLimit,
    )
    .option(
      "-m, --metrics <list>",
      "comma-separated axis ids to include",
      parseMetrics,
    )
    .option("--file <path>", "drill down into a single file (raw metrics only)")
    .option(
      "--verbose",
      "emit the rich report (all axes, coOccurrence, functions[])",
    )
    .option(
      "--churn-window <N>",
      "commits scanned for git churn",
      parseChurnWindow,
      DEFAULT_CHURN_WINDOW,
    )
    .option(
      "--churn-ref <ref>",
      "git ref from which churn is counted",
      DEFAULT_CHURN_REF,
    )
    .option("--no-churn", "disable git churn collection")
    .option(
      "--format <markdown|json>",
      "report format (default: markdown)",
      parseFormat,
    )
    .option(
      "--pr <revrange>",
      "scope hotspot output to functions in files changed by <revrange> (e.g. origin/main...). Rankings are still computed against the full head ref so the distribution is intact.",
      parsePr,
    )
    .action((pathArg: string | undefined, opts: FunctionCliOptions) => {
      onInvoke({ kind: "complexity", positional: pathArg, options: opts });
    });

  program
    .command("dismiss <id>")
    .description(
      "record a dismissal so this candidate is filtered from future runs",
    )
    .requiredOption(
      "--reason <text>",
      "why this candidate is not a real hotspot",
    )
    .option("--path <path>", "project directory (defaults to cwd)")
    .action((id: string, opts: DismissCliOptions) => {
      onInvoke({
        kind: "dismiss",
        id,
        reason: opts.reason,
        path: opts.path,
      });
    });

  program
    .command("list-dismissed")
    .description("list entries in the dismissal registry")
    .option("--json", "emit raw JSON instead of a human-readable table")
    .option("--path <path>", "project directory (defaults to cwd)")
    .action((opts: ListDismissedCliOptions) => {
      onInvoke({
        kind: "list-dismissed",
        json: opts.json === true,
        path: opts.path,
      });
    });

  program
    .command("undismiss <id>")
    .description("remove a dismissal entry by id")
    .option("--path <path>", "project directory (defaults to cwd)")
    .action((id: string, opts: UndismissCliOptions) => {
      onInvoke({
        kind: "undismiss",
        id,
        path: opts.path,
      });
    });

  program
    .command("duplication")
    .alias("dup")
    .description(
      "detect Type-3 duplication candidates (run `ts-hotspots duplication --help` for details)",
    )
    .helpOption(false)
    .allowUnknownOption(true)
    .argument("[args...]", "forwarded to the duplication subcommand")
    .action((args: string[]) => {
      onInvoke({ kind: "duplication", argv: args });
    });

  return program;
}

function resolveRootDir(positional: string | undefined): string {
  return positional !== undefined
    ? resolve(positional)
    : resolve(process.cwd());
}

function writeError(
  stdout: WritableLike,
  stderr: WritableLike,
  code: string,
  err: unknown,
  asJson: boolean,
): void {
  const message = err instanceof Error ? err.message : String(err);
  const errorReport: ErrorReport = {
    status: "error",
    error: { code, message },
  };
  stdout.write(
    asJson
      ? renderJson(errorReport)
      : renderMarkdownPreError("complexity", message),
  );
  const humanMessage =
    err instanceof Error ? (err.stack ?? err.message) : String(err);
  stderr.write(`${humanMessage}\n`);
}

class InvalidMetricError extends Error {
  code = "INVALID_METRIC" as const;
}

function parseFunctionAxes(ids: readonly string[]): FunctionAxisId[] {
  const result: FunctionAxisId[] = [];
  const rejected: string[] = [];
  for (const id of ids) {
    if (isFunctionAxisId(id)) result.push(id);
    else rejected.push(id);
  }
  if (rejected.length > 0) {
    throw new InvalidMetricError(`unknown axis id(s): ${rejected.join(", ")}`);
  }
  return result;
}

function toRelPath(rootDir: string, input: string): string {
  const absInput = resolve(rootDir, input);
  return relative(rootDir, absInput);
}

function resolveChurnOptions(opts: ChurnCliOptions): ChurnPrepareOptions {
  return {
    enabled: opts.churn !== false,
    window: opts.churnWindow ?? DEFAULT_CHURN_WINDOW,
    ref: opts.churnRef ?? DEFAULT_CHURN_REF,
  };
}

interface PreparedContext {
  rootDir: string;
  projectInfo: ReportProject;
  functions: ReturnType<typeof aggregate>["functions"];
}

interface ChurnPrepareOptions {
  enabled: boolean;
  window: number;
  ref: string;
}

async function prepare(
  positional: string | undefined,
  exclude: readonly string[],
  churnOptions: ChurnPrepareOptions,
  stderr: WritableLike,
): Promise<PreparedContext> {
  const rootDir = resolveRootDir(positional);
  const sources = await listRepoSources(rootDir, { exclude });
  const { files } = loadProject({ sources });
  const declarations = enumerateDeclarations(files);
  const churn = churnOptions.enabled
    ? collectChurn({
        rootDir,
        files,
        window: churnOptions.window,
        ref: churnOptions.ref,
        onWarning: (msg) => {
          stderr.write(`${msg}\n`);
        },
      })
    : undefined;
  const { functions } = aggregate({
    rootDir,
    declarations,
    files,
    churn,
  });
  const projectInfo: ReportProject = {
    sourceFileCount: files.length,
    functionCount: functions.length,
  };
  return { rootDir, projectInfo, functions };
}

/**
 * Strip `--verbose`-only fields from `projectInfo` so the slim default
 * envelope only carries the one project signal an agent needs to size up
 * the run (`sourceFileCount`). `functionCount` stays available to
 * `--verbose` callers and to the stderr stats line.
 */
function slimProject(projectInfo: ReportProject): ReportProject {
  return { sourceFileCount: projectInfo.sourceFileCount };
}

function validateFunctionCliInputs(
  positional: string | undefined,
  options: FunctionCliOptions,
): { rootDir: string; functionAxes: FunctionAxisId[] | undefined } {
  const rootDir = resolveRootDir(positional);
  if (!existsSync(rootDir)) {
    throw new InvalidArgsError(`path does not exist: ${rootDir}`);
  }
  if (!statSync(rootDir).isDirectory()) {
    throw new InvalidArgsError(`path is not a directory: ${rootDir}`);
  }
  const functionAxes =
    options.metrics !== undefined ? parseFunctionAxes(options.metrics) : undefined;
  if (options.pr !== undefined && options.file !== undefined) {
    throw new InvalidArgsError("--pr and --file are mutually exclusive");
  }
  return { rootDir, functionAxes };
}

interface BuildFunctionReportInput {
  projectInfo: ReportProject;
  hotspots: HotspotCandidate[];
  rankings: Record<FunctionAxisId, RankedFunctionEntry[]>;
  axisMeta: Record<FunctionAxisId, AxisMeta>;
  coOccurrence: FunctionCoOccurrenceEntry[];
  functions: readonly FunctionEntry[];
  verbose: boolean;
}

function buildFunctionReport(input: BuildFunctionReportInput): FunctionReport {
  const {
    projectInfo,
    hotspots,
    rankings,
    axisMeta,
    coOccurrence,
    functions,
    verbose,
  } = input;
  if (!verbose) {
    return {
      tool: { name: "ts-hotspots", version: pkg.version },
      project: slimProject(projectInfo),
      hotspots,
    };
  }
  const usedFunctionKeys = collectFunctionRefKeys(rankings);
  return {
    tool: { name: "ts-hotspots", version: pkg.version },
    project: projectInfo,
    functionRankings: rankings,
    functionAxisMeta: axisMeta,
    hotspots,
    functionCoOccurrence: coOccurrence,
    functions: functions.filter((f) =>
      usedFunctionKeys.has(
        functionRefKey({
          location: f.location,
          name: f.name,
          kind: f.kind,
        }),
      ),
    ),
  };
}

interface OptionalReportFields {
  dismissed: DismissedSummary | undefined;
  prScope: PrScope | undefined;
  prNotice: FunctionReport["notice"];
}

function applyOptionalReportFields(
  report: FunctionReport,
  fields: OptionalReportFields,
): void {
  if (fields.dismissed !== undefined) report.dismissed = fields.dismissed;
  if (fields.prScope !== undefined) report.pr = fields.prScope.info;
  if (fields.prNotice !== undefined) report.notice = fields.prNotice;
}

interface DismissalApplyResult {
  candidates: HotspotCandidate[];
  summary?: DismissedSummary;
}

function applyDismissalRegistry(
  rootDir: string,
  candidates: HotspotCandidate[],
  activeDismissalIds: ReadonlySet<string>,
  stderr: WritableLike,
): DismissalApplyResult {
  const original = loadRegistry(rootDir, {
    onWarning: (msg) => {
      stderr.write(`${msg}\n`);
    },
  });
  if (original.entries.length === 0) {
    return { candidates };
  }
  const { registry: pruned, prunedCount } = pruneRegistry(
    original,
    activeDismissalIds,
  );
  if (prunedCount > 0) {
    saveRegistry(rootDir, withProjectPath(pruned, rootDir));
    const noun = prunedCount === 1 ? "dismissal" : "dismissals";
    stderr.write(
      renderStatsLine(
        "complexity",
        `pruned ${String(prunedCount)} expired ${noun} (function changed since dismiss)`,
      ),
    );
  }
  const activeIds = registryIdSet(pruned);
  let filteredThisRun = 0;
  const kept: HotspotCandidate[] = [];
  for (const c of candidates) {
    if (activeIds.has(c.dismissalId)) {
      filteredThisRun += 1;
    } else {
      kept.push(c);
    }
  }
  const summary: DismissedSummary = {
    active: pruned.entries.length,
    filteredThisRun,
    prunedThisRun: prunedCount,
  };
  return { candidates: kept, summary };
}

function errorCode(err: unknown, fallback: string): string {
  if (err !== null && typeof err === "object" && "code" in err) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === "string") return code;
  }
  return fallback;
}

function writeOk(
  stdout: WritableLike,
  report: FunctionReport,
  streaming: boolean,
): void {
  stdout.write(streaming ? renderMarkdownBody(report) : renderJson(report));
}

function writeStatsLine(
  stderr: WritableLike,
  report: FunctionReport,
  fileMode: { file: string } | undefined,
  functionCount: number,
): void {
  const { project } = report;
  let payload: string;
  if (fileMode !== undefined) {
    const fnCount = report.functions?.length ?? 0;
    payload = `file=${fileMode.file}, functions=${String(fnCount)}`;
  } else {
    payload =
      `files=${String(project.sourceFileCount)}, ` +
      `functions=${String(functionCount)}, ` +
      `candidates=${String(report.hotspots.length)}`;
  }
  if (report.pr !== undefined) {
    payload += `, pr=${String(report.pr.changedFiles)} changed files`;
  }
  if (report.dismissed !== undefined && report.dismissed.active > 0) {
    payload += `, dismissed=${String(report.dismissed.active)}`;
  }
  stderr.write(renderStatsLine("complexity", payload));
}

interface PrScope {
  info: PrInfo;
  isInScope: (location: string) => boolean;
}

class NotAGitRepoError extends Error {
  code = "NOT_A_GIT_REPO" as const;
}

class GitFailedError extends Error {
  code = "GIT_FAILED" as const;
}

/**
 * Resolve the PR scope: list of project-relative file paths whose
 * head-side content differs between `rev.baseRef` and `rev.headRef`,
 * intersected with files that contain functions in this project.
 */
async function resolvePrScope(
  rev: RevRange,
  rootDir: string,
  functions: readonly FunctionEntry[],
): Promise<PrScope> {
  let gitRoot: string;
  try {
    gitRoot = findGitRoot(rootDir);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new NotAGitRepoError(msg);
  }

  let baseSha: string;
  let headSha: string;
  let repoRelChanged: string[];
  try {
    ({ baseSha, headSha } = await resolveDiffEndpoints(
      gitRoot,
      rev.baseRef,
      rev.headRef,
      rev.threeDot,
    ));
    repoRelChanged = await listChangedFilePaths(gitRoot, baseSha, headSha);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new GitFailedError(msg);
  }

  // Project-relative files that contain at least one collected function.
  const projectFiles = new Set<string>();
  for (const f of functions) {
    projectFiles.add(splitFunctionLocation(f.location)[0]);
  }

  const scopeFiles = new Set<string>();
  for (const repoRel of repoRelChanged) {
    const abs = resolve(gitRoot, repoRel);
    const rel = relative(rootDir, abs);
    if (projectFiles.has(rel)) scopeFiles.add(rel);
  }

  return {
    info: {
      baseSha,
      headSha,
      threeDot: rev.threeDot,
      changedFiles: scopeFiles.size,
    },
    isInScope: (location) => scopeFiles.has(splitFunctionLocation(location)[0]),
  };
}

function filterRankingsByScope(
  rankings: Record<FunctionAxisId, RankedFunctionEntry[]>,
  isInScope: (location: string) => boolean,
): Record<FunctionAxisId, RankedFunctionEntry[]> {
  const result = emptyFunctionRankings();
  for (const axis of FUNCTION_AXIS_IDS) {
    result[axis] = rankings[axis].filter((e) => isInScope(e.ref.location));
  }
  return result;
}

function filterCoOccurrenceByScope(
  entries: readonly FunctionCoOccurrenceEntry[],
  isInScope: (location: string) => boolean,
): FunctionCoOccurrenceEntry[] {
  return entries.filter((e) => isInScope(e.ref.location));
}

function filterCandidatesByScope(
  candidates: readonly HotspotCandidate[],
  isInScope: (location: string) => boolean,
): HotspotCandidate[] {
  return candidates.filter((c) => isInScope(c.ref.location));
}

class InvalidArgsError extends Error {
  code = "INVALID_ARGS" as const;
}

async function runFunctions(
  positional: string | undefined,
  options: FunctionCliOptions,
  stdout: WritableLike,
  stderr: WritableLike,
): Promise<number> {
  const format = options.format ?? DEFAULT_FORMAT;
  const streaming = format !== "json";
  const userLimit = options.limit;
  const limit = userLimit ?? DEFAULT_LIMIT;
  const userExclude = options.exclude ?? [];
  const exclude = [...DEFAULT_EXCLUDE_GLOBS, ...userExclude];

  // Warn (not fail) when --limit is supplied alongside a mode that ignores
  // it, so users do not silently assume their cap was honoured.
  if (options.file !== undefined && userLimit !== undefined) {
    stderr.write("ts-hotspots complexity: --limit is ignored in --file mode\n");
  }

  // Pre-stream validation: fast checks that can fail with a clear error before
  // we commit to streaming output. Emitting the preamble early lets `claude`
  // pick up stdin within its 3s detection window, but once emitted we can no
  // longer switch to the old "# ts-hotspots error" preamble on failure.
  let functionAxes: FunctionAxisId[] | undefined;
  try {
    ({ functionAxes } = validateFunctionCliInputs(positional, options));
  } catch (err) {
    writeError(
      stdout,
      stderr,
      errorCode(err, "UNKNOWN_ERROR"),
      err,
      !streaming,
    );
    return 1;
  }

  if (streaming) stdout.write(renderMarkdownHead("complexity"));

  try {
    const { rootDir, projectInfo, functions } = await prepare(
      positional,
      exclude,
      resolveChurnOptions(options),
      stderr,
    );

    if (options.file !== undefined) {
      const rel = toRelPath(rootDir, options.file);
      const prefix = `${rel}:`;
      const targetFunctions = functions.filter((f) =>
        f.location.startsWith(prefix),
      );
      const report: FunctionReport = {
        tool: { name: "ts-hotspots", version: pkg.version },
        project: projectInfo,
        hotspots: [],
        functions: targetFunctions,
      };
      writeOk(stdout, report, streaming);
      writeStatsLine(stderr, report, { file: rel }, functions.length);
      return 0;
    }

    let functionRankings = rankFunctions(functions, {
      topN: INTERNAL_AXIS_TOP_N,
    });

    if (functionAxes !== undefined) {
      functionRankings = filterFunctionRankings(functionRankings, functionAxes);
    }

    const functionAxisMeta = computeFunctionAxisMeta(
      functions,
      functionRankings,
    );
    const functionCoOccurrence = computeFunctionCoOccurrence(functionRankings);
    const rawCandidates = computeFunctionHotspotCandidates(
      functions,
      functionRankings,
      functionAxisMeta,
      functionCoOccurrence,
    );

    const activeDismissalIds = new Set(
      functions.map((f) => bodyHashToCompDismissalId(f.bodyHash)),
    );
    const { candidates: filteredCandidates, summary: dismissed } =
      applyDismissalRegistry(
        rootDir,
        rawCandidates,
        activeDismissalIds,
        stderr,
      );

    // PR scope narrows the displayed surfaces (rankings, co-occurrence,
    // candidates) to functions in changed files. axisMeta keeps the full
    // distribution so spread / tie / non-zero stats stay representative.
    const prScope =
      options.pr !== undefined
        ? await resolvePrScope(options.pr, rootDir, functions)
        : undefined;
    const displayedRankings =
      prScope === undefined
        ? functionRankings
        : filterRankingsByScope(functionRankings, prScope.isInScope);
    const displayedCoOccurrence =
      prScope === undefined
        ? functionCoOccurrence
        : filterCoOccurrenceByScope(functionCoOccurrence, prScope.isInScope);
    const scopedCandidates =
      prScope === undefined
        ? filteredCandidates
        : filterCandidatesByScope(filteredCandidates, prScope.isInScope);
    const hotspots = Number.isFinite(limit)
      ? scopedCandidates.slice(0, limit)
      : scopedCandidates;

    // PR scope can be vacuous: a PR that only edits README, JSON configs,
    // or types in another tsconfig leaves zero project functions to rank.
    // Surface that explicitly so consumers don't read empty hotspots as a
    // clean bill of health.
    const prNotice: FunctionReport["notice"] =
      prScope !== undefined && prScope.info.changedFiles === 0
        ? {
            code: "PR_SCOPE_EMPTY",
            message:
              "Changed files contain no functions tracked by this tsconfig — nothing to rank",
          }
        : undefined;

    const report = buildFunctionReport({
      projectInfo,
      hotspots,
      rankings: displayedRankings,
      axisMeta: functionAxisMeta,
      coOccurrence: displayedCoOccurrence,
      functions,
      verbose: options.verbose === true,
    });
    applyOptionalReportFields(report, { dismissed, prScope, prNotice });
    writeOk(stdout, report, streaming);
    writeStatsLine(stderr, report, undefined, functions.length);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = errorCode(err, "UNKNOWN_ERROR");
    const errorReport: ErrorReport = {
      status: "error",
      error: { code, message },
    };
    if (streaming) {
      stdout.write(renderMarkdownErrorBody(errorReport));
    } else {
      stdout.write(renderJson(errorReport));
    }
    const human =
      err instanceof Error ? (err.stack ?? err.message) : String(err);
    stderr.write(`${human}\n`);
    return 1;
  }
}

export async function run(
  argv: string[],
  stdout: WritableLike,
  stderr: WritableLike,
): Promise<number> {
  let invocation: PendingInvocation | undefined;
  const program = buildCli((inv) => {
    invocation = inv;
  });
  const output = {
    writeOut: (s: string) => {
      stdout.write(s);
    },
    writeErr: (s: string) => {
      stderr.write(s);
    },
  };
  // exitOverride / configureOutput are not inherited by child commands in
  // Commander.js, so we apply them to every subcommand too — otherwise a
  // parse error inside a subcommand calls process.exit() instead of throwing
  // and writes to the real stderr, bypassing our captured sinks.
  program.exitOverride();
  program.configureOutput(output);
  for (const sub of program.commands) {
    sub.exitOverride();
    sub.configureOutput(output);
  }

  try {
    await program.parseAsync(argv);
  } catch (err) {
    const code =
      err !== null && typeof err === "object" && "code" in err
        ? (err as { code?: unknown }).code
        : undefined;
    if (code === "commander.helpDisplayed" || code === "commander.version") {
      return 0;
    }
    if (code === "commander.help") {
      // Auto-help was emitted because no subcommand was given. The help
      // text is already on stderr via configureOutput; the throw carries a
      // sentinel message ("(outputHelp)") that should not surface.
      return 1;
    }
    const message = err instanceof Error ? err.message : String(err);
    stderr.write(`${message}\n`);
    return 1;
  }

  if (invocation === undefined) return 0;

  if (invocation.kind === "complexity") {
    return await runFunctions(
      invocation.positional,
      invocation.options,
      stdout,
      stderr,
    );
  }

  if (invocation.kind === "duplication") {
    return await runDuplicationMain(invocation.argv, {
      stdout,
      stderr,
      cwd: () => process.cwd(),
    });
  }

  try {
    if (
      (invocation.kind === "dismiss" || invocation.kind === "undismiss") &&
      invocation.id.startsWith("dup:")
    ) {
      return runDupDismissalCommand(invocation, stdout, stderr);
    }
    const rootDir = resolveRootDir(invocation.path);
    if (invocation.kind === "dismiss") {
      return await runDismiss(
        {
          id: invocation.id,
          reason: invocation.reason,
          rootDir,
          feature: "comp",
          analyzeRoot: rootDir,
        },
        stdout,
        stderr,
      );
    }
    if (invocation.kind === "list-dismissed") {
      return runListDismissed(
        { rootDir, json: invocation.json },
        stdout,
        stderr,
      );
    }
    return runUndismiss({ id: invocation.id, rootDir }, stdout, stderr);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stderr.write(`${message}\n`);
    return 1;
  }
}

/**
 * Route `dup:<hex>` ids to the git-root registry. `dup` resolves "the
 * project" via `findGitRoot`, so the registry key has to match —
 * otherwise a dup run would never see entries written by `dismiss`.
 */
async function runDupDismissalCommand(
  invocation:
    | { kind: "dismiss"; id: string; reason: string; path: string | undefined }
    | { kind: "undismiss"; id: string; path: string | undefined },
  stdout: WritableLike,
  stderr: WritableLike,
): Promise<number> {
  const start = invocation.path ?? process.cwd();
  const rootDir = findGitRoot(resolve(start));
  if (invocation.kind === "dismiss") {
    return await runDismiss(
      {
        id: invocation.id,
        reason: invocation.reason,
        rootDir,
        feature: "dup",
      },
      stdout,
      stderr,
    );
  }
  return runUndismiss({ id: invocation.id, rootDir }, stdout, stderr);
}
