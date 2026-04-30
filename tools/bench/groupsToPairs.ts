import type { CloneGroup, FragmentView } from "../../src/dedup/domain/index.ts";

/**
 * Flat (anchor, member) view of a `CloneGroup`. Bench / eval tooling
 * predates the group output and reasons in pairs; this helper exposes the
 * same shape without baking the group structure into every call site.
 */
export interface ReportPair {
  left: FragmentView;
  right: FragmentView;
  scores: {
    combined: number;
    tokenOverlap: number;
    statementKindSimilarity: number;
    callOverlap: number;
    sizeCompatibility: number;
    lengthScore: number;
  };
  evidence: {
    sharedCalls: string[];
    sharedProperties: string[];
    matchedStatementKinds: string[];
    matchedTokenNgramsSample: string[];
  };
}

/**
 * Flatten a list of clone groups into one entry per (anchor, member)
 * edge. Groups whose `anchor` is undefined (whole-repo Step 2) are
 * skipped — bench tooling assumes a directed (changed → existing) shape.
 */
export function groupsToPairs(groups: readonly CloneGroup[]): ReportPair[] {
  const out: ReportPair[] = [];
  for (const g of groups) {
    if (g.anchor === undefined) continue;
    for (const m of g.members) {
      out.push({
        left: g.anchor,
        right: m.fragment,
        scores: m.scores,
        evidence: m.evidence,
      });
    }
  }
  return out;
}
