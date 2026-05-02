import { nonNull } from "../util/nonNull.ts";
import { createMinHasher, type MinHashSignature } from "./minhash.ts";

/**
 * MinHash + LSH banding.
 *
 * Builds a MinHash signature per fragment and groups fragments into
 * `bands` per-band buckets. Two fragments share a bucket iff their
 * `rows` consecutive signature values match exactly within at least one
 * band. The S-curve probability of being a "candidate pair" is
 * `1 - (1 - J^rows)^bands`, which transitions sharply at
 * `J ≈ (1 / bands)^(1 / rows)` — pairs above the inflection are emitted
 * with high probability, pairs below are dropped.
 *
 * Multiple seeded passes (`seedCount > 1`) build independent hash
 * families; emitted candidate pairs are unioned. Each extra pass costs
 * roughly the same as the first but lifts recall on pairs near the
 * inflection.
 *
 * Determinism: fragmentIndices are inserted into per-band buckets in
 * input order, and `forEachCandidatePair` iterates buckets in insertion
 * order, so the emitted pair stream is bit-identical across runs given
 * fixed `(numHashes, bands, rows, seedCount, seed)`.
 */

export interface LshIndexInput {
  /**
   * Stable, caller-assigned non-negative integer fragment id. Used
   * directly as the bucket-member identity and emitted back to the
   * `forEachCandidatePair` visitor — the index never interns or
   * stringifies it. Caller-supplied ordering of these ids becomes the
   * canonical `(lo, hi)` pair ordering for downstream dedup, so callers
   * that need lex-of-original-id canonical pairs should assign indices
   * in lex order at index-build time.
   */
  fragmentId: number;
  /**
   * Feature keys for the axis being indexed. The caller picks one axis
   * (token / call / …) per LSH index — multi-axis recall comes from
   * building separate indices per axis and unioning their candidate pair
   * streams.
   */
  features: ReadonlySet<string>;
}

export interface LshParams {
  numHashes: number;
  bands: number;
  rows: number;
  seedCount: number;
  seed: number;
  /**
   * Per-band bucket size cap. Buckets with more than this many fragments
   * are dropped entirely — defensive against degenerate signature
   * collisions that would otherwise produce O(k²) low-quality pairs.
   * Non-positive disables the cap.
   */
  maxBucketSize: number;
  /**
   * Minimum feature-set size required for a fragment to be inserted into
   * the LSH index. Fragments below this floor are skipped on this axis
   * (other axes still see them). `1` keeps the legacy behavior of
   * dropping only empty inputs; higher values defend against the
   * small-set MinHash degeneracy described in `buildLshIndex`.
   */
  minFeatures: number;
}

export interface LshIndex {
  readonly params: LshParams;
  readonly fragmentCount: number;
  readonly signatureCount: number;
  /**
   * Emit each unique candidate pair exactly once. Pairs are dedup'd
   * across bands and across seedCount passes via a `Set<number>` keyed
   * by a `(lo, hi)`-packed integer. The visitor receives the pair with
   * the numerically-smaller fragmentId first.
   */
  forEachCandidatePair(visit: (a: number, b: number) => void): void;
  /**
   * Telemetry. Populated during `build` and cheap to read.
   */
  readonly stats: LshStats;
}

export interface LshStats {
  /** Total bucket-collision pair count, before per-pair dedup. */
  readonly bucketCollisionPairs: number;
  /** Sum of bucket sizes across all bands and seeds. */
  readonly totalBuckets: number;
  /** Largest single bucket size seen (across all bands and seeds). */
  readonly maxBucketSize: number;
  /** Bucket count whose `size > 1` (i.e. that contributed candidates). */
  readonly nonTrivialBuckets: number;
  /** Bucket count dropped by `maxBucketSize`. */
  readonly droppedBuckets: number;
}

/**
 * Build the LSH index from a stream of `(fragmentId, features)`.
 * Validates `numHashes === bands * rows`.
 */
