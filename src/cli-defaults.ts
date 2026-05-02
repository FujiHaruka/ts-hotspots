/**
 * Defaults shared by the comp / dup / arch CLI surfaces.
 *
 * Centralised so a flag-default change cannot silently drift between
 * subcommands. Per CLAUDE.md's "keep flag surfaces in sync" rule, this
 * file is the one place to bump `--limit`, the default report format,
 * the churn window, the default ref, etc.
 *
 * Types live here too because the array constants below are typed
 * against them — splitting them across files would create a circular
 * import. The types are otherwise structurally identical across
 * subcommands.
 */

/**
 * `as const` keeps the type as the literal `"ts-hotspots"` so it stays
 * assignable to the `name: "ts-hotspots"` field declared on each
 * subcommand's tool envelope (`ReportTool` in schema.ts, `ArchTool`,
 * dup's `ReportTool`).
 */
export const TOOL_NAME = "ts-hotspots" as const;

export type ReportFormat = "markdown" | "json";
export type PhaseTimingsLevel = "summary" | "verbose";

export const DEFAULT_LIMIT = 20;
export const DEFAULT_FORMAT: ReportFormat = "markdown";
export const DEFAULT_CHURN_WINDOW = 200;
/**
 * Default git ref used by `--ref` (the build-at ref in dup/arch) and by
 * `--churn-ref` (the commit walk anchor in comp/dup). Both have always
 * defaulted to HEAD; collapsing the names removes the question "are
 * these supposed to track each other?" — they always will.
 */
export const DEFAULT_REF = "HEAD";

export const PHASE_TIMINGS_LEVELS: readonly PhaseTimingsLevel[] = [
  "summary",
  "verbose",
];
export const PHASE_TIMINGS_DEFAULT: PhaseTimingsLevel = "summary";
