import type { Config } from "../config/index.ts";
import type {
  Candidate,
  FeatureKey,
  Fragment,
  FragmentFeatures,
  InvertedIndex,
} from "../domain/index.ts";
import { isSameFileOverlap } from "./sameFileOverlap.ts";

interface HitCounts {
  token: number;
  statement: number;
  call: number;
}

interface AxisOptions {
  /**
   * Per-axis document-frequency cap. A posting list is skipped when
   * `size / totalFragments` exceeds this fraction. `undefined` disables
   * the cap (full posting walk).
   */
  maxDocumentFrequency: number | undefined;
}

/**
 * Per-query telemetry. Populated only when the caller passes a `stats`
 * object. Used by the `--phase-timings` perf logger to derive the cap
 * saturation ratio and the pre-cap candidate distribution; the search
 * pipeline never reads it back.
 */
export interface SearchStats {
  /** Unique query keys per axis after dedup. */
  uniqueKeys: { token: number; statement: number; call: number };
  /** Total postings touched across all 3 axes (including same-fragment hits). */
  postingsHit: number;
  /** Candidate count before truncation at `maxCandidatesPerFragment`. */
  preCapCandidates: number;
  /** `true` iff `preCapCandidates` exceeded the cap. */
  truncatedAtCap: boolean;
}

/**
 * Search base-side candidates for a single changed fragment.
 *
 * Queries the index with the changed fragment's 3 feature streams (token /
 * statement / call) and unions the results. `hitCounts` counts the number of
 * *unique* changed-side feature keys that also appear in the index per kind.
 *
 * Self-matches (same `fragmentId`) are excluded. Results are sorted
 * deterministically and truncated to `config.search.maxCandidatesPerFragment`.
 *
 * If `stats` is provided, the function fills it with per-query telemetry
 * (unique keys per axis, postings touched, pre-cap candidate count). Pass
 * `undefined` to skip the bookkeeping.
 */
export function searchCandidates(
  changedFragment: Fragment,
  changedFeatures: FragmentFeatures,
  index: InvertedIndex,
  config: Config,
  stats?: SearchStats,
): Candidate[] {
  const uniqueTokens = uniqueKeys(changedFeatures.tokens);
  const uniqueStatements = uniqueKeys(changedFeatures.statements);
  const uniqueCalls = uniqueKeys(changedFeatures.calls);

  if (stats !== undefined) {
    stats.uniqueKeys = {
      token: uniqueTokens.length,
      statement: uniqueStatements.length,
      call: uniqueCalls.length,
    };
    stats.postingsHit = 0;
    stats.preCapCandidates = 0;
    stats.truncatedAtCap = false;
  }

  if (
    uniqueTokens.length === 0 &&
    uniqueStatements.length === 0 &&
    uniqueCalls.length === 0
  ) {
    return [];
  }

  const hits = new Map<string, HitCounts>();

  // Token n-grams are dominated by structural noise keys (e.g. `ID DOT ID`)
  // that appear in a large fraction of every fragment. Skipping postings
  // whose document frequency exceeds the configured cap avoids walking
  // those long lists on every query without affecting recall on the
  // fixture suite. Statement / call axes are left uncapped: their
  // posting-size distribution is much flatter and individual keys
  // typically carry more signal.
  const tokenOpts: AxisOptions = {
    maxDocumentFrequency: pickDfCap(config.search.maxTokenDocumentFrequency),
  };
  const noCap: AxisOptions = { maxDocumentFrequency: undefined };

  const changed: ChangedRange = {
    id: changedFragment.id,
    filePath: changedFragment.filePath,
    startLine: changedFragment.startLine,
    endLine: changedFragment.endLine,
  };

  tally(hits, index, uniqueTokens, changed, "token", tokenOpts, stats);
  tally(hits, index, uniqueStatements, changed, "statement", noCap, stats);
  tally(hits, index, uniqueCalls, changed, "call", noCap, stats);

  if (hits.size === 0) {
    return [];
  }

  const max = config.search.maxCandidatesPerFragment;
  const preCapSize = hits.size;
  if (stats !== undefined) {
    stats.preCapCandidates = preCapSize;
    stats.truncatedAtCap = preCapSize > max;
  }

  // When the result fits within the cap, sort the whole list. Otherwise use
  // a top-K min-heap so we pay O(N log K) per query instead of O(N log N) —
  // 56% of fragments in the self-scan blow past the cap, so the heap path
  // is hot.
  if (preCapSize <= max) {
    const candidates: Candidate[] = [];
    for (const [baseFragmentId, hitCounts] of hits) {
      candidates.push({
        changedFragmentId: changedFragment.id,
        baseFragmentId,
        hitCounts: { ...hitCounts },
      });
    }
    candidates.sort(compareCandidates);
    return candidates;
  }
  return topKByMinHeap(changedFragment.id, hits, max);
}

