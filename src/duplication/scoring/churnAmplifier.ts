/**
 * Multiplicative churn amplifier applied to a group's `combined.max` to
 * derive the final sort key. Mirrors the `comp` leverage axis: churn is
 * never a candidate-creator on its own — it only amplifies an already-
 * scored similarity signal.
 *
 *   amplifier = 1 + alpha * min(churnMax, cap) / cap
 *
 * - `churnMax = 0` (no commits attributable to any file in the group, or
 *   churn collection was skipped) returns exactly `1`, so a `--no-churn`
 *   run produces the same group ranking as before this feature landed.
 * - `cap` saturates the bonus so a single mega-hot file can't dominate
 *   the report; values beyond `cap` are clamped.
 * - `cap <= 0` is treated as a disabled amplifier (returns `1`) rather
 *   than dividing by zero.
 */
export function churnAmplifier(
  churnMax: number,
  alpha: number,
  cap: number,
): number {
  if (alpha <= 0) return 1;
  if (cap <= 0) return 1;
  if (churnMax <= 0) return 1;
  const clamped = churnMax > cap ? cap : churnMax;
  return 1 + alpha * (clamped / cap);
}
