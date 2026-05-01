import { parseArgs } from "node:util";
import {
  parseRevRange,
  RevRangeParseError,
} from "../../util/git/parseRevRange.ts";

export type ReportFormat = "markdown" | "json";

export type PhaseTimingsLevel = "summary" | "verbose";

/**
 * Resolved churn-collector settings for one duplication run.
 *
 * - `enabled = false` (set by `--no-churn`) skips the collector entirely
 *   and yields the legacy ranking (groups sorted by raw `combined.max`,
 *   no `aggregateChurn` metadata).
 * - `ref = undefined` defers ref selection to the caller — diff mode
 *   uses the head ref; whole-repo mode uses the scan ref. `--churn-ref`
 *   overrides both.
 */
export interface ChurnCliConfig {
  enabled: boolean;
  window: number;
  ref: string | undefined;
}

export interface DiffModeArgs {
  kind: "run";
  mode: "diff";
  baseRef: string;
  headRef: string;
  /** `true` for `A...B` (merge-base semantics). `false` for `A..B`. */
  threeDot: boolean;
  /**
   * Optional `[path]` positional. `undefined` means "use cwd". The resolver
   * in `main.ts` walks this path up to a git repository root.
   */
  path: string | undefined;
  format: ReportFormat;
  /** User-supplied glob patterns added on top of the built-in defaults. */
  excludeGlobs: string[];
  /**
   * Detail level for the JSON Lines perf log emitted on stderr. `undefined`
   * disables the log entirely.
   */
  phaseTimings: PhaseTimingsLevel | undefined;
  /**
   * Maximum number of clone groups kept in the report after ranking. Use
   * `Number.POSITIVE_INFINITY` (set by `--limit all`) to keep every group.
   */
  limit: number;
  /**
   * `true` when `--verbose` is passed: emit the rich output schema (per-
   * member scores, full evidence, fragment source, recommendation hint,
   * aggregate axes, analysis summary). Default `false` so an agent gets
   * just coordinates + top evidence.
   */
  verbose: boolean;
  /** Churn-collector wiring; mirrors `comp`'s `--churn-*` flags. */
  churn: ChurnCliConfig;
}

export interface WholeRepoModeArgs {
  kind: "run";
  mode: "whole-repo";
  /** Commit / branch / tag to scan. */
  ref: string;
  /** See `DiffModeArgs.path`. */
  path: string | undefined;
  format: ReportFormat;
  excludeGlobs: string[];
  /** See `DiffModeArgs.phaseTimings`. */
  phaseTimings: PhaseTimingsLevel | undefined;
  /** See `DiffModeArgs.limit`. */
  limit: number;
  /** See `DiffModeArgs.verbose`. */
  verbose: boolean;
  /** See `DiffModeArgs.churn`. */
  churn: ChurnCliConfig;
}

export const DEFAULT_LIMIT = 20;
export const DEFAULT_CHURN_WINDOW = 200;

export type ParsedArgs = DiffModeArgs | WholeRepoModeArgs;

export interface HelpArgs {
  kind: "help";
}

export type ArgsResult = ParsedArgs | HelpArgs;

export class ArgParseError extends Error {
  override readonly name = "ArgParseError";
}

