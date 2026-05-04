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
  functionRefKey,
  rankFunctions,
} from "./aggregator/rank.ts";
import type { ArchParsedArgs } from "./architecture/cli/args.ts";
import {
  runPipeline as runArchitecturePipeline,
  writeArchitectureParseError,
} from "./architecture/cli/main.ts";
import { addArchitectureCommand } from "./architecture/cli/registerCommand.ts";
import { runDismiss, runListDismissed, runUndismiss } from "./cli/dismiss.ts";
import {
  DEFAULT_CHURN_WINDOW,
  DEFAULT_FORMAT,
  DEFAULT_LIMIT,
  DEFAULT_REF,
  type ReportFormat,
  TOOL_NAME,
} from "./cli-defaults.ts";
import type { CochangeParsedArgs } from "./cochange/cli/args.ts";
import {
  runPipeline as runCochangePipeline,
  writeCochangeParseError,
} from "./cochange/cli/main.ts";
import { addCochangeCommand } from "./cochange/cli/registerCommand.ts";
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
import type { ParsedArgs as DuplicationParsedArgs } from "./duplication/cli/args.ts";
import {
  runPipeline as runDuplicationPipeline,
  writeDuplicationParseError,
} from "./duplication/cli/main.ts";
import {
  addDuplicationCommand,
  normalizePhaseTimingsArgv,
} from "./duplication/cli/registerCommand.ts";
import { listRepoSources } from "./loader/listRepoSources.ts";
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
  DiffInfo,
  DismissedSummary,
  ErrorReport,
  FunctionAxisId,
  FunctionCoOccurrenceEntry,
  FunctionEntry,
  FunctionReport,
  HotspotCandidate,
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

interface WritableLike {
  write: (chunk: string) => void;
}

// Per-axis ranking depth used internally to seed hotspot candidate
// computation. Not user-facing — bumping this widens the candidate pool
// before `--limit` truncation.
const INTERNAL_AXIS_TOP_N = 10;

interface ChurnCliOptions {
  churnWindow?: number;
  churnRef?: string;
  churn?: boolean;
}

interface FunctionCliOptions extends ChurnCliOptions {
  exclude?: string[];
  limit?: number;
  file?: string;
  verbose?: boolean;
  format?: ReportFormat;
  diff?: RevRange;
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

function parseLimit(value: string): number {
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === "all") return Number.POSITIVE_INFINITY;
  if (!/^\d+$/.test(trimmed)) {
    throw new InvalidArgumentError(
      `invalid --limit '${value}' (expected a positive integer or 'all')`,
    );
  }
  const n = Number.parseInt(trimmed, 10);
  if (n <= 0) {
    throw new InvalidArgumentError(
      `invalid --limit '${value}' (expected a positive integer or 'all')`,
    );
  }
  return n;
}

function parseFormat(value: string): ReportFormat {
  if (value === "markdown" || value === "json") return value;
  throw new InvalidArgumentError(
    `invalid --format '${value}' (expected 'markdown' or 'json')`,
  );
}

function parseDiff(value: string): RevRange {
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
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new InvalidArgumentError(
      `invalid --churn-window '${value}' (expected a positive integer)`,
    );
  }
  const n = Number.parseInt(trimmed, 10);
  if (n <= 0) {
    throw new InvalidArgumentError(
      `invalid --churn-window '${value}' (expected a positive integer)`,
    );
  }
  return n;
}

function collectExcludeGlob(
  value: string,
  previous: readonly string[],
): string[] {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new InvalidArgumentError("--exclude requires a non-empty glob");
  }
  return [...previous, trimmed];
}

/**
 * Detect whether a parseAsync failure happened while processing the dup
 * subcommand. We scan the post-binary argv for the first non-flag token
 * — if it is `duplication` or `dup`, the failing context was dup, and
 * the catch block routes the error through dup's format-aware envelope.
 */
function isDuplicationContext(argv: readonly string[]): boolean {
  return findDuplicationCommandIndex(argv) !== -1;
}

