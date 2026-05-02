/**
 * Internal candidate type carrying the full per-pair payload between the gate
 * and the (future) report layer. Not a public schema; M4 derives the
 * agent-facing shape from this.
 */

import type { PairMetrics } from "../metrics/computeMetrics.ts";

export interface Candidate {
  pairKey: string;
  pathA: string;
  pathB: string;
  metrics: PairMetrics;
  recent: string[];
}
