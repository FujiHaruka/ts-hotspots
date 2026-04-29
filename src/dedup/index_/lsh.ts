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
 * Determinism: fragmentIds are inserted into per-band buckets in input
 * order, and `forEachCandidatePair` iterates buckets in insertion order,
 * so the emitted pair stream is bit-identical across runs given fixed
 * `(numHashes, bands, rows, seedCount, seed)`.
 */

export interface LshIndexInput {
  fragmentId: string;
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
}

export interface LshIndex {
  readonly params: LshParams;
  readonly fragmentCount: number;
  readonly signatureCount: number;
  /**
   * Emit each unique candidate pair exactly once. Pairs are dedup'd
   * across bands and across seedCount passes via a `Set<string>` keyed by
   * `${aId}|${bId}` (lex-smaller first).
   */
  forEachCandidatePair(visit: (a: string, b: string) => void): void;
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

  // For each pass, build (bands × buckets) where each bucket is the list of
  // fragmentIds whose signature shares the same `rows`-tuple in that band.
  // Bucket key = fnv1a32 of the row values, packed as u32 → string. We use
  // a cheap string key so a single Map suffices. Hash collisions across
  // distinct row-tuples are filtered out by the downstream re-scoring stage.
  type Pass = Map<string, string[]>[];
  const passes: Pass[] = [];

  let bucketCollisionPairs = 0;
  let totalBuckets = 0;
  let maxBucketSize = 0;
  let nonTrivialBuckets = 0;
  let droppedBuckets = 0;
  const cap =
    params.maxBucketSize > 0 ? params.maxBucketSize : Number.POSITIVE_INFINITY;

  for (let pass = 0; pass < params.seedCount; pass++) {
    const hasher = createMinHasher(
      params.numHashes,
      mixSeed(params.seed, pass),
    );
    const bands: Map<string, string[]>[] = [];
    for (let b = 0; b < params.bands; b++) {
      bands.push(new Map<string, string[]>());
    }

    for (const input of inputs) {
      // Empty / near-empty token sets produce signatures dominated by the
      // sentinel `UINT32_MAX`, which collide for every band and pollute
      // every bucket. Skip them entirely — they're not useful LSH input,
      // and the legacy inverted-index path also implicitly drops them
      // (no postings → never a candidate).
      const featCount = sizeOf(input.features);
      if (featCount === 0) continue;
      const sig = hasher.sign(input.features);
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

  function forEachCandidatePair(visit: (a: string, b: string) => void): void {
    const seen = new Set<string>();
    for (const pass of passes) {
      for (const band of pass) {
        for (const bucket of band.values()) {
          if (bucket.length < 2) continue;
          if (bucket.length > cap) continue;
          for (let i = 0; i < bucket.length; i++) {
            const x = nonNull(bucket[i]);
            for (let j = i + 1; j < bucket.length; j++) {
              const y = nonNull(bucket[j]);
              const a = x < y ? x : y;
              const b = x < y ? y : x;
              const key = `${a}|${b}`;
              if (seen.has(key)) continue;
              seen.add(key);
              visit(a, b);
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
  fragmentId: string,
  bands: Map<string, string[]>[],
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