function findDuplicationCommandIndex(argv: readonly string[]): number {
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === undefined) continue;
    if (tok.startsWith("-")) continue;
    if (tok === "duplication" || tok === "dup") return i;
    return -1;
  }
  return -1;
}

function isArchitectureContext(argv: readonly string[]): boolean {
  return findArchitectureCommandIndex(argv) !== -1;
}

function findArchitectureCommandIndex(argv: readonly string[]): number {
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === undefined) continue;
    if (tok.startsWith("-")) continue;
    if (tok === "architecture" || tok === "arch") return i;
    return -1;
  }
  return -1;
}

function isCochangeContext(argv: readonly string[]): boolean {
  return findCochangeCommandIndex(argv) !== -1;
}

function findCochangeCommandIndex(argv: readonly string[]): number {
  for (let i = 2; i < argv.length; i++) {
    const tok = argv[i];
    if (tok === undefined) continue;
    if (tok.startsWith("-")) continue;
    if (tok === "cochange" || tok === "coch") return i;
    return -1;
  }
  return -1;
}

/**
 * Rewrite the trailing portion of argv so commander's optional-value
 * `[level]` for `--phase-timings` does not greedily consume a following
 * positional. Only `dup` registers `--phase-timings [level]`; other
 * subcommands' argv is left untouched.
 */
function preprocessArgv(argv: readonly string[]): string[] {
  const dupIdx = findDuplicationCommandIndex(argv);
  if (dupIdx !== -1) {
    const head = argv.slice(0, dupIdx + 1);
    const tail = normalizePhaseTimingsArgv(argv.slice(dupIdx + 1));
    return [...head, ...tail];
  }
  return [...argv];
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
      parsedArgs: DuplicationParsedArgs;
    }
  | {
      kind: "architecture";
      parsedArgs: ArchParsedArgs;
    }
  | {
      kind: "cochange";
      parsedArgs: CochangeParsedArgs;
    };

const ROOT_LONG_DESCRIPTION = `ts-hotspots is a static analyzer that hands a coding agent a "where should
I read first?" map of a TypeScript codebase. It points at coordinates
(file:line) and reports metric facts; it does not propose refactors.

Pick a subcommand by the question you have:

  complexity   "Which functions are the riskiest to touch?"
               Per-function ranking by cyclomatic / cognitive complexity,
               length, parameter count, max nesting, branch density, and
               git churn.

  duplication  "Where is the same logic copy-pasted?"
               Type-3 (near-miss) duplication groups with similarity and
               shared evidence. Whole repo by default; --diff narrows to
               PR scope (head-side fragments vs the rest of the codebase).

  architecture "Which modules carry too much structural weight?"
               Exported-component ranking on six structural smells —
               hub / high-fanout / high-impact / bridge / unstable /
               over-shared — from fan-in / fan-out / reverse closure /
               PageRank / betweenness / instability.

  cochange     "Which file pairs change together in git history?"
               Logical coupling between TypeScript files: file pairs
               that are touched in the same commits more often than
               chance, even when no static import edge connects them.

All four write a ${DEFAULT_FORMAT} report to stdout by default; pass --format json
for machine-readable output. Each candidate carries a 'dismissalId' you
can hand to 'ts-hotspots dismiss' to filter known false positives from
future runs (auto-expires when the underlying code changes).

All four require [path] (default: cwd) to be inside a git repository.`;

const ROOT_HELP_AFTER = `
Examples:
  ts-hotspots complexity                       # rank functions in cwd
  ts-hotspots dup --diff origin/main...        # duplication in PR scope
  ts-hotspots arch --format json > arch.json   # JSON architecture report
  ts-hotspots cochange                         # rank file pairs by change-coupling
  ts-hotspots coch --file src/foo.ts           # cochange partners of one file
  ts-hotspots dismiss comp:abc123 --reason "intentional dispatch table"

Run 'ts-hotspots <command> --help' for the full flag surface, examples,
and per-command notes (output schema, --diff semantics, dismissal id
prefixes).
`;

