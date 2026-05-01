/**
 * Optional config block for the architecture subcommand. v1 ships only
 * the downweight rules; absent config = no downweight. Loaded from
 * `.ts-hotspots.json` (or `ts-hotspots.config.json`) at the repo root
 * by `loadArchConfig`.
 *
 * Every numeric field is constrained to `[0, 1]`; the loader rejects
 * out-of-range values with an `ArchConfigError`. We intentionally do
 * not allow factors > 1 — that would be an *upweight*, which has no
 * principled use case (the default base weights are already calibrated
 * by edge kind) and would let configuration force false positives.
 */

export interface DownweightRule {
  /**
   * POSIX glob (same syntax as `--exclude`). Matched against both
   * endpoints of every edge — if either the source file or the target
   * file matches, the rule's `factor` is multiplied into the edge
   * weight. Multiple matching rules compose multiplicatively.
   */
  readonly glob: string;
  /**
   * Multiplier in `[0, 1]`. `0` drops edges entirely (equivalent to
   * adding the glob to `--exclude`); `1` is a no-op; `0.5` halves the
   * weight.
   */
  readonly factor: number;
}

export interface ArchConfig {
  readonly downweight: readonly DownweightRule[];
}

export const EMPTY_ARCH_CONFIG: ArchConfig = { downweight: [] };

export class ArchConfigError extends Error {
  override readonly name = "ArchConfigError";
}
