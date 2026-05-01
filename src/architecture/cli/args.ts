/**
 * Resolved arguments for one architecture run.
 *
 * Mirrors `src/duplication/cli/args.ts` so the root CLI's commander
 * registrar and the in-process `main(argv, io)` entry point share one
 * value type. Anything user-tunable lives here; the orchestrator in
 * `./main.ts` is read-only against this object.
 */

import type { RevRange } from "../../util/git/parseRevRange.ts";

export type ReportFormat = "markdown" | "json";

export type PhaseTimingsLevel = "summary" | "verbose";

export interface ArchParsedArgs {
  kind: "run";
  /** Optional `[path]` positional. `undefined` means "use cwd". */
  path: string | undefined;
  format: ReportFormat;
  excludeGlobs: string[];
  /**
   * Optional ref to build the graph at. `undefined` means "scan the
   * working tree" — mirrors comp's default. Distinct from `--diff`,
   * which only filters the displayed candidates.
   */
  ref: string | undefined;
  /**
   * Optional `--diff` revrange. Display filter only — the graph is
   * still built against the full ref selected by `ref`. Matches comp's
   * `--diff` semantics exactly.
   */
  diff: RevRange | undefined;
  phaseTimings: PhaseTimingsLevel | undefined;
  limit: number;
  verbose: boolean;
  /** `--include-tests` (default: off). */
  includeTests: boolean;
  /** `--include-types` (default: on). */
  includeTypes: boolean;
}

export const DEFAULT_LIMIT = 20;

export class ArgParseError extends Error {
  override readonly name = "ArgParseError";
}
