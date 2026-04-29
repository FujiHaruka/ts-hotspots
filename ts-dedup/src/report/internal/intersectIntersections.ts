import { nonNull } from "../../util/nonNull.ts";
import type { Intersections } from "../evidence.ts";

/**
 * Intersect a list of `Intersections` axis by axis.
 *
 * Each input is an ascending-sorted array of feature keys (as produced by
 * `buildIntersectionsFromSets`). For each axis the function 2-pointer-folds
 * the input list into a single ascending-sorted array containing only keys
 * present in **every** input.
 *
 * Empty input list returns empty arrays — there is no "universe" to take
 * the intersection of, and "shared by every group member" is trivially
 * empty in that case.
 */
export function intersectIntersections(
  inputs: readonly Intersections[],
): Intersections {
  if (inputs.length === 0) {
    return { tokens: [], statements: [], calls: [] };
  }
  return {
    tokens: foldAxis(inputs, (i) => i.tokens),
    statements: foldAxis(inputs, (i) => i.statements),
    calls: foldAxis(inputs, (i) => i.calls),
  };
}

function foldAxis(
  inputs: readonly Intersections[],
  pick: (i: Intersections) => readonly string[],
): string[] {
  let acc = pick(nonNull(inputs[0])).slice();
  for (let i = 1; i < inputs.length; i++) {
    if (acc.length === 0) return acc;
    acc = intersectSorted(acc, pick(nonNull(inputs[i])));
  }
  return acc;
}

function intersectSorted(a: readonly string[], b: readonly string[]): string[] {
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    const av = nonNull(a[i]);
    const bv = nonNull(b[j]);
    if (av === bv) {
      out.push(av);
      i++;
      j++;
    } else if (av < bv) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}
