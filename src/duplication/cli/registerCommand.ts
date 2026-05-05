import { type Command, InvalidArgumentError } from "commander";
import {
  collectExcludeGlob,
  parseDiff,
  parseFormat,
  parseLimit,
  parsePositiveInteger,
} from "../../cli/optionParsers.ts";
import {
  DEFAULT_CHURN_WINDOW,
  DEFAULT_FORMAT,
  DEFAULT_LIMIT,
  DEFAULT_REF,
  PHASE_TIMINGS_DEFAULT,
  PHASE_TIMINGS_LEVELS,
  type PhaseTimingsLevel,
  type ReportFormat,
} from "../../cli-defaults.ts";
import type { RevRange } from "../../util/git/parseRevRange.ts";
import { ArgParseError, type ParsedArgs } from "./args.ts";

/**
 * Render the `LEVEL is 'a' (default) or 'b' or 'c'.` enumeration for
 * `--phase-timings`'s help text from the runtime level list. Keeping
 * this derived means adding a level updates the docs automatically.
 */
function renderPhaseTimingsLevels(): string {
  return PHASE_TIMINGS_LEVELS.map((l) =>
    l === PHASE_TIMINGS_DEFAULT ? `'${l}' (default)` : `'${l}'`,
  ).join(" or ");
}

const SHORT_DESCRIPTION =
  "detect Type-3 duplication candidates (whole repo by default; --diff for PR scope)";

const LONG_DESCRIPTION = `By default the entire repository is scanned at ${DEFAULT_REF}. Pass --diff <revrange>
to compare the head side of a diff against the rest of the codebase on the
base side. The report is written to stdout; redirect it to a file if you
want to keep it.

[path] points at a directory inside a git repository. The repo root is
discovered by walking up from [path] until a .git entry is found
(default: cwd).`;

const HELP_AFTER = `
Examples:
  ts-hotspots duplication > report.md
  ts-hotspots duplication --format json > report.json
  ts-hotspots duplication --diff origin/main... > report.md
  ts-hotspots duplication --diff origin/main...HEAD --format json > report.json
  ts-hotspots duplication --diff main..feature ./my-repo
  ts-hotspots duplication --diff origin/main... --exclude 'src/legacy/**' --exclude '**/*.gen.ts'
  ts-hotspots duplication --ref release/v2 --exclude 'src/legacy/**'
  ts-hotspots duplication --phase-timings 2> perf.log
  ts-hotspots duplication --phase-timings=verbose 2> perf.log

<revrange> forms accepted by --diff:
  A...B   diff from merge-base(A, B) to B (PR semantics; recommended)
  A..B    diff base against head directly
  A...    head side defaults to HEAD
  ...B    base side defaults to HEAD

Each reported group carries a 'dismissalId' (dup:<hex>) you can pass to
'ts-hotspots dismiss <id> --reason <text>' to filter it from future runs.
The id auto-expires when the group's membership changes.
`;

interface DuplicationCliOptions {
  exclude: string[];
  diff?: RevRange;
  ref?: string;
  format?: ReportFormat;
  /**
   * `true` for the bare `--phase-timings` flag (commander's default
   * for an option with an optional argument when no value is given);
   * a level string when explicitly set; `undefined` when absent.
   * The argv preprocessor in `normalizePhaseTimingsArgv` rewrites
   * every shape into `--phase-timings=<level>` so the bare-flag `true`
   * branch is unreachable in practice, but kept defensively.
   */
  phaseTimings?: PhaseTimingsLevel | true;
  limit?: number;
  verbose?: boolean;
  churnWindow: number;
  churnRef?: string;
  churn: boolean;
}

/**
 * Add the `duplication` / `dup` subcommand to `parent`. Used both by the
 * root CLI in `src/cli.ts` (so `ts-hotspots --help` lists dup with its
 * full option surface) and by the `main(argv, io)` entry point in
 * `./main.ts`. Keeping a single registrar means both call sites share
 * one option configuration and one help layout.
 *
 * The action handler validates inputs (`--ref` / `--diff` exclusivity)
 * and builds a `ParsedArgs`, then invokes `onParsed`. Running the
 * detector pipeline is the caller's responsibility — propagating an
 * exit code through commander's `parseAsync` is awkward, so we keep
 * orchestration outside.
 */
