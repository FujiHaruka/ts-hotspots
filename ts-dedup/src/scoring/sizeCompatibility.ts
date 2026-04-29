import { type Fragment, fragmentLineCount } from "../domain/fragment.ts";

/**
 * Line-count ratio: `min(a,b) / max(a,b)`, bounded to [0, 1].
 *
 * Identical sizes return 1. A 10x size gap returns 0.1. Defensive: a 0-line
 * fragment (not expected from the extractor) is treated as 1 to avoid NaN.
 */
export function sizeCompatibility(a: Fragment, b: Fragment): number {
  const linesA = Math.max(1, fragmentLineCount(a));
  const linesB = Math.max(1, fragmentLineCount(b));
  const min = Math.min(linesA, linesB);
  const max = Math.max(linesA, linesB);
  return min / max;
}
