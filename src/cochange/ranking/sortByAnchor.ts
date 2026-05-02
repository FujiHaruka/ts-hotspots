/**
 * Single-anchor candidate ordering used by `--file <path>` mode.
 *
 * The default `sortCandidates` ranks by `support * confidenceMax` — that key
 * conflates both directions of the conditional probability, which is the right
 * choice when neither side is fixed. In single-anchor mode the anchor is
 * pinned, so the agent's question is one-directional ("if I touch the anchor,
 * which partner is most likely to need attention?"). The sort key flips to the
 * directional `confidence(anchor -> partner)`:
 *   1. confidenceAtoB / confidenceBtoA (depending on anchor side) desc
 *   2. support desc
 *   3. lift desc
 *   4. lex partner asc
 *
 * Each candidate must already carry `anchor` set to the pinned path, and that
 * path must equal `pathA` or `pathB`. `limit === Number.POSITIVE_INFINITY`
 * opts out of truncation, matching how `sortCandidates` handles `--limit all`.
 */

import type { Candidate } from "./types.ts";

export interface SortByAnchorOptions {
  limit?: number;
}

export function sortCandidatesByAnchor(
  candidates: readonly Candidate[],
  options: SortByAnchorOptions = {},
): Candidate[] {
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const sorted = [...candidates].sort(compareByAnchor);
  if (limit === Number.POSITIVE_INFINITY) return sorted;
  if (limit <= 0) return [];
  return sorted.slice(0, limit);
}

function directionalConfidence(c: Candidate): number {
  if (c.anchor === c.pathA) return c.metrics.confidenceAtoB;
  if (c.anchor === c.pathB) return c.metrics.confidenceBtoA;
  return 0;
}

function partnerPath(c: Candidate): string {
  return c.anchor === c.pathA ? c.pathB : c.pathA;
}

function compareByAnchor(a: Candidate, b: Candidate): number {
  const aConf = directionalConfidence(a);
  const bConf = directionalConfidence(b);
  if (aConf !== bConf) return bConf - aConf;

  if (a.metrics.support !== b.metrics.support) {
    return b.metrics.support - a.metrics.support;
  }

  if (a.metrics.lift !== b.metrics.lift) return b.metrics.lift - a.metrics.lift;

  const aPartner = partnerPath(a);
  const bPartner = partnerPath(b);
  if (aPartner !== bPartner) return aPartner < bPartner ? -1 : 1;
  return 0;
}
