import { parentPort, workerData } from "node:worker_threads";
import { parseSource } from "../../parser/parseSource.ts";
import type { Config } from "../config/config.ts";
import type { FragmentFeatures } from "../domain/feature.ts";
import type { Fragment } from "../domain/fragment.ts";
import { extractFeatures } from "../features/extractFeatures.ts";
import { buildFileFeatureContext } from "../features/fileContext.ts";
import { isThinWrapperFragment } from "../features/internal/isThinWrapper.ts";
import { extractFragments } from "./extractFragments.ts";

/**
 * Per-file unit of work dispatched from `buildBaseIndex` to a worker
 * thread (or executed in-process on the serial fallback). The job ID is
 * assigned by the dispatcher so completed work can be re-ordered into
 * the deterministic source listing order.
 */
export interface BaseIndexWorkerJob {
  jobIndex: number;
  path: string;
  text: string;
}

/**
 * Per-worker initialization payload. Sent **once** via `workerData` at
 * worker creation, not per-job — Config is structured-cloned and the
 * cost grows linearly with the field count, so amortising it across all
 * jobs that worker will see is meaningfully cheaper than re-cloning per
 * file dispatch.
 */
export interface BaseIndexWorkerInit {
  config: Config;
  thinWrapperEnabled: boolean;
}

/**
 * Per-file output. Plain serializable shape so structuredClone can
 * round-trip it through `postMessage`. `Fragment` and
 * `FragmentFeatures` are already serialisable; `thinWrapperByFragmentId`
 * is a `Map<string, boolean>` (also clonable).
 */
export interface BaseIndexWorkerResult {
  jobIndex: number;
  path: string;
  fragments: Fragment[];
  features: FragmentFeatures[];
  thinWrapperByFragmentId: Map<string, boolean>;
}

/**
 * Pure per-file work. Exposed so the dispatcher can call it directly on
 * the serial fallback path, keeping the parallel and serial code paths
 * literally the same function on each file.
 */
export function processBaseIndexJob(
  job: BaseIndexWorkerJob,
  init: BaseIndexWorkerInit,
): BaseIndexWorkerResult {
  const parsed = parseSource(job.path, job.text);
  const fragments = extractFragments(parsed, init.config);
  // Build per-file context once and share across every fragment of this
  // file — `extractFeatures` would otherwise re-walk the AST for type /
  // regex ranges per fragment.
  const fileCtx = buildFileFeatureContext(parsed.sourceFile);
  const features: FragmentFeatures[] = [];
  for (const fragment of fragments) {
    features.push(
      extractFeatures(fragment, parsed.sourceFile, init.config, fileCtx),
    );
  }
  const thinWrapperByFragmentId = new Map<string, boolean>();
  if (init.thinWrapperEnabled) {
    const thinCfg = init.config.report.thinWrapper;
    for (const fragment of fragments) {
      thinWrapperByFragmentId.set(
        fragment.id,
        isThinWrapperFragment(fragment, parsed.sourceFile, thinCfg),
      );
    }
  }
  return {
    jobIndex: job.jobIndex,
    path: job.path,
    fragments,
    features,
    thinWrapperByFragmentId,
  };
}

// Worker entrypoint: when this module is loaded inside a `Worker`, the
// dispatcher hands the init payload via `workerData` and posts each job
// over the message channel. The branch is `parentPort !== null` only
// inside a worker thread, so `import`ing this file from main is a
// no-op aside from re-exporting `processBaseIndexJob`.
if (parentPort !== null) {
  const init = workerData as BaseIndexWorkerInit;
  parentPort.on("message", (job: BaseIndexWorkerJob) => {
    // oxlint-disable-next-line unicorn/require-post-message-target-origin -- node:worker_threads channel, not the Window postMessage signature
    parentPort?.postMessage(processBaseIndexJob(job, init));
  });
}
