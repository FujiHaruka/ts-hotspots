import { availableParallelism } from "node:os";
import { Worker } from "node:worker_threads";
import type { Config } from "../config/index.ts";
import type { FragmentFeatures } from "../domain/feature.ts";
import type { Fragment } from "../domain/fragment.ts";
import {
  buildFeatureSets,
  type FragmentFeatureSets,
} from "../scoring/index.ts";
import { nonNull } from "../util/nonNull.ts";
import {
  type BaseIndexWorkerInit,
  type BaseIndexWorkerJob,
  type BaseIndexWorkerResult,
  processBaseIndexJob,
} from "./baseIndexWorker.ts";

/**
 * One source file fed into the base index. Same shape as
 * `BaseSource` from `cli/listBaseSources.ts`, kept structural here to
 * avoid the indexer module depending on the cli module.
 */
export interface BaseIndexSource {
  path: string;
  text: string;
}

/**
 * The per-fragment data the runner needs from the base index. `entries`
 * preserves the source order (i.e. lex-sorted by path, then per-file
 * extractor order) so downstream determinism is unchanged from the
 * legacy serial loop.
 */
interface BaseIndexResult {
  /** `(fragment, features)` pairs, one entry per fragment, in source order. */
  entries: { fragment: Fragment; features: FragmentFeatures }[];
  /** `fragment.id → FragmentFeatureSets` (Set views built once for scoring). */
  featureSetsById: Map<string, FragmentFeatureSets>;
  /**
   * `fragment.id → isThinWrapper(fragment)` when `thinWrapperEnabled` is
   * true; empty otherwise. Precomputed in the worker so the report stage
   * doesn't re-parse source files just to judge thin wrappers.
   */
  thinWrapperByFragmentId: Map<string, boolean>;
  /** Distribution stats for `fragments.stats` perfLog event. */
  fragmentsByKind: { function: number; block: number; window: number };
  /** Per-file fragment count, source order. */
  fragmentsPerFile: number[];
}

interface BuildBaseIndexOptions {
  /**
   * When true, the worker also runs `isThinWrapperFragment` for every
   * fragment and returns the result. The runner passes the resulting
   * map to `buildJsonReport` instead of a `getSourceFile` hook, so the
   * main thread never needs to re-parse a file just for the thin-wrapper
   * filter.
   */
  thinWrapperEnabled: boolean;
  /**
   * Maximum worker thread count. `0` or `1` forces the in-process
   * serial path. When omitted the dispatcher uses
   * `os.availableParallelism()`.
   */
  workers?: number;
  /**
   * File-count threshold below which the parallel path adds more
   * overhead (worker spawn ~50-100ms each) than it saves. Below the
   * threshold the dispatcher falls back to the serial path. Defaults
   * to a conservative floor.
   */
  parallelMinFiles?: number;
}

const DEFAULT_PARALLEL_MIN_FILES = 32;
/**
 * Each worker pays a one-time TS module load cost (~200ms in current
 * Node 24 + strip-only mode). At 4 cores the OS schedules them onto
 * the same physical cores as the main thread + listBase / churn git
 * processes, so the marginal speedup peaks at 2-3 concurrent workers
 * on this kind of host. Larger machines benefit from more — but the
 * cap is here to keep the worst case (over-provisioned worker pool +
 * CPU contention) bounded. Override with `workers` when measuring.
 */
const DEFAULT_MAX_WORKERS = 3;

/**
 * Build the per-fragment base index from a list of sources.
 *
 * Drives the per-file work (`parseSource` + `extractFragments` +
 * `buildFileFeatureContext` + `extractFeatures` per fragment +
 * `isThinWrapperFragment` per fragment when enabled) across either
 * `worker_threads` (default) or the calling thread. The two paths
 * share `processBaseIndexJob` as the per-file kernel, so behaviour is
 * identical aside from concurrency.
 *
 * Output is deterministic: results are reassembled in `jobIndex` order
 * (the source listing order), fragments inside each file follow the
 * extractor's natural order, and `Set` constructors preserve insertion
 * order. For an unchanged input list the resulting `entries[]`,
 * `featureSetsById`, and `thinWrapperByFragmentId` are bit-identical
 * to the legacy serial loop.
 */
export async function buildBaseIndex(
  sources: readonly BaseIndexSource[],
  config: Config,
  opts: BuildBaseIndexOptions,
): Promise<BaseIndexResult> {
  const minFiles = opts.parallelMinFiles ?? DEFAULT_PARALLEL_MIN_FILES;
  const cpuCount = Math.max(1, availableParallelism());
  const requested =
    opts.workers === undefined
      ? Math.min(cpuCount, DEFAULT_MAX_WORKERS)
      : Math.max(0, opts.workers);
  // Cap at sources.length so we never over-spawn empty workers.
  const workerCount = Math.max(1, Math.min(requested, sources.length));
  const init: BaseIndexWorkerInit = {
    config,
    thinWrapperEnabled: opts.thinWrapperEnabled,
  };
  if (workerCount === 1 || sources.length < minFiles) {
    return aggregate(runSerial(sources, init), sources.length);
  }
  const partials = await runParallel(sources, init, workerCount);
  return aggregate(partials, sources.length);
}