/**
 * Pick the top-`k` `(baseFragmentId, hitCounts)` entries by
 * `compareCandidates` order using a min-heap of size `k`.
 *
 * The heap stores the *current* lowest-ranked of the k best seen so far at
 * its root, so every new candidate that beats the root takes its place.
 * After all entries are consumed, drain the heap and reverse to get
 * descending-ranked output (matching the contract of the eager sort).
 */
function topKByMinHeap(
  changedFragmentId: string,
  hits: ReadonlyMap<string, HitCounts>,
  k: number,
): Candidate[] {
  const heap: Candidate[] = [];
  for (const [baseFragmentId, hitCounts] of hits) {
    if (heap.length < k) {
      heap.push({
        changedFragmentId,
        baseFragmentId,
        hitCounts: { ...hitCounts },
      });
      heapSiftUp(heap, heap.length - 1);
      continue;
    }
    const root = heap[0];
    if (root === undefined) continue;
    // Higher-ranked candidates have a *smaller* `compareCandidates` value
    // (descending sort). The min-heap orders by `compareCandidates`, so the
    // root is the *lowest-ranked* of the top-k. Replace it only when the
    // new entry outranks the root.
    const cmp = compareCandidatesEntry(baseFragmentId, hitCounts, root);
    if (cmp < 0) {
      heap[0] = {
        changedFragmentId,
        baseFragmentId,
        hitCounts: { ...hitCounts },
      };
      heapSiftDown(heap, 0);
    }
  }
  // Drain in ascending order, then reverse to descending (best-first).
  const out = new Array<Candidate>(heap.length);
  for (let i = heap.length - 1; i >= 0; i--) {
    out[i] = heapPop(heap);
  }
  return out;
}

/**
 * Compare a `(baseFragmentId, hitCounts)` against an existing Candidate.
 * `changedFragmentId` is omitted because it's identical across every
 * candidate in a single search call, so it never affects the order.
 */
function compareCandidatesEntry(
  baseFragmentId: string,
  hitCounts: HitCounts,
  other: Candidate,
): number {
  const sumA = hitCounts.token + hitCounts.statement + hitCounts.call;
  const sumB =
    other.hitCounts.token + other.hitCounts.statement + other.hitCounts.call;
  if (sumA !== sumB) return sumB - sumA;
  if (hitCounts.token !== other.hitCounts.token) {
    return other.hitCounts.token - hitCounts.token;
  }
  if (hitCounts.statement !== other.hitCounts.statement) {
    return other.hitCounts.statement - hitCounts.statement;
  }
  if (hitCounts.call !== other.hitCounts.call) {
    return other.hitCounts.call - hitCounts.call;
  }
  if (baseFragmentId < other.baseFragmentId) return -1;
  if (baseFragmentId > other.baseFragmentId) return 1;
  // changedFragmentId is identical for all entries by construction
  return 0;
}

function heapSiftUp(heap: Candidate[], i: number): void {
  while (i > 0) {
    const parent = (i - 1) >> 1;
    const a = heap[i];
    const b = heap[parent];
    if (a === undefined || b === undefined) break;
    // Min-heap on the *negated* candidate ordering: we want the lowest-ranked
    // (worst) candidate at the root, since that's the one we evict on insert.
    if (compareCandidates(a, b) <= 0) break;
    heap[i] = b;
    heap[parent] = a;
    i = parent;
  }
}

