/**
 * Build the per-edge weight hook from a list of `DownweightRule`s.
 *
 * Semantics: for each edge, every rule whose glob matches *either* the
 * source file or the target file contributes its `factor` as a
 * multiplicand. If no rule matches, the base weight passes through
 * unchanged.
 *
 * Either-endpoint matching reflects the architectural intent: a
 * downweighted glob (e.g. `src/legacy/**`) should reduce *every*
 * coupling that touches that area, regardless of direction. Source-
 * only or target-only matching would leave half the coupling intact,
 * which is rarely what users mean.
 *
 * Composition is multiplicative — two `0.5` rules both matching the
 * same edge yield `0.25`, not `0`. Factors of `0` short-circuit the
 * edge in the adjacency layer.
 */

import { matchesAnyGlob } from "../../duplication/diff/internal/globMatch.ts";
import type { Edge } from "../graph/types.ts";
import type { DownweightRule } from "./types.ts";

export type EdgeWeightHook = (params: {
  readonly fromFile: string;
  readonly toFile: string;
  readonly baseWeight: number;
  readonly kind: Edge["kind"];
}) => number;

export function buildEdgeWeightHook(
  rules: readonly DownweightRule[],
): EdgeWeightHook | undefined {
  if (rules.length === 0) return undefined;
  return ({ fromFile, toFile, baseWeight }) => {
    let multiplier = 1;
    for (const rule of rules) {
      const fromMatch = matchesAnyGlob(fromFile, [rule.glob]);
      const toMatch = matchesAnyGlob(toFile, [rule.glob]);
      if (fromMatch || toMatch) multiplier *= rule.factor;
      if (multiplier === 0) break;
    }
    return baseWeight * multiplier;
  };
}