export const USAGE = `Usage:
  ts-hotspots duplication [path] [options]

By default the entire repository is scanned at HEAD. Pass --diff <revrange>
to compare the head side of a diff against the rest of the codebase on the
base side. The report is written to stdout; redirect it to a file if you
want to keep it.

[path] points at a directory inside a git repository. The repo root is
discovered by walking up from [path] until a .git entry is found
(default: cwd).

Options:
  --diff <revrange>        Scope to a git revision range. Mutually exclusive
                           with --ref. <revrange> forms:
                             A...B   diff from merge-base(A, B) to B
                                     (PR semantics; recommended)
                             A..B    diff base against head directly
                             A...    head side defaults to HEAD
                             ...B    base side defaults to HEAD
  --ref <ref>              Commit/branch/tag to scan in whole-repo mode
                           (default: HEAD). Mutually exclusive with --diff.
  --format markdown|json   Report format (default: markdown)
  --exclude <glob>         Extra path glob to exclude (repeatable). Added on
                           top of the built-in defaults (node_modules,
                           dist, generated files, test files, ...).
  --phase-timings[=LEVEL]  Emit a JSON Lines perf-debug log to stderr.
                           LEVEL is 'summary' (default) or 'verbose' (adds a
                           per-query record per changed fragment). Pipe with
                           '2> perf.log' to capture.
  --limit <N|all>          Cap the hotspots list at the top N by combined
                           score (default: 20). Pass 'all' to keep every
                           group.
  --verbose                Emit the rich schema: per-member scores,
                           fragment source, full evidence (statement
                           kinds, token n-grams), recommendation hint,
                           aggregate score axes, and the analysis
                           summary. Default output keeps just the
                           coordinates and top shared evidence.
  --churn-window <N>       Number of commits walked by 'git log' to
                           compute per-file churn (default: 200). Used
                           to amplify the score of clone groups whose
                           files have been edited recently.
  --churn-ref <ref>        Ref to walk for churn (default: diff head ref
                           in diff mode, --ref in whole-repo mode).
  --no-churn               Disable churn collection. Groups are sorted
                           by raw similarity and 'aggregateChurn' is
                           omitted from the report.
  -h, --help               Show this help and exit

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

Each reported group carries a 'dismissalId' (dup:<hex>) you can pass to
'ts-hotspots dismiss <id> --reason <text>' to filter it from future runs.
The id auto-expires when the group's membership changes.
`;

/**
 * Parse ts-hotspots duplication argv. Throws `ArgParseError` with a user-facing message on
 * missing or malformed positional, unknown flags, etc. Returns a `"help"`
 * variant for `--help` / `-h` so the caller can render usage and exit 0.
 */
