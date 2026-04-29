import type { Config } from "../config/config.ts";
import type { Evidence } from "../domain/report.ts";
import { stripPrefix } from "./internal/stripPrefix.ts";

export interface Intersections {
  tokens: string[];
  statements: string[];
  calls: string[];
}

/**
 * Turn per-axis intersection arrays into an `Evidence` record suitable for
 * a report candidate.
 *
 * - `calls` intersections are split: `CALL:` / `AWAIT_CALL:` / `NEW:` go
 *   into `sharedCalls`, `PROP:` goes into `sharedProperties`. Unknown
 *   payloads are ignored (defensive — `scoreCandidateDetailed` only emits
 *   the four shapes above).
 * - `statements` intersections land in `matchedStatementKinds` unchanged.
 * - `tokens` intersections are truncated to the first
 *   `config.report.tokenNgramSampleSize` keys; the array is already
 *   ascending-sorted, so the slice is deterministic.
 *
 * All keys are passed through `stripPrefix` so the exposed strings are
 * the bare payloads (e.g. `CALL:findById`, `IfStatement|ReturnStatement`).
 */
export function buildEvidence(
  intersections: Intersections,
  config: Config,
): Evidence {
  const sharedCalls: string[] = [];
  const sharedProperties: string[] = [];
  for (const rawKey of intersections.calls) {
    const key = stripPrefix(rawKey);
    if (
      key.startsWith("CALL:") ||
      key.startsWith("AWAIT_CALL:") ||
      key.startsWith("NEW:")
    ) {
      sharedCalls.push(key);
      continue;
    }
    if (key.startsWith("PROP:")) {
      sharedProperties.push(key);
    }
  }

  const matchedStatementKinds = intersections.statements.map(stripPrefix);

  const sampleSize = Math.max(0, config.report.tokenNgramSampleSize);
  const matchedTokenNgramsSample = intersections.tokens
    .slice(0, sampleSize)
    .map(stripPrefix);

  return {
    sharedCalls,
    sharedProperties,
    matchedStatementKinds,
    matchedTokenNgramsSample,
  };
}
