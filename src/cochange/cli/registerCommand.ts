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
 */

import type { Command } from "commander";
import {
  collectExcludeGlob,
  parseDiff,
  parseFormat,
  parseLimit,
  parsePositiveInteger,
} from "../../cli/optionParsers.ts";
import {
  DEFAULT_FORMAT,
  DEFAULT_LIMIT,
  DEFAULT_REF,
  type ReportFormat,
} from "../../cli-defaults.ts";
import type { RevRange } from "../../util/git/parseRevRange.ts";
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

The walk uses \`git log --first-parent\`, so PRs that landed via merge
commits count as a single step. Repos with merge-heavy history will
report \`actualWindow < requestedWindow\`; that is shape, not a shallow
clone.

[path] points at a directory inside a git repository. The repo root is
discovered by walking up from [path] until a .git entry is found
(default: cwd).`;

const HELP_AFTER = `
Examples:
  ts-hotspots cochange > report.md
  ts-hotspots cochange --format json > report.json
  ts-hotspots coch --diff origin/main...        # narrow display to PR files
  ts-hotspots coch --window 500 --min-support 5
  ts-hotspots coch --ref release/v2 --exclude 'src/legacy/**'
  ts-hotspots coch --verbose

<revrange> forms accepted by --diff:
  A...B   diff from merge-base(A, B) to B (PR semantics; recommended)
  A..B    diff base against head directly
  A...    head side defaults to HEAD
  ...B    base side defaults to HEAD

\`--diff\` and \`--ref\` are orthogonal: --ref selects the history-window
endpoint, --diff narrows the displayed pairs to those touching at least
one file changed between two refs. Both can be passed.

Each reported hotspot carries a 'dismissalId' (coch:<hex>) you can pass
to 'ts-hotspots dismiss <id> --reason <text>' to filter it from future
runs.
`;

interface CochangeCliOptions {
  exclude: string[];
  diff?: RevRange;
  ref?: string;
  format?: ReportFormat;
  limit?: number;
  verbose?: boolean;
  window: number;
  minSupport: number;
  maxFilesPerCommit: number;
  file?: string;
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
      parseLimit,
    )
    .option(
      "--format <markdown|json>",
      `report format (default: ${DEFAULT_FORMAT})`,
      parseFormat,
    )
    .option(
      "--verbose",
      "emit the rich schema: window stats, gate counts, full denominators, and full SHA list",
    )
    .option(
      "--diff <revrange>",
      "scope hotspot output to pairs touching at least one file changed by <revrange> (e.g. origin/main...). Display filter only — rankings are still computed against the full window so the distribution is intact. (Note: `dup --diff` instead defines the comparison's base/head sides.)",
      parseDiff,
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
    .option(
      "--file <path>",
      "single-anchor mode: rank co-change partners of <path> only",
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
    diff: opts.diff,
    window: opts.window,
    minSupport: opts.minSupport,
    maxFilesPerCommit: opts.maxFilesPerCommit,
    limit,
    verbose: opts.verbose === true,
    file: opts.file,
  };
}
