import type { Node } from "ts-morph";
import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeNode,
} from "../types.ts";
import { walkBodyExcludingNestedFunctions } from "../walk.ts";
import {
  getFunctionBody,
  TS_EXPECT_ERROR_RE,
  TS_IGNORE_RE,
  TS_NOCHECK_RE,
} from "./shared.ts";

export interface TsSuppressionsResult {
  tsIgnoreCount: number;
  tsExpectErrorCount: number;
  tsNocheckCount: number;
}

export function computeTsSuppressions(
  node: FunctionLikeNode,
): TsSuppressionsResult {
  const body = getFunctionBody(node);
  if (!body) {
    return { tsIgnoreCount: 0, tsExpectErrorCount: 0, tsNocheckCount: 0 };
  }

  const sourceFile = body.getSourceFile();
  const fullText = sourceFile.getFullText();
  const bodyStart = body.getFullStart();
  const bodyEnd = body.getEnd();
  const seen = new Set<number>();

  let tsIgnoreCount = 0;
  let tsExpectErrorCount = 0;
  let tsNocheckCount = 0;

  const tally = (text: string): void => {
    if (TS_IGNORE_RE.test(text)) tsIgnoreCount += 1;
    if (TS_EXPECT_ERROR_RE.test(text)) tsExpectErrorCount += 1;
    if (TS_NOCHECK_RE.test(text)) tsNocheckCount += 1;
  };

  const collectRanges = (n: Node): void => {
    for (const range of n.getLeadingCommentRanges()) {
      const pos = range.getPos();
      if (pos < bodyStart || pos >= bodyEnd) continue;
      if (seen.has(pos)) continue;
      seen.add(pos);
      tally(fullText.slice(pos, range.getEnd()));
    }
    for (const range of n.getTrailingCommentRanges()) {
      const pos = range.getPos();
      if (pos < bodyStart || pos >= bodyEnd) continue;
      if (seen.has(pos)) continue;
      seen.add(pos);
      tally(fullText.slice(pos, range.getEnd()));
    }
  };

  walkBodyExcludingNestedFunctions(body, collectRanges);

  return { tsIgnoreCount, tsExpectErrorCount, tsNocheckCount };
}

export const tsSuppressionsCollector: Collector<TsSuppressionsResult> = {
  name: "tsSuppressions",
  collect(ctx: CollectorContext): Map<DeclarationId, TsSuppressionsResult> {
    const result = new Map<DeclarationId, TsSuppressionsResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, computeTsSuppressions(decl.node));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `tsSuppressionsCollector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
          { cause: err },
        );
      }
    }
    return result;
  },
};
