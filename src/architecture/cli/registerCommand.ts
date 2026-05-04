/**
 * `addArchitectureCommand` — single source of truth for the
 * architecture/arch subcommand's option surface.
 *
 * Mirrors `addDuplicationCommand`: same registrar pattern, same
 * help-text shape (`addHelpText("before", LONG_DESCRIPTION)`,
 * `addHelpText("after", HELP_AFTER)`). Used by the root CLI in
 * `src/cli.ts` so `ts-hotspots --help` lists arch with its full flag
 * surface.
 *
 * The action handler builds an `ArchParsedArgs` and invokes
 * `onParsed`. Running the actual pipeline is the caller's
 * responsibility — propagating exit codes through commander's
 * `parseAsync` is awkward, so orchestration stays outside the
 * registrar.
 */

import { type Command, InvalidArgumentError } from "commander";
import {
  DEFAULT_FORMAT,
  DEFAULT_LIMIT,
  type ReportFormat,
} from "../../cli-defaults.ts";
import {
  parseRevRange,
  RevRangeParseError,
} from "../../util/git/parseRevRange.ts";
import { EDGE_WEIGHTS } from "../graph/types.ts";
import { type ArchParsedArgs } from "./args.ts";

const SHORT_DESCRIPTION =
  "rank exported components by structural pressure (fan-in / fan-out / centrality)";

const LONG_DESCRIPTION = `By default the entire repository is scanned at the working tree.
Pass --ref <ref> to build the graph at a specific commit/branch/tag.
The report ranks exported components against six structural smells —
architectural_hub, high_fanout_component, high_impact_component,
bridge_component, unstable_dependency_candidate, over_shared_component
— using percentile-weighted composites of fan-in / fan-out / reverse
closure / PageRank / betweenness / instability. Output is written to
stdout; redirect it to a file if you want to keep it.

[path] points at a directory inside a git repository. The repo root is
discovered by walking up from [path] until a .git entry is found
(default: cwd).`;

const HELP_AFTER = `
Examples:
  ts-hotspots architecture > report.md
  ts-hotspots architecture --format json > report.json
  ts-hotspots arch --diff origin/main... > scoped.md
  ts-hotspots arch --ref release/v2 --exclude 'src/legacy/**'
  ts-hotspots arch --no-include-types        # drop type-only edges entirely

<revrange> forms accepted by --diff:
  A...B   diff from merge-base(A, B) to B (PR semantics; recommended)
  A..B    diff base against head directly
  A...    head side defaults to HEAD
  ...B    base side defaults to HEAD

\`--diff\` and \`--ref\` are orthogonal: --ref selects the graph base,
--diff narrows the displayed candidates to components defined in
files changed between two refs. Both can be passed.

Each reported hotspot carries a 'dismissalId' (arch:<hex>) you can pass to
'ts-hotspots dismiss <id> --reason <text>' to filter it from future runs.
`;

interface ArchCliOptions {
  exclude: string[];
  diff?: ReturnType<typeof parseRevRange>;
  ref?: string;
  format?: ReportFormat;
  limit?: number;
  verbose?: boolean;
  /**
   * Commander defaults `--no-X` boolean flags to `true` and flips to
   * `false` when the user passes `--no-include-types`. We treat
   * `false` (the only explicit override) as "drop type edges" and
   * everything else as "include them".
   */
  includeTypes: boolean;
}

export function addArchitectureCommand(
  parent: Command,
  onParsed: (args: ArchParsedArgs) => void,
): Command {
  return parent
    .command("architecture [path]")
    .alias("arch")
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
      "emit the rich schema: per-secondary metrics, project component count, summary",
    )
    .option(
      "--diff <revrange>",
      "scope hotspot output to components in files changed by <revrange> (e.g. origin/main...). Display filter only — rankings are computed against the full graph. (Note: `dup --diff` instead defines the comparison's base/head sides.)",
      parseDiffOption,
    )
    .option(
      "--ref <ref>",
      "commit/branch/tag to build the graph at (default: working tree)",
    )
    .option(
      "--no-include-types",
      `drop type-only edges from the graph (default: include them, weight ${String(EDGE_WEIGHTS.type)})`,
    )
    .action((pathArg: string | undefined, opts: ArchCliOptions) => {
      onParsed(buildParsedArgs(pathArg, opts));
    });
}

function buildParsedArgs(
  pathArg: string | undefined,
  opts: ArchCliOptions,
): ArchParsedArgs {
  const format: ReportFormat = opts.format ?? DEFAULT_FORMAT;
  const limit = opts.limit ?? DEFAULT_LIMIT;
  return {
    kind: "run",
    path: pathArg,
    format,
    excludeGlobs: opts.exclude,
    ref: opts.ref,
    diff: opts.diff,
    limit,
    verbose: opts.verbose === true,
    includeTypes: opts.includeTypes,
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

function parseDiffOption(value: string): ReturnType<typeof parseRevRange> {
  try {
    return parseRevRange(value);
  } catch (err) {
    if (err instanceof RevRangeParseError) {
      throw new InvalidArgumentError(err.message);
    }
    throw err;
  }
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
