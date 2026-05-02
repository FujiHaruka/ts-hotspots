/**
 * Resolved arguments for one cochange run.
 *
 * Mirrors `src/architecture/cli/args.ts` so the root CLI's commander
 * registrar and the in-process `main(argv, io)` entry point share one
 * value type. Anything user-tunable lives here; the orchestrator in
 * `./main.ts` is read-only against this object.
 *
 * `--file` is M7 work and is not present here. The shape is left
 * future-friendly: when it lands, add `file?: string` and the registrar
 * fans the new option into it.
 */

import type { ReportFormat } from "../../cli-defaults.ts";
import type { RevRange } from "../../util/git/parseRevRange.ts";

export interface CochangeParsedArgs {
  kind: "run";
  /** Optional `[path]` positional. `undefined` means "use cwd". */
  path: string | undefined;
  format: ReportFormat;
  excludeGlobs: string[];
  /**
   * Optional ref — endpoint of the history window. `undefined` means
   * "use the registrar's default" (HEAD). The orchestrator passes the
   * resolved value straight through to `git log`.
   */
  ref: string | undefined;
  /**
   * Optional `--diff` revrange. Display filter only — the full window
   * walk and gate still run against the ref selected by `ref`. Matches
   * comp/arch's `--diff` semantics exactly. Orthogonal to `--ref`.
   */
  diff: RevRange | undefined;
  /** Number of commits the walker will consume (`-n <window>`). */
  window: number;
  /** Floor on the raw co-change count; pairs below are dropped pre-rank. */
  minSupport: number;
  /** Drop commits touching more than this many tracked-and-canonical files. */
  maxFilesPerCommit: number;
  limit: number;
  verbose: boolean;
}

export class ArgParseError extends Error {
  override readonly name = "ArgParseError";
}
