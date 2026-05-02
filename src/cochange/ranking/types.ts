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
  /**
   * Single-anchor mode (`--file <path>`) sets this to the anchor's path.
   * `pathA`/`pathB` keep their lex-canonical order so dismissalIds remain
   * stable; the serializer reads `anchor` to decide which side becomes the
   * `anchor.ref` slot in the output schema. Omitted in whole-repo / `--diff`.
   */
  anchor?: string;
}
