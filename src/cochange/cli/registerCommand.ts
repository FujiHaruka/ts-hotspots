/**
 * `addCochangeCommand` — single source of truth for the cochange/coch
 * subcommand's option surface.
 *
 * Mirrors `addArchitectureCommand`: same registrar pattern, same
 * help-text shape (`addHelpText("before", LONG_DESCRIPTION)`,
 * `addHelpText("after", HELP_AFTER)`). Used by the root CLI in
 * `src/cli.ts` so `ts-hotspots --help` lists cochange with its full flag
 * surface.
 *
 * The action handler builds a `CochangeParsedArgs` and invokes
 * `onParsed`. Running the actual pipeline is the caller's
 * responsibility — propagating exit codes through commander's
 * `parseAsync` is awkward, so orchestration stays outside the
 * registrar.
 *
 * `--diff` (M6) and `--file` (M7) are deliberately not registered here
 * yet. The shape is left future-friendly so adding them is mechanical.
 */

import { type Command, InvalidArgumentError } from "commander";
import {
  DEFAULT_FORMAT,
  DEFAULT_LIMIT,
  DEFAULT_REF,
  type ReportFormat,
} from "../../cli-defaults.ts";
import { DEFAULT_MIN_SUPPORT } from "../ranking/defaults.ts";
import { type CochangeParsedArgs } from "./args.ts";
import {
  DEFAULT_COCHANGE_MAX_FILES_PER_COMMIT,
  DEFAULT_COCHANGE_WINDOW,
} from "./defaults.ts";

const SHORT_DESCRIPTION =
  "rank file pairs that change together in git history (logical coupling)";

const LONG_DESCRIPTION = `Walks recent git history and surfaces TypeScript file pairs that
change together more often than chance. The unit of analysis is a
canonical-ordered file pair (A, B); for each pair the report carries
support (raw co-change count), conditional probabilities
(P(B | A) / P(A | B)), and lift (above-chance multiplier).

By default the entire repository is scanned at HEAD over the last 200
commits. Pass --ref to choose a different endpoint, --window to widen
or narrow the walk. Output is written to stdout; redirect it to a file
if you want to keep it.

[path] points at a directory inside a git repository. The repo root is
discovered by walking up from [path] until a .git entry is found
(default: cwd).`;

const HELP_AFTER = `
Examples:
  ts-hotspots cochange > report.md
  ts-hotspots cochange --format json > report.json
  ts-hotspots coch --window 500 --min-support 5
  ts-hotspots coch --ref release/v2 --exclude 'src/legacy/**'
  ts-hotspots coch --verbose

Each reported hotspot carries a 'dismissalId' (coch:<hex>) you can pass
to 'ts-hotspots dismiss <id> --reason <text>' to filter it from future
runs.
`;

interface CochangeCliOptions {
  exclude: string[];
  ref?: string;
  format?: ReportFormat;
  limit?: number;
  verbose?: boolean;
  window: number;
  minSupport: number;
  maxFilesPerCommit: number;
}

export function addCochangeCommand(
  parent: Command,
  onParsed: (args: CochangeParsedArgs) => void,
): Command {
  return parent
    .command("cochange [path]")
    .alias("coch")
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
      "--limit <N|all>",
      `max entries in hotspots[] (default: ${String(DEFAULT_LIMIT)}). Pass 'all' to keep every candidate.`,
      parseLimitOption,
    )
    .option(
      "--format <markdown|json>",
      `report format (default: ${DEFAULT_FORMAT})`,
      parseFormatOption,
    )
    .option(
      "--verbose",
      "emit the rich schema: window stats, gate counts, full denominators, and full SHA list",
    )
    .option(
      "--ref <ref>",
      `endpoint of the history window (default: ${DEFAULT_REF})`,
      DEFAULT_REF,
    )
    .option(
      "--window <N>",
      `number of commits in the window (default: ${String(DEFAULT_COCHANGE_WINDOW)})`,
      parsePositiveInteger("--window"),
      DEFAULT_COCHANGE_WINDOW,
    )
    .option(
      "--min-support <N>",
      `drop pairs with raw co-change count below N (default: ${String(DEFAULT_MIN_SUPPORT)})`,
      parsePositiveInteger("--min-support"),
      DEFAULT_MIN_SUPPORT,
    )
    .option(
      "--max-files-per-commit <N>",
      `ignore commits that touch more than N files (default: ${String(DEFAULT_COCHANGE_MAX_FILES_PER_COMMIT)})`,
      parsePositiveInteger("--max-files-per-commit"),
      DEFAULT_COCHANGE_MAX_FILES_PER_COMMIT,
    )
    .action((pathArg: string | undefined, opts: CochangeCliOptions) => {
      onParsed(buildParsedArgs(pathArg, opts));
    });
}

function buildParsedArgs(
  pathArg: string | undefined,
  opts: CochangeCliOptions,
): CochangeParsedArgs {
  const format: ReportFormat = opts.format ?? DEFAULT_FORMAT;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  return {
    kind: "run",
    path: pathArg,
    format,
    excludeGlobs: opts.exclude,
    ref: opts.ref,
    window: opts.window,
    minSupport: opts.minSupport,
    maxFilesPerCommit: opts.maxFilesPerCommit,
    limit,
    verbose: opts.verbose === true,
  };
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

function parseFormatOption(value: string): ReportFormat {
  if (value === "markdown" || value === "json") return value;
  throw new InvalidArgumentError(
    `invalid --format '${value}' (expected 'markdown' or 'json')`,
  );
}

function parseLimitOption(value: string): number {
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

function parsePositiveInteger(flagName: string): (value: string) => number {
  return (value: string): number => {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new InvalidArgumentError(
        `invalid ${flagName} '${value}' (expected a positive integer)`,
      );
    }
    const n = Number.parseInt(trimmed, 10);
    if (n <= 0) {
      throw new InvalidArgumentError(
        `invalid ${flagName} '${value}' (expected a positive integer)`,
      );
    }
    return n;
  };
}