export function buildLshIndex(
  inputs: readonly LshIndexInput[],
  params: LshParams,
): LshIndex {
  if (params.numHashes !== params.bands * params.rows) {
    throw new Error(
      `numHashes (${String(params.numHashes)}) must equal bands * rows (${String(params.bands)} * ${String(params.rows)} = ${String(params.bands * params.rows)})`,
    );
  }
  if (params.seedCount < 1) {
    throw new Error(`seedCount must be >= 1 (got ${String(params.seedCount)})`);
  }

  // For each pass, build (bands × buckets) where each bucket is a list
  // of caller-supplied fragmentIds (integers). Bucket key = fnv1a32 of
  // the row values, packed as u32 → string. Hash collisions across
  // distinct row-tuples are filtered out by the downstream re-scoring
  // stage that consumes the candidate pairs.
  type Pass = Map<string, number[]>[];
  const passes: Pass[] = [];

  let bucketCollisionPairs = 0;
  let totalBuckets = 0;
  let maxBucketSize = 0;
  let nonTrivialBuckets = 0;
  let droppedBuckets = 0;
  let maxFragmentId = 0;
  const cap =
    params.maxBucketSize > 0 ? params.maxBucketSize : Number.POSITIVE_INFINITY;

  for (let pass = 0; pass < params.seedCount; pass++) {
    const hasher = createMinHasher(
      params.numHashes,
      mixSeed(params.seed, pass),
    );
    const bands: Map<string, number[]>[] = [];
    for (let b = 0; b < params.bands; b++) {
      bands.push(new Map<string, number[]>());
    }

    // Skip fragments below the configured floor. The default of 1 keeps
    // legacy behavior (drop empties only); higher values defend against
    // the small-set MinHash degeneracy where a 1-3 element feature set
    // produces a signature dominated by a handful of repeated hash
    // values, which then collide all-vs-all across every band and
    // pollute the candidate stream with O(k²) low-quality pairs.
    const minFeatures = Math.max(1, params.minFeatures);
    for (const input of inputs) {
      const featCount = sizeOf(input.features);
      if (featCount < minFeatures) continue;
      const sig = hasher.sign(input.features);
      if (input.fragmentId > maxFragmentId) maxFragmentId = input.fragmentId;
      insertIntoBands(sig, input.fragmentId, bands, params.bands, params.rows);
    }

    // Gather telemetry.
    for (const band of bands) {
      for (const bucket of band.values()) {
        totalBuckets += 1;
        if (bucket.length > maxBucketSize) maxBucketSize = bucket.length;
        if (bucket.length > cap) {
          droppedBuckets += 1;
          continue;
        }
        if (bucket.length > 1) {
          nonTrivialBuckets += 1;
          const k = bucket.length;
          bucketCollisionPairs += (k * (k - 1)) >>> 1;
        }
      }
    }

    passes.push(bands);
  }

  const fragmentCount = inputs.length;
  const stats: LshStats = {
    bucketCollisionPairs,
    totalBuckets,
    maxBucketSize,
    nonTrivialBuckets,
    droppedBuckets,
  };

  function forEachCandidatePair(visit: (a: number, b: number) => void): void {
    // Pack `(lo, hi)` → one Number key. As long as the largest fragmentId
    // squared stays inside the safe-integer range (2^53), the multiply
    // is exact. Caller is expected to keep ids small (e.g. 0..N-1
    // indices) — at repo scale (< 1M fragments) this trivially holds.
    const stride = maxFragmentId + 1;
    const seen = new Set<number>();
    for (const pass of passes) {
      for (const band of pass) {
        for (const bucket of band.values()) {
          if (bucket.length < 2) continue;
          if (bucket.length > cap) continue;
          for (let i = 0; i < bucket.length; i++) {
            const x = nonNull(bucket[i]);
            for (let j = i + 1; j < bucket.length; j++) {
              const y = nonNull(bucket[j]);
              const lo = x < y ? x : y;
              const hi = x < y ? y : x;
              const key = lo * stride + hi;
              if (seen.has(key)) continue;
              seen.add(key);
              visit(lo, hi);
            }
          }
        }
      }
    }
  }

  return {
    params,
    fragmentCount,
    signatureCount: fragmentCount * params.seedCount,
    forEachCandidatePair,
    stats,
  };
}

function insertIntoBands(
  sig: MinHashSignature,
  fragmentId: number,
  bands: Map<string, number[]>[],
  numBands: number,
  rows: number,
): void {
  const v = sig.values;
  for (let b = 0; b < numBands; b++) {
    const start = b * rows;
    // Build a band-bucket key from `rows` consecutive sig values. We hash
    // them into one u32 to keep the Map key space tight; collisions across
    // different row-tuples are filtered out by the re-scoring stage that
    // sees these as candidate pairs.
    let h = 0x811c9dc5 ^ b; // Per-band prefix so identical row-tuples in
    // different bands don't collide.
    for (let r = 0; r < rows; r++) {
      const x = nonNull(v[start + r]);
      // Mix each 32-bit slot in.
      h ^= x;
      h = Math.imul(h, 0x01000193);
      h ^= h >>> 16;
    }
    const key = (h >>> 0).toString(36);
    const band = nonNull(bands[b]);
    let bucket = band.get(key);
    if (bucket === undefined) {
      bucket = [];
      band.set(key, bucket);
    }
    bucket.push(fragmentId);
  }
}

/**
 * Sized iterables (Set, Map, Array) expose `.size` / `.length`. Probe both
 * without materialising the iterator.
 */
function sizeOf(features: Iterable<string>): number {
  if (Array.isArray(features)) return features.length;
  const maybeSet = features as { size?: unknown };
  if (typeof maybeSet.size === "number") return maybeSet.size;
  let n = 0;
  for (const _ of features) n += 1;
  return n;
}

function mixSeed(base: number, pass: number): number {
  // Distinct hash family per pass.
  let z = (base ^ (pass + 0x9e3779b9)) >>> 0;
  z = Math.imul(z ^ (z >>> 16), 0x85ebca6b) >>> 0;
  z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35) >>> 0;
  return (z ^ (z >>> 16)) >>> 0;
}
