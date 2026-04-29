import { type Fragment, fragmentLineCount } from "../domain/fragment.ts";

/**
 * True iff both fragments are at least `minLines` long.
 *
 * Used to gate the scoring loop — pairs where either side is shorter than
 * the configured floor are dropped before any Jaccard work. Defensive: a
 * non-positive `minLines` short-circuits to true (the gate is effectively
 * off).
 */
export function meetsMinSize(
  a: Fragment,
  b: Fragment,
  minLines: number,
): boolean {
  if (minLines <= 0) return true;
  const linesA = fragmentLineCount(a);
  const linesB = fragmentLineCount(b);
  return Math.min(linesA, linesB) >= minLines;
}