export function addDuplicationCommand(
  parent: Command,
  onParsed: (args: ParsedArgs) => void,
): Command {
  return parent
    .command("duplication [path]")
    .alias("dup")
    .description(SHORT_DESCRIPTION)
    .helpGroup("Analysis commands:")
    .addHelpText("before", `\n${LONG_DESCRIPTION}\n`)
    .addHelpText("after", HELP_AFTER)
    .option(
      "-e, --exclude <glob>",
      "extra path glob to exclude (repeatable). Added on top of the built-in defaults (node_modules, dist, generated files, test files, ...)",
      collectExcludeGlob,
      [] as string[],
    )
    .option(
      "--diff <revrange>",
      "scope to a git revision range. Mutually exclusive with --ref. Defines the comparison's base/head sides (changed fragments on the head side are compared against the rest of the codebase on the base side). Note: `comp --diff` instead acts as a display filter on top of full-repo ranking.",
      parseDiff,
    )
    .option(
      "--ref <ref>",
      `commit/branch/tag to scan in whole-repo mode (default: ${DEFAULT_REF}). Mutually exclusive with --diff.`,
    )
    .option(
      "--format <markdown|json>",
      `report format (default: ${DEFAULT_FORMAT})`,
      parseFormat,
    )
    .option(
      "--phase-timings [level]",
      `emit a JSON Lines perf-debug log to stderr. LEVEL is ${renderPhaseTimingsLevels()}. Pipe with '2> perf.log' to capture.`,
      parsePhaseTimingsOption,
    )
    .option(
      "--limit <N|all>",
      `max entries in hotspots[] (default: ${String(DEFAULT_LIMIT)}). Pass 'all' to keep every group.`,
      parseLimit,
    )
    .option(
      "--verbose",
      "emit the rich schema: per-member scores, fragment source, full evidence, recommendation hint, aggregate score axes, and the analysis summary",
    )
    .option(
      "--churn-window <N>",
      "number of commits walked by 'git log' to compute per-file churn",
      parsePositiveInteger("--churn-window"),
      DEFAULT_CHURN_WINDOW,
    )
    .option(
      "--churn-ref <ref>",
      "ref to walk for churn (default: diff head ref in diff mode, --ref in whole-repo mode)",
      validateChurnRef,
    )
    .option(
      "--no-churn",
      "disable churn collection. Groups are sorted by raw similarity and 'aggregateChurn' is omitted from the report.",
    )
    .action((pathArg: string | undefined, opts: DuplicationCliOptions) => {
      onParsed(buildParsedArgs(pathArg, opts));
    });
}

function buildParsedArgs(
  pathArg: string | undefined,
  opts: DuplicationCliOptions,
): ParsedArgs {
  if (opts.diff !== undefined && opts.ref !== undefined) {
    throw new ArgParseError("--ref and --diff are mutually exclusive");
  }
  const phaseTimings = resolvePhaseTimings(opts.phaseTimings);
  const format: ReportFormat = opts.format ?? DEFAULT_FORMAT;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const churn = {
    enabled: opts.churn,
    window: opts.churnWindow,
    ref: opts.churnRef,
  };

  if (opts.diff !== undefined) {
    return {
      kind: "run",
      mode: "diff",
      baseRef: opts.diff.baseRef,
      headRef: opts.diff.headRef,
      threeDot: opts.diff.threeDot,
      path: pathArg,
      format,
      excludeGlobs: opts.exclude,
      phaseTimings,
      limit,
      verbose: opts.verbose === true,
      churn,
    };
  }

  return {
    kind: "run",
    mode: "whole-repo",
    ref: opts.ref ?? DEFAULT_REF,
    path: pathArg,
    format,
    excludeGlobs: opts.exclude,
    phaseTimings,
    limit,
    verbose: opts.verbose === true,
    churn,
  };
}

function resolvePhaseTimings(
  raw: PhaseTimingsLevel | true | undefined,
): PhaseTimingsLevel | undefined {
  if (raw === undefined) return undefined;
  if (raw === true) return PHASE_TIMINGS_DEFAULT;
  return raw;
}

/**
 * Custom processor for `--phase-timings [level]`. Commander only calls
 * this when an explicit level is supplied (via `=verbose` or as the
 * next argv token); the bare-flag case never reaches us — commander
 * stores the literal `true` directly. Validate explicit levels here;
 * `resolvePhaseTimings` translates the bare `true` post-parse.
 */
function parsePhaseTimingsOption(value: string): PhaseTimingsLevel {
  if (value === "summary" || value === "verbose") return value;
  throw new InvalidArgumentError(
    `invalid --phase-timings level '${value}' (expected 'summary' or 'verbose')`,
  );
}

function validateChurnRef(value: string): string {
  if (value.trim().length === 0) {
    throw new InvalidArgumentError("--churn-ref requires a non-empty value");
  }
  return value;
}

/**
 * Pre-process argv so commander's optional-value handling for
 * `--phase-timings [level]` does not greedily consume a following
 * positional token (e.g. a `[path]`). Commander's default behaviour:
 * if the next argv token does not start with `-`, it is taken as the
 * option value. We always rewrite the flag into the explicit
 * `--phase-timings=<level>` form so commander never sees an optional
 * value at parse time:
 *
 *   --phase-timings              → --phase-timings=summary
 *   --phase-timings summary      → --phase-timings=summary
 *   --phase-timings verbose      → --phase-timings=verbose
 *   --phase-timings /tmp/repo    → --phase-timings=summary  + /tmp/repo
 *   --phase-timings=verbose      → unchanged
 *
 * This preserves the legacy parseArgs UX where the bare flag means
 * "summary" and any non-level following token stays a positional.
 */
export function normalizePhaseTimingsArgv(argv: readonly string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === undefined) continue;
    if (a === "--phase-timings") {
      const next = argv[i + 1];
      if (next === "summary" || next === "verbose") {
        out.push(`--phase-timings=${next}`);
        i++;
      } else {
        out.push("--phase-timings=summary");
      }
      continue;
    }
    out.push(a);
  }
  return out;
}