const COMPLEXITY_LONG_DESCRIPTION = `Per-function ranking of the working tree at [path] (default: cwd).
Each function — including methods, arrow functions, and TSX components —
is scored on six axes: cyclomatic complexity, cognitive complexity,
length, parameter count, max nesting depth, branch density, plus git
churn (commits touching the file in the last --churn-window commits).

The hotspot list is the union of the per-axis top-N, ordered by how many
axes flagged each function. File-level rankings are returned alongside.
Output is written to stdout; redirect it to a file if you want to keep it.

[path] points at a directory inside a git repository. The repo root is
discovered by walking up from [path] until a .git entry is found.`;

const COMPLEXITY_HELP_AFTER = `
Examples:
  ts-hotspots complexity > report.md
  ts-hotspots complexity --format json > report.json
  ts-hotspots comp --diff origin/main...        # narrow display to PR files
  ts-hotspots comp --file src/big-module.ts     # raw metrics for one file
  ts-hotspots comp --no-churn                   # skip git churn collection
  ts-hotspots comp --verbose                    # full schema (all axes, coOccurrence, functions[])

<revrange> forms accepted by --diff:
  A...B   diff from merge-base(A, B) to B (PR semantics; recommended)
  A..B    diff base against head directly
  A...    head side defaults to HEAD
  ...B    base side defaults to HEAD

Note: 'comp --diff' is a display filter — rankings are still computed
against the full head ref so the distribution stays intact. ('dup --diff'
instead defines the comparison's base/head sides.)

Each reported candidate carries a 'dismissalId' (comp:<hex>) you can pass
to 'ts-hotspots dismiss <id> --reason <text>' to filter it from future
runs. The id auto-expires when the function body changes.
`;

const DISMISS_HELP_AFTER = `
Typical flow:
  1. Run an analysis:                ts-hotspots comp
  2. Pick a candidate's dismissalId from the report (comp:<hex>, dup:<hex>,
     arch:<hex>, or coch:<hex>) and dismiss it:  ts-hotspots dismiss comp:abc123 --reason "intentional dispatch table"
  3. Future runs filter that id and report a 'dismissed' summary.

Dismissals auto-expire when the underlying code changes (function body
rewritten, duplication group membership shifts), so they don't shadow real
regressions. To list active entries use 'ts-hotspots list-dismissed';
to remove one explicitly use 'ts-hotspots undismiss <id>'.
`;

