import { existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { Command, InvalidArgumentError } from "commander";
import pkg from "../package.json" with { type: "json" };
import { aggregate } from "./aggregator/aggregate.ts";
import {
  collectFunctionRefKeys,
  computeFunctionAxisMeta,
  computeFunctionCoOccurrence,
  computeFunctionHotspotCandidates,
  filterFunctionRankings,
  functionRefKey,
  isFunctionAxisId,
  rankFunctions,
} from "./aggregator/rank.ts";
import { runDismiss, runListDismissed, runUndismiss } from "./cli/dismiss.ts";
import { collectChurn } from "./collectors/churn/commit-count.ts";
import { main as runDedupMain } from "./dedup/cli/main.ts";
import { enumerateDeclarations } from "./collectors/enumerate-declarations.ts";
import { enumerateSourceFiles } from "./collectors/enumerate-source-files.ts";
import {
  loadRegistry,
  pruneRegistry,
  registryIdSet,
  saveRegistry,
  withProjectPath,
} from "./dismissal/store.ts";
import { loadProject, TsconfigNotFoundError } from "./loader/load-project.ts";
import {
  renderJson,
  renderMarkdown,
  renderMarkdownBody,
  renderMarkdownErrorBody,
  renderMarkdownHead,
} from "./reporter/render.ts";
import type {
  DismissedSummary,
  ErrorReport,
  FunctionAxisId,
  FunctionReport,
  HotspotCandidate,
  ReportProject,
} from "./schema.ts";

export interface WritableLike {
  write: (chunk: string) => void;
}

export const DEFAULT_EXCLUDE: readonly string[] = [
  "**/*.{test,spec}.{ts,tsx,mts,cts}",
];
export const DEFAULT_TOP = 5;
export const DEFAULT_CHURN_WINDOW = 200;
export const DEFAULT_CHURN_REF = "HEAD";

interface ChurnCliOptions {
  churnWindow?: number;
  churnRef?: string;
  churn?: boolean;
}

interface FunctionCliOptions extends ChurnCliOptions {
  exclude?: string[];
  top?: number;
  metrics?: string[];
  file?: string;
  full?: boolean;
  json?: boolean;
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

function parseTop(value: string): number {
  return parsePositiveInt("--top", value);
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
      "exclude files matching glob(s); repeat or space-separate (defaults to test files)",
      [...DEFAULT_EXCLUDE],
    )
    .option("-t, --top <N>", "top entries per axis", parseTop, DEFAULT_TOP)
    .option(
      "-m, --metrics <list>",
      "comma-separated axis ids to include",
      parseMetrics,
    )
    .option("--file <path>", "drill down into a single file (raw metrics only)")
    .option(
      "--full",
      "emit the full report (all axes, coOccurrence, functions[])",
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
    .option("--json", "emit raw JSON instead of the default Markdown prompt")
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
    .option(
      "--path <path>",
      "project directory or tsconfig.json (defaults to cwd)",
    )
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
    .option(
      "--path <path>",
      "project directory or tsconfig.json (defaults to cwd)",
    )
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
    .option(
      "--path <path>",
      "project directory or tsconfig.json (defaults to cwd)",
    )
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

function resolveTsconfigPath(positional: string | undefined): string {
  if (positional !== undefined) {
    const p = resolve(positional);
    if (existsSync(p) && statSync(p).isDirectory()) {
      return join(p, "tsconfig.json");
    }
    return p;
  }
  return resolve(process.cwd(), "tsconfig.json");
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
  stdout.write(asJson ? renderJson(errorReport) : renderMarkdown(errorReport));
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
  tsconfigPath: string;
  rootDir: string;
  projectInfo: ReportProject;
  functions: ReturnType<typeof aggregate>["functions"];
}

interface ChurnPrepareOptions {
  enabled: boolean;
  window: number;
  ref: string;
}

function prepare(
  positional: string | undefined,
  exclude: readonly string[],
  churnOptions: ChurnPrepareOptions,
  stderr: WritableLike,
): PreparedContext {
  const tsconfigPath = resolveTsconfigPath(positional);
  const { project } = loadProject({ tsconfigPath });
  const rootDir = dirname(tsconfigPath);
  const files = enumerateSourceFiles(project, rootDir, {
    exclude: [...exclude],
  });
  const declarations = enumerateDeclarations(project, rootDir, { files });
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
    project,
    rootDir,
    declarations,
    files,
    churn,
  });
  const projectInfo: ReportProject = {
    tsconfigPath,
    sourceFileCount: files.length,
    functionCount: functions.length,
  };
  return { tsconfigPath, rootDir, projectInfo, functions };
}

interface DismissalApplyResult {
  candidates: HotspotCandidate[];
  summary?: DismissedSummary;
}

function applyDismissalRegistry(
  rootDir: string,
  candidates: HotspotCandidate[],
  bodyHashes: ReadonlySet<string>,
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
  const { registry: pruned, prunedCount } = pruneRegistry(original, bodyHashes);
  if (prunedCount > 0) {
    saveRegistry(rootDir, withProjectPath(pruned, rootDir));
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
  report: FunctionReport & { status: "ok" },
  streaming: boolean,
): void {
  stdout.write(streaming ? renderMarkdownBody(report) : renderJson(report));
}

function runFunctions(
  positional: string | undefined,
  options: FunctionCliOptions,
  stdout: WritableLike,
  stderr: WritableLike,
): number {
  const streaming = options.json !== true;
  const exclude = options.exclude ?? [...DEFAULT_EXCLUDE];

  // Pre-stream validation: fast checks that can fail with a clear error before
  // we commit to streaming output. Emitting the preamble early lets `claude`
  // pick up stdin within its 3s detection window, but once emitted we can no
  // longer switch to the old "# ts-hotspots error" preamble on failure.
  let functionAxes: FunctionAxisId[] | undefined;
  try {
    const tsconfigPath = resolveTsconfigPath(positional);
    if (!existsSync(tsconfigPath)) {
      throw new TsconfigNotFoundError(tsconfigPath);
    }
    if (options.metrics !== undefined) {
      functionAxes = parseFunctionAxes(options.metrics);
    }
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

  if (streaming) stdout.write(renderMarkdownHead());

  try {
    const { rootDir, projectInfo, functions } = prepare(
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
        status: "ok",
        tool: { name: "ts-hotspots", version: pkg.version },
        project: projectInfo,
        functionHotspotCandidates: [],
        functions: targetFunctions,
      };
      writeOk(stdout, report, streaming);
      return 0;
    }

    const topN = options.top ?? DEFAULT_TOP;
    let functionRankings = rankFunctions(functions, { topN });

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

    const bodyHashes = new Set(functions.map((f) => f.bodyHash));
    const { candidates: functionHotspotCandidates, summary: dismissed } =
      applyDismissalRegistry(rootDir, rawCandidates, bodyHashes, stderr);

    if (options.full === true) {
      const usedFunctionKeys = collectFunctionRefKeys(functionRankings);
      const report: FunctionReport = {
        status: "ok",
        tool: { name: "ts-hotspots", version: pkg.version },
        project: projectInfo,
        functionRankings,
        functionAxisMeta,
        functionHotspotCandidates,
        functionCoOccurrence,
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
      if (dismissed !== undefined) report.dismissed = dismissed;
      writeOk(stdout, report, streaming);
      return 0;
    }

    const report: FunctionReport = {
      status: "ok",
      tool: { name: "ts-hotspots", version: pkg.version },
      project: projectInfo,
      functionHotspotCandidates,
    };
    if (dismissed !== undefined) report.dismissed = dismissed;
    writeOk(stdout, report, streaming);
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
    return runFunctions(
      invocation.positional,
      invocation.options,
      stdout,
      stderr,
    );
  }

  if (invocation.kind === "duplication") {
    return await runDedupMain(invocation.argv, {
      stdout,
      stderr,
      cwd: () => process.cwd(),
    });
  }

  try {
    const tsconfigPath = resolveTsconfigPath(invocation.path);
    if (invocation.kind === "dismiss") {
      return runDismiss(
        {
          id: invocation.id,
          reason: invocation.reason,
          tsconfigPath,
        },
        stdout,
        stderr,
      );
    }
    if (invocation.kind === "list-dismissed") {
      return runListDismissed(
        { tsconfigPath, json: invocation.json },
        stdout,
        stderr,
      );
    }
    return runUndismiss({ id: invocation.id, tsconfigPath }, stdout, stderr);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    stderr.write(`${message}\n`);
    return 1;
  }
}
