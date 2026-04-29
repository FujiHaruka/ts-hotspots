import { type Fragment, fragmentLineCount } from "../domain/fragment.ts";

/**
 * Absolute-length bonus, saturating in `[0, 1]` on a log10 scale.
 *
 * Uses `min(linesA, linesB)`: both fragments must be long for the bonus to
 * approach 1. A pair where one side is short cannot ride on the other's
 * length. The log scale makes the gap between 20→80 lines weigh the same
 * as 80→320 — closer to the perceived value of a refactor candidate than
 * a linear ramp.
 *
 * `saturationLines` is the line count at which the score reaches 1.0.
 * Values <= 1 are treated as 1 to avoid `log10(<=0)` / divide-by-zero.
 */
export function lengthScore(
  a: Fragment,
  b: Fragment,
  saturationLines: number,
): number {
  const linesA = Math.max(1, fragmentLineCount(a));
  const linesB = Math.max(1, fragmentLineCount(b));
  const min = Math.min(linesA, linesB);
  const sat = Math.max(2, saturationLines);
  const ratio = Math.log10(min) / Math.log10(sat);
  if (ratio <= 0) return 0;
  if (ratio >= 1) return 1;
  return ratio;
}
