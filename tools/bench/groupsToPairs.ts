import type {
  CloneGroup,
  FragmentView,
} from "../../src/duplication/domain/index.ts";
import { parseLocation } from "../../src/duplication/util/location.ts";

/**
 * Bench-local view of a fragment. Mirrors the pre-M2 `FragmentView`
 * shape so bench tooling can keep matching against fixture
 * `(filePath, startLine, endLine)` triples without re-parsing the
 * `location` string at every call site.
 */
export interface PairFragment {
  filePath: string;
  startLine: number;
  endLine: number;
  kind: string;
  code?: string;
}

/**
 * Flat (anchor, member) view of a `CloneGroup`. Bench / eval tooling
 * predates the group output and reasons in pairs; this helper exposes the
 * same shape without baking the group structure into every call site.
 */
export interface ReportPair {
  left: PairFragment;
  right: PairFragment;
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

function expand(view: FragmentView): PairFragment {
  const { filePath, startLine, endLine } = parseLocation(view.location);
  const out: PairFragment = { filePath, startLine, endLine, kind: view.kind };
  if (view.code !== undefined) out.code = view.code;
  return out;
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
    const left = expand(g.anchor);
    for (const m of g.members) {
      out.push({
        left,
        right: expand(m.fragment),
        scores: m.scores,
        evidence: m.evidence,
      });
    }
  }
  return out;
}
