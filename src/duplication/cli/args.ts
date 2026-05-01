import { Command, CommanderError } from "commander";
import {
  addDuplicationCommand,
  normalizePhaseTimingsArgv,
} from "./registerCommand.ts";

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

/**
 * Parse ts-hotspots duplication argv. Throws `ArgParseError` with a
 * user-facing message on missing or malformed positional, unknown flags,
 * etc. Returns a `"help"` variant for `--help` / `-h` so the caller can
 * render usage and exit 0.
 *
 * Backed by a private commander program built with `addDuplicationCommand`
 * — the same registrar wires the option surface for the root CLI in
 * `src/cli.ts` and the `main(argv, io)` entry point in `./main.ts`. This
 * function is the test seam for `args.test.ts`, which exercises the
 * commander-side parsing and the post-parse validation in isolation.
 */
export function parseCliArgs(argv: readonly string[]): ArgsResult {
  let captured: ParsedArgs | undefined;
  const program = new Command();
  program.exitOverride();
  // Swallow commander's writes — the caller of parseCliArgs only wants
  // the parsed result or a thrown error, not free-form output.
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });

  addDuplicationCommand(program, (args) => {
    captured = args;
  });

  try {
    program.parse([
      "node",
      "ts-hotspots",
      "duplication",
      ...normalizePhaseTimingsArgv(argv),
    ]);
  } catch (err) {
    if (err instanceof CommanderError) {
      if (err.code === "commander.helpDisplayed") {
        return { kind: "help" };
      }
      throw new ArgParseError(err.message);
    }
    throw err;
  }

  if (captured === undefined) {
    throw new ArgParseError("duplication command did not run");
  }
  return captured;
}
