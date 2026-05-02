/**
 * Jaccard / overlap-coefficient helpers over two pre-built sets.
 *
 * The candidate-pair re-scorer needs the per-axis ratio for *every* scored
 * pair, but the actual intersection keys (used as evidence) only for pairs
 * that pass `shouldReport`. Splitting into a count-only path and an
 * intersection-building path lets the caller skip the array allocation +
 * sort for the ~96% of pairs that get rejected.
 *
 * `overlapCoefficient` (Szymkiewicz–Simpson) is `|A ∩ B| / min(|A|, |B|)`.
 * It complements Jaccard for the "long function ⊃ short function" case:
 * Jaccard's union-based denominator drags long fragments down even when
 * one is essentially contained in the other, while overlap saturates at 1.
 *
 * Convention for the empty-empty case: jaccard / overlap = 0,
 * intersection = []. Absence of evidence is not similarity.
 */
export interface JaccardCount {
  jaccard: number;
  overlapCoefficient: number;
  intersectionSize: number;
}

/**
 * Compute Jaccard + overlap-coefficient ratios + intersection size without
 * materialising the intersection array. Walks the smaller set once and
 * probes the larger.
 */
export function jaccardCount(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): JaccardCount {
  if (a.size === 0 && b.size === 0) {
    return { jaccard: 0, overlapCoefficient: 0, intersectionSize: 0 };
  }
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let intersectionSize = 0;
  for (const key of small) {
    if (large.has(key)) intersectionSize += 1;
  }
  const unionSize = a.size + b.size - intersectionSize;
  const jaccard = unionSize === 0 ? 0 : intersectionSize / unionSize;
  const minSize = Math.min(a.size, b.size);
  const overlapCoefficient = minSize === 0 ? 0 : intersectionSize / minSize;
  return { jaccard, overlapCoefficient, intersectionSize };
}

/**
 * Build the ascending-sorted intersection of `a` and `b`. Used only after
 * a pair passes `shouldReport`, so the sort cost is paid for ~4% of scored
 * pairs in whole-repo mode rather than 100%.
 */
export function intersectionSorted(
  a: ReadonlySet<string>,
  b: ReadonlySet<string>,
): string[] {
  if (a.size === 0 || b.size === 0) return [];
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  const out: string[] = [];
  for (const key of small) {
    if (large.has(key)) out.push(key);
  }
  out.sort();
  return out;
}