function runSerial(
  sources: readonly BaseIndexSource[],
  init: BaseIndexWorkerInit,
): BaseIndexWorkerResult[] {
  const out: BaseIndexWorkerResult[] = [];
  for (let i = 0; i < sources.length; i++) {
    const src = sources[i];
    if (src === undefined) continue;
    out.push(
      processBaseIndexJob(
        { jobIndex: i, path: src.path, text: src.text },
        init,
      ),
    );
  }
  return out;
}

async function runParallel(
  sources: readonly BaseIndexSource[],
  init: BaseIndexWorkerInit,
  workerCount: number,
): Promise<BaseIndexWorkerResult[]> {
  const workerUrl = new URL("./baseIndexWorker.ts", import.meta.url);
  const partials: (BaseIndexWorkerResult | undefined)[] = Array.from({
    length: sources.length,
  });
  await new Promise<void>((resolve, reject) => {
    let nextJob = 0;
    let completed = 0;
    let aborted = false;
    const workers: Worker[] = [];

    const finish = (err?: Error): void => {
      if (aborted) return;
      aborted = true;
      for (const w of workers) {
        // `terminate` is async-fire-and-forget; we don't await it
        // because the Promise has already settled.
        void w.terminate();
      }
      if (err === undefined) resolve();
      else reject(err);
    };

    const dispatch = (worker: Worker): void => {
      if (aborted) return;
      if (nextJob >= sources.length) return;
      const idx = nextJob++;
      const src = sources[idx];
      if (src === undefined) {
        // Defensive: hole in the input array. Treat as completed.
        completed += 1;
        if (completed === sources.length) finish();
        else dispatch(worker);
        return;
      }
      const job: BaseIndexWorkerJob = {
        jobIndex: idx,
        path: src.path,
        text: src.text,
      };
      // oxlint-disable-next-line unicorn/require-post-message-target-origin -- node:worker_threads channel, not the Window postMessage signature
      worker.postMessage(job);
    };

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(workerUrl, { workerData: init });
      workers.push(worker);
      worker.on("message", (msg: BaseIndexWorkerResult) => {
        partials[msg.jobIndex] = msg;
        completed += 1;
        if (completed === sources.length) finish();
        else dispatch(worker);
      });
      worker.on("error", (err) => {
        finish(err instanceof Error ? err : new Error(String(err)));
      });
      worker.on("exit", (code) => {
        if (!aborted && code !== 0) {
          finish(
            new Error(`baseIndex worker exited with code ${String(code)}`),
          );
        }
      });
    }
    // Prime each worker with an initial job.
    for (const w of workers) dispatch(w);
  });
  // Drop holes (any undefined slots from defensive paths) without
  // disturbing relative order.
  const out: BaseIndexWorkerResult[] = [];
  for (const p of partials) {
    if (p !== undefined) out.push(p);
  }
  return out;
}

function aggregate(
  partials: readonly BaseIndexWorkerResult[],
  expected: number,
): BaseIndexResult {
  const result: BaseIndexResult = {
    entries: [],
    featureSetsById: new Map(),
    thinWrapperByFragmentId: new Map(),
    fragmentsByKind: { function: 0, block: 0, window: 0 },
    fragmentsPerFile: [],
  };
  // Sort by jobIndex defensively; runSerial already returns in order
  // and runParallel uses jobIndex slots, but if the partials array got
  // compacted we want an explicit reordering invariant here.
  const sorted = [...partials].sort((a, b) => a.jobIndex - b.jobIndex);
  for (const p of sorted) {
    result.fragmentsPerFile.push(p.fragments.length);
    for (let i = 0; i < p.fragments.length; i++) {
      const fragment = nonNull(p.fragments[i]);
      const features = nonNull(p.features[i]);
      result.fragmentsByKind[fragment.kind] += 1;
      result.entries.push({ fragment, features });
      result.featureSetsById.set(fragment.id, buildFeatureSets(features));
    }
    for (const [k, v] of p.thinWrapperByFragmentId) {
      result.thinWrapperByFragmentId.set(k, v);
    }
  }
  // Defensive: align fragmentsPerFile length with the source listing.
  // When workers complete out of order but the partials array is dense
  // this is a no-op; if a hole appeared we'd otherwise under-count.
  while (result.fragmentsPerFile.length < expected) {
    result.fragmentsPerFile.push(0);
  }
  return result;
}
