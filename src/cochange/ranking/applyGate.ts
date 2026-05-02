/**
 * Cochange candidate gate. Filters the per-pair metric map down to pairs that
 * clear all three thresholds (support, lift, confidenceMax). Pure function:
 * no I/O, no global state. Defaults live in `./defaults.ts`.
 */

import type { PairMetrics } from "../metrics/computeMetrics.ts";
import type { PairEvidence } from "../walk/walkCochange.ts";
import { parsePairKey } from "../walk/walkCochange.ts";
import {
  DEFAULT_CONFIDENCE_MAX_FLOOR,
  DEFAULT_MIN_SUPPORT,
  LIFT_FLOOR,
} from "./defaults.ts";
import type { Candidate } from "./types.ts";

export interface ApplyGateOptions {
  minSupport?: number;
  confidenceMaxFloor?: number;
  liftFloor?: number;
}

export function applyGate(
  metrics: ReadonlyMap<string, PairMetrics>,
  pairs: ReadonlyMap<string, PairEvidence>,
  options: ApplyGateOptions = {},
): Candidate[] {
  const minSupport = options.minSupport ?? DEFAULT_MIN_SUPPORT;
  const confidenceMaxFloor =
    options.confidenceMaxFloor ?? DEFAULT_CONFIDENCE_MAX_FLOOR;
  const liftFloor = options.liftFloor ?? LIFT_FLOOR;

  const out: Candidate[] = [];
  for (const [pairKey, m] of metrics) {
    if (m.support < minSupport) continue;
    if (m.lift <= liftFloor) continue;
    if (m.confidenceMax < confidenceMaxFloor) continue;

    const [pathA, pathB] = parsePairKey(pairKey);
    const evidence = pairs.get(pairKey);
    out.push({
      pairKey,
      pathA,
      pathB,
      metrics: m,
      recent: evidence ? [...evidence.recent] : [],
    });
  }
  return out;
}