function buildCli(onInvoke: (inv: PendingInvocation) => void): Command {
  const program = new Command();
  program.enablePositionalOptions();
  program
    .name("ts-hotspots")
    .description("TypeScript metrics reporter")
    .version(pkg.version)
    .helpCommand(false)
    .addHelpText("before", `\n${ROOT_LONG_DESCRIPTION}\n`)
    .addHelpText("after", ROOT_HELP_AFTER);

  program
    .command("complexity [path]")
    .alias("comp")
    .description(
      "rank functions and files by complexity / size / churn (per-function hotspot candidates)",
    )
    .helpGroup("Analysis commands:")
    .addHelpText("before", `\n${COMPLEXITY_LONG_DESCRIPTION}\n`)
    .addHelpText("after", COMPLEXITY_HELP_AFTER)
    .option(
      "-e, --exclude <glob>",
      "extra path glob to exclude (repeatable). Added on top of the built-in defaults (node_modules, dist, generated files, test files, ...)",
      collectExcludeGlob,
      [] as string[],
    )
    .option(
      "--limit <N|all>",
      `max entries in hotspots[] (default: ${String(DEFAULT_LIMIT)}). Pass 'all' to keep every candidate.`,
      parseLimit,
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
      DEFAULT_REF,
    )
    .option("--no-churn", "disable git churn collection")
    .option(
      "--format <markdown|json>",
      `report format (default: ${DEFAULT_FORMAT})`,
      parseFormat,
    )
    .option(
      "--diff <revrange>",
      "scope hotspot output to functions in files changed by <revrange> (e.g. origin/main...). Display filter only — rankings are still computed against the full head ref so the distribution is intact. (Note: `dup --diff` instead defines the comparison's base/head sides.)",
      parseDiff,
    )
    .action((pathArg: string | undefined, opts: FunctionCliOptions) => {
      onInvoke({ kind: "complexity", positional: pathArg, options: opts });
    });

  addDuplicationCommand(program, (parsedArgs) => {
    onInvoke({ kind: "duplication", parsedArgs });
  });

  addArchitectureCommand(program, (parsedArgs) => {
    onInvoke({ kind: "architecture", parsedArgs });
  });

  addCochangeCommand(program, (parsedArgs) => {
    onInvoke({ kind: "cochange", parsedArgs });
  });

  program
    .command("dismiss <id>")
    .description(
      "record a dismissal so this candidate is filtered from future runs",
    )
    .helpGroup("Dismissal management:")
    .addHelpText("after", DISMISS_HELP_AFTER)
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
    .helpGroup("Dismissal management:")
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
    .helpGroup("Dismissal management:")
    .option("--path <path>", "project directory (defaults to cwd)")
    .action((id: string, opts: UndismissCliOptions) => {
      onInvoke({
        kind: "undismiss",
        id,
        path: opts.path,
      });
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

function toRelPath(rootDir: string, input: string): string {
  const absInput = resolve(rootDir, input);
  return relative(rootDir, absInput);
}

function resolveChurnOptions(opts: ChurnCliOptions): ChurnPrepareOptions {
  return {
    enabled: opts.churn !== false,
    window: opts.churnWindow ?? DEFAULT_CHURN_WINDOW,
    ref: opts.churnRef ?? DEFAULT_REF,
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
): { rootDir: string } {
  const rootDir = resolveRootDir(positional);
  if (!existsSync(rootDir)) {
    throw new InvalidArgsError(`path does not exist: ${rootDir}`);
  }
  if (!statSync(rootDir).isDirectory()) {
    throw new InvalidArgsError(`path is not a directory: ${rootDir}`);
  }
  if (options.diff !== undefined && options.file !== undefined) {
    throw new InvalidArgsError("--diff and --file are mutually exclusive");
  }
  return { rootDir };
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
      tool: { name: TOOL_NAME, version: pkg.version },
      project: slimProject(projectInfo),
      hotspots,
    };
  }
  const usedFunctionKeys = collectFunctionRefKeys(rankings);
  return {
    tool: { name: TOOL_NAME, version: pkg.version },
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
  diffScope: DiffScope | undefined;
  diffNotice: FunctionReport["notice"];
}

function applyOptionalReportFields(
  report: FunctionReport,
  fields: OptionalReportFields,
): void {
  if (fields.dismissed !== undefined) report.dismissed = fields.dismissed;
  if (fields.diffScope !== undefined) report.diff = fields.diffScope.info;
  if (fields.diffNotice !== undefined) report.notice = fields.diffNotice;
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
  if (report.diff !== undefined) {
    payload += `, diff=${String(report.diff.changedFiles)} changed files`;
  }
  if (report.dismissed !== undefined && report.dismissed.active > 0) {
    payload += `, dismissed=${String(report.dismissed.active)}`;
  }
  stderr.write(renderStatsLine("complexity", payload));
}

interface DiffScope {
  info: DiffInfo;
  isInScope: (location: string) => boolean;
}

class NotAGitRepoError extends Error {
  code = "NOT_A_GIT_REPO" as const;
}

class GitFailedError extends Error {
  code = "GIT_FAILED" as const;
}

/**
 * Resolve the diff scope: list of project-relative file paths whose
 * head-side content differs between `rev.baseRef` and `rev.headRef`,
 * intersected with files that contain functions in this project.
 */
async function resolveDiffScope(
  rev: RevRange,
  rootDir: string,
  functions: readonly FunctionEntry[],
): Promise<DiffScope> {
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
  // longer switch to the old "# ts-hotspots complexity error" preamble on failure.
  try {
    validateFunctionCliInputs(positional, options);
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
        tool: { name: TOOL_NAME, version: pkg.version },
        project: projectInfo,
        hotspots: [],
        functions: targetFunctions,
      };
      writeOk(stdout, report, streaming);
      writeStatsLine(stderr, report, { file: rel }, functions.length);
      return 0;
    }

    const functionRankings = rankFunctions(functions, {
      topN: INTERNAL_AXIS_TOP_N,
    });

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

    // Diff scope narrows the displayed surfaces (rankings, co-occurrence,
    // candidates) to functions in changed files. axisMeta keeps the full
    // distribution so spread / tie / non-zero stats stay representative.
    const diffScope =
      options.diff !== undefined
        ? await resolveDiffScope(options.diff, rootDir, functions)
        : undefined;
    const displayedRankings =
      diffScope === undefined
        ? functionRankings
        : filterRankingsByScope(functionRankings, diffScope.isInScope);
    const displayedCoOccurrence =
      diffScope === undefined
        ? functionCoOccurrence
        : filterCoOccurrenceByScope(functionCoOccurrence, diffScope.isInScope);
    const scopedCandidates =
      diffScope === undefined
        ? filteredCandidates
        : filterCandidatesByScope(filteredCandidates, diffScope.isInScope);
    const hotspots = Number.isFinite(limit)
      ? scopedCandidates.slice(0, limit)
      : scopedCandidates;

    // Diff scope can be vacuous: a diff that only edits README, JSON configs,
    // or types in another tsconfig leaves zero project functions to rank.
    // Surface that explicitly so consumers don't read empty hotspots as a
    // clean bill of health.
    const diffNotice: FunctionReport["notice"] =
      diffScope !== undefined && diffScope.info.changedFiles === 0
        ? {
            code: "DIFF_SCOPE_EMPTY",
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
    applyOptionalReportFields(report, { dismissed, diffScope, diffNotice });
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
    await program.parseAsync(preprocessArgv(argv));
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
    if (isDuplicationContext(argv)) {
      // dup arg-parse failures (mutual-exclusivity throws from the action,
      // commander's own unknown-flag / invalid-argument errors) need the
      // dup-flavoured error envelope (markdown pre-error block or JSON to
      // stdout, prefixed line to stderr) so the agent surface stays
      // identical whether dup ran via the root CLI or via main(argv, io).
      writeDuplicationParseError(
        { stdout, stderr, cwd: () => process.cwd() },
        argv,
        err,
      );
      return 1;
    }
    if (isArchitectureContext(argv)) {
      writeArchitectureParseError(
        { stdout, stderr, cwd: () => process.cwd() },
        argv,
        err,
      );
      return 1;
    }
    if (isCochangeContext(argv)) {
      writeCochangeParseError(
        { stdout, stderr, cwd: () => process.cwd() },
        argv,
        err,
      );
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
    return await runDuplicationPipeline(invocation.parsedArgs, {
      stdout,
      stderr,
      cwd: () => process.cwd(),
    });
  }

  if (invocation.kind === "architecture") {
    return await runArchitecturePipeline(invocation.parsedArgs, {
      stdout,
      stderr,
      cwd: () => process.cwd(),
    });
  }

  if (invocation.kind === "cochange") {
    return await runCochangePipeline(invocation.parsedArgs, {
      stdout,
      stderr,
      cwd: () => process.cwd(),
    });
  }

  try {
    if (invocation.kind === "dismiss" || invocation.kind === "undismiss") {
      if (invocation.id.startsWith("dup:")) {
        return await runFeatureDismissalCommand(
          "dup",
          invocation,
          stdout,
          stderr,
        );
      }
      if (invocation.id.startsWith("arch:")) {
        return await runFeatureDismissalCommand(
          "arch",
          invocation,
          stdout,
          stderr,
        );
      }
      if (invocation.id.startsWith("coch:")) {
        return await runFeatureDismissalCommand(
          "coch",
          invocation,
          stdout,
          stderr,
        );
      }
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
 * Route `dup:<hex>`, `arch:<hex>`, and `coch:<hex>` ids to the git-root
 * registry. All three features resolve "the project" via `findGitRoot`,
 * so the registry key has to match — otherwise a feature run would never
 * see entries written by `dismiss`.
 */
async function runFeatureDismissalCommand(
  feature: "arch" | "coch" | "dup",
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
        feature,
      },
      stdout,
      stderr,
    );
  }
  return runUndismiss({ id: invocation.id, rootDir }, stdout, stderr);
}
