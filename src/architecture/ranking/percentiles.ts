/**
 * Percentile + z-score utilities for the architecture ranking layer.
 *
 * Percentile uses the "average rank, then divide by N" convention so
 * ties land at the same percentile and the top value is exactly `1.0`.
 * `rank` is 1-based and equal to the high-end position of the value
 * (so the *highest* value has `rank = N`). The agent-facing report
 * describes the candidate's standing relative to the population, so
 * we translate to "rank from the top" downstream by `N - rank + 1`.
 *
 * Z-score is standard `(value - mean) / stddev`; population stddev,
 * not sample, since we're treating the project as the universe. When
 * stddev is `0` (all values equal), the z-score is `0` — the
 * standard NaN-trap.
 *
 * The fallback rule from the requirements doc lives here: in small
 * graphs (`N < smallNCutoff`), a node only counts as ranked when both
 * its percentile clears the threshold *and* its z-score clears the
 * floor. Healthy small repos where every metric is uniformly low
 * therefore report "none" rather than mechanical false positives.
 */

export interface PercentileEntry {
  readonly value: number;
  readonly percentile: number;
  /** 1-based, top end of the value's tied block. */
  readonly rank: number;
  readonly zScore: number;
}

export interface ComputePercentileOptions {
  readonly population: readonly number[];
}

/**
 * Build a `value → PercentileEntry` lookup over `population`. Calling
 * `lookup(value)` returns the percentile / rank / z-score the way the
 * candidate cards expect them. Values not in the population fall back
 * to `0`s; the caller is expected to call only with values that came
 * from `population`.
 */
export function buildPercentileLookup(
  options: ComputePercentileOptions,
): (value: number) => PercentileEntry {
  const { population } = options;
  if (population.length === 0) {
    return () => ({ value: 0, percentile: 0, rank: 0, zScore: 0 });
  }
  const sorted = [...population].sort((a, b) => a - b);
  const n = sorted.length;

  // High-end rank table: value → 1-based rank of the *last* occurrence.
  const lastRankByValue = new Map<number, number>();
  for (let i = 0; i < n; i++) {
    lastRankByValue.set(sorted[i] as number, i + 1);
  }
  const meanStd = computeMeanStd(sorted);
  // When every population value is identical there is no ranking
  // signal — every node is at "the top" by tie. Reporting that as
  // percentile = 1.0 would force-flag the entire graph for any smell
  // whose threshold is below 1.0. Collapse to 0 instead, so uniform
  // distributions register as "no signal".
  const uniform = meanStd.stddev === 0;

  return (value: number): PercentileEntry => {
    const rank = lastRankByValue.get(value);
    if (rank === undefined) {
      return { value, percentile: 0, rank: 0, zScore: 0 };
    }
    if (uniform) {
      return { value, percentile: 0, rank, zScore: 0 };
    }
    const percentile = rank / n;
    const zScore = (value - meanStd.mean) / meanStd.stddev;
    return { value, percentile, rank, zScore };
  };
}

interface MeanStd {
  readonly mean: number;
  readonly stddev: number;
}

function computeMeanStd(values: readonly number[]): MeanStd {
  if (values.length === 0) return { mean: 0, stddev: 0 };
  let sum = 0;
  for (const v of values) sum += v;
  const mean = sum / values.length;
  let variance = 0;
  for (const v of values) {
    const d = v - mean;
    variance += d * d;
  }
  variance /= values.length;
  return { mean, stddev: Math.sqrt(variance) };
}