function heapSiftDown(heap: Candidate[], i: number): void {
  const n = heap.length;
  for (;;) {
    const l = 2 * i + 1;
    const r = 2 * i + 2;
    let smallest = i;
    const sCur = heap[smallest];
    const sL = l < n ? heap[l] : undefined;
    const sR = r < n ? heap[r] : undefined;
    if (
      sL !== undefined &&
      sCur !== undefined &&
      compareCandidates(sL, sCur) > 0
    ) {
      smallest = l;
    }
    const sNew = heap[smallest];
    if (
      sR !== undefined &&
      sNew !== undefined &&
      compareCandidates(sR, sNew) > 0
    ) {
      smallest = r;
    }
    if (smallest === i) break;
    const a = heap[i];
    const b = heap[smallest];
    if (a === undefined || b === undefined) break;
    heap[i] = b;
    heap[smallest] = a;
    i = smallest;
  }
}

function heapPop(heap: Candidate[]): Candidate {
  const top = heap[0];
  if (top === undefined) {
    throw new Error("heapPop on empty heap");
  }
  const last = heap.pop();
  if (heap.length > 0 && last !== undefined) {
    heap[0] = last;
    heapSiftDown(heap, 0);
  }
  return top;
}

function uniqueKeys(keys: readonly FeatureKey[]): FeatureKey[] {
  const set = new Set<FeatureKey>();
  const out: FeatureKey[] = [];
  for (const k of keys) {
    if (!set.has(k)) {
      set.add(k);
      out.push(k);
    }
  }
  return out;
}

/**
 * Minimum corpus size at which the DF cap kicks in. Below this, every
 * posting passes regardless of `maxDocumentFrequency` — on a tiny corpus
 * the document-frequency ratio is dominated by sample size, not by the
 * key being structural noise. (Unit tests routinely build 2-fragment
 * indices; without this guard, the 30% cap would empty every posting.)
 */
const MIN_CORPUS_FOR_DF_CAP = 100;

interface ChangedRange {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
}

function tally(
  hits: Map<string, HitCounts>,
  index: InvertedIndex,
  uniqueQueryKeys: readonly FeatureKey[],
  changed: ChangedRange,
  kind: keyof HitCounts,
  axis: AxisOptions,
  stats: SearchStats | undefined,
): void {
  // Pre-compute the absolute posting-size threshold so we do an integer
  // compare per key instead of a divide.
  const total = index.totalFragments;
  const maxPostingSize =
    axis.maxDocumentFrequency === undefined || total < MIN_CORPUS_FOR_DF_CAP
      ? Number.POSITIVE_INFINITY
      : axis.maxDocumentFrequency * total;
  for (const key of uniqueQueryKeys) {
    const postings = index.postings.get(key);
    if (postings === undefined) continue;
    if (postings.length > maxPostingSize) continue;
    if (stats !== undefined) stats.postingsHit += postings.length;
    for (const posting of postings) {
      if (posting.fragmentId === changed.id) continue;
      // Same-file fragments whose line ranges intersect are sliding-window
      // siblings of one another: their feature sets share the overlapping
      // region, so any "match" mostly reports the extractor's own
      // granularity rather than a real clone. Skip them at search time so
      // they never reach scoring or the report.
      if (isSameFileOverlap(posting, changed)) {
        continue;
      }
      let counts = hits.get(posting.fragmentId);
      if (counts === undefined) {
        counts = { token: 0, statement: 0, call: 0 };
        hits.set(posting.fragmentId, counts);
      }
      counts[kind]++;
    }
  }
}

/**
 * Normalise the configured DF cap. Values >= 1 disable the cap entirely;
 * negative or non-finite values fall back to "no cap".
 */
function pickDfCap(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  if (value >= 1) return undefined;
  return value;
}

function compareCandidates(a: Candidate, b: Candidate): number {
  const sumA = a.hitCounts.token + a.hitCounts.statement + a.hitCounts.call;
  const sumB = b.hitCounts.token + b.hitCounts.statement + b.hitCounts.call;
  if (sumA !== sumB) return sumB - sumA;
  if (a.hitCounts.token !== b.hitCounts.token) {
    return b.hitCounts.token - a.hitCounts.token;
  }
  if (a.hitCounts.statement !== b.hitCounts.statement) {
    return b.hitCounts.statement - a.hitCounts.statement;
  }
  if (a.hitCounts.call !== b.hitCounts.call) {
    return b.hitCounts.call - a.hitCounts.call;
  }
  if (a.baseFragmentId < b.baseFragmentId) return -1;
  if (a.baseFragmentId > b.baseFragmentId) return 1;
  return 0;
}
