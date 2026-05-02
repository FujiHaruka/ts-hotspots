/**
 * Cochange raw metrics. Pure function over the walker's output: turns
 * `(support, changesOf(A), changesOf(B), actualWindow)` into the four
 * conditional-probability-derived axes the report ranks against. No gating,
 * no sorting; that's a later milestone.
 */

import type { WalkCochangeResult } from "../walk/walkCochange.ts";
import { parsePairKey } from "../walk/walkCochange.ts";

export interface PairMetrics {
  support: number;
  confidenceAtoB: number;
  confidenceBtoA: number;
  confidenceMax: number;
  lift: number;
}

export function computeMetrics(
  walkResult: WalkCochangeResult,
): Map<string, PairMetrics> {
  const out = new Map<string, PairMetrics>();
  const { perFileChanges, pairs, actualWindow } = walkResult;

  for (const [key, evidence] of pairs) {
    const [a, b] = parsePairKey(key);
    const changesA = perFileChanges.get(a) ?? 0;
    const changesB = perFileChanges.get(b) ?? 0;
    if (changesA === 0 || changesB === 0) continue;

    const support = evidence.support;
    const confidenceAtoB = support / changesA;
    const confidenceBtoA = support / changesB;
    const confidenceMax =
      confidenceAtoB > confidenceBtoA ? confidenceAtoB : confidenceBtoA;
    const lift = (support * actualWindow) / (changesA * changesB);
    out.set(key, {
      support,
      confidenceAtoB,
      confidenceBtoA,
      confidenceMax,
      lift,
    });
  }
  return out;
}