export function parseCliArgs(argv: readonly string[]): ArgsResult {
  // Pre-normalise `--phase-timings` so a bare flag is treated as `=summary`.
  // `parseArgs` cannot natively express a string option whose value is
  // optional, so we rewrite the argv slice ourselves before delegating.
  const normalized = normalizePhaseTimings(argv);

  let values: ParsedValues;
  let positionals: string[];
  try {
    const parsed = parseArgs({
      args: normalized,
      options: OPTIONS,
      allowPositionals: true,
      strict: true,
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (err) {
    throw new ArgParseError(err instanceof Error ? err.message : String(err));
  }

  if (values.help === true) {
    return { kind: "help" };
  }

  const diffInput = values.diff;
  const ref = values.ref;
  const format = parseFormat(values.format);
  const excludeGlobs = parseExcludeGlobs(values.exclude);
  const phaseTimings = parsePhaseTimingsLevel(values["phase-timings"]);
  const limit = parseLimit(values.limit);
  const verbose = values.verbose === true;
  const churn = parseChurnConfig(values);

  if (positionals.length > 1) {
    throw new ArgParseError(
      `expected at most one positional [path], got: ${positionals.join(" ")}`,
    );
  }
  const path = positionals[0];

  if (diffInput !== undefined) {
    if (ref !== undefined) {
      throw new ArgParseError("--ref and --diff are mutually exclusive");
    }
    let revRange: ReturnType<typeof parseRevRange>;
    try {
      revRange = parseRevRange(diffInput);
    } catch (err) {
      if (err instanceof RevRangeParseError) {
        throw new ArgParseError(err.message);
      }
      throw err;
    }
    return {
      kind: "run",
      mode: "diff",
      baseRef: revRange.baseRef,
      headRef: revRange.headRef,
      threeDot: revRange.threeDot,
      path,
      format,
      excludeGlobs,
      phaseTimings,
      limit,
      verbose,
      churn,
    };
  }

  return {
    kind: "run",
    mode: "whole-repo",
    ref: ref ?? "HEAD",
    path,
    format,
    excludeGlobs,
    phaseTimings,
    limit,
    verbose,
    churn,
  };
}

/**
 * Resolve `--churn-window` / `--churn-ref` / `--no-churn` into a
 * `ChurnCliConfig`. `--no-churn` wins over the other flags (specifying
 * a window with churn disabled is a no-op rather than an error).
 */
function parseChurnConfig(values: ParsedValues): ChurnCliConfig {
  const enabled = values["no-churn"] !== true;
  const window = parseChurnWindow(values["churn-window"]);
  const ref = values["churn-ref"];
  if (ref !== undefined && ref.trim().length === 0) {
    throw new ArgParseError("--churn-ref requires a non-empty value");
  }
  return { enabled, window, ref };
}

function parseChurnWindow(value: string | undefined): number {
  if (value === undefined) return DEFAULT_CHURN_WINDOW;
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ArgParseError(
      `invalid --churn-window '${value}' (expected a positive integer)`,
    );
  }
  const n = Number.parseInt(trimmed, 10);
  if (n <= 0) {
    throw new ArgParseError(
      `invalid --churn-window '${value}' (expected a positive integer)`,
    );
  }
  return n;
}

/**
 * Rewrite `--phase-timings` (bare) → `--phase-timings=summary` so it can be
 * parsed by `parseArgs` as a string option. Also handles the space-separated
 * `--phase-timings summary` / `--phase-timings verbose` forms.
 */
function normalizePhaseTimings(argv: readonly string[]): string[] {
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

/** Validate a string option value as a `PhaseTimingsLevel` or `undefined`. */
function parsePhaseTimingsLevel(
  value: string | undefined,
): PhaseTimingsLevel | undefined {
  if (value === undefined) return undefined;
  if (value === "summary" || value === "verbose") return value;
  throw new ArgParseError(
    `invalid --phase-timings level '${value}' (expected 'summary' or 'verbose')`,
  );
}

/**
 * Parse the `--limit` value.
 *
 * - omitted          → DEFAULT_LIMIT (20)
 * - `"all"`          → POSITIVE_INFINITY (no cap)
 * - positive integer → that integer
 * - anything else    → ArgParseError
 */
function parseLimit(value: string | undefined): number {
  if (value === undefined) return DEFAULT_LIMIT;
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === "all") return Number.POSITIVE_INFINITY;
  if (!/^\d+$/.test(trimmed)) {
    throw new ArgParseError(
      `invalid --limit '${value}' (expected a positive integer or 'all')`,
    );
  }
  const n = Number.parseInt(trimmed, 10);
  if (n <= 0) {
    throw new ArgParseError(
      `invalid --limit '${value}' (expected a positive integer or 'all')`,
    );
  }
  return n;
}

function parseFormat(value: string | undefined): ReportFormat {
  if (value === undefined) return "markdown";
  if (value === "markdown" || value === "json") return value;
  throw new ArgParseError(
    `invalid --format '${value}' (expected 'markdown' or 'json')`,
  );
}

function parseExcludeGlobs(values: string[] | undefined): string[] {
  if (values === undefined) return [];
  const out: string[] = [];
  for (const v of values) {
    const trimmed = v.trim();
    if (trimmed.length === 0) {
      throw new ArgParseError("--exclude requires a non-empty glob");
    }
    out.push(trimmed);
  }
  return out;
}

const OPTIONS = {
  format: { type: "string" },
  exclude: { type: "string", multiple: true },
  diff: { type: "string" },
  ref: { type: "string" },
  "phase-timings": { type: "string" },
  limit: { type: "string" },
  verbose: { type: "boolean" },
  "churn-window": { type: "string" },
  "churn-ref": { type: "string" },
  "no-churn": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

interface ParsedValues {
  format?: string;
  exclude?: string[];
  diff?: string;
  ref?: string;
  "phase-timings"?: string;
  limit?: string;
  verbose?: boolean;
  "churn-window"?: string;
  "churn-ref"?: string;
  "no-churn"?: boolean;
  help?: boolean;
}
