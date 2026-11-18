import type { HunkSpan } from "../domain/diff.ts";

interface LineRange {
  startLine: number;
  endLine: number;
}

export function headRangeToBase(
  spans: readonly HunkSpan[],
  range: LineRange,
): LineRange {
  return {
    startLine: Math.max(1, headLineToBase(spans, range.startLine).startLine),
    endLine: headLineToBase(spans, range.endLine).endLine,
  };
}

function headLineToBase(spans: readonly HunkSpan[], line: number): LineRange {
  let delta = 0;
  for (const span of spans) {
    const headFirst = span.headCount > 0 ? span.headStart : span.headStart + 1;
    if (line < headFirst) break;
    const headNext = span.headStart + Math.max(span.headCount, 1);
    if (span.headCount > 0 && line < headNext) {
      return span.baseCount > 0
        ? {
            startLine: span.baseStart,
            endLine: span.baseStart + span.baseCount - 1,
          }
        : { startLine: span.baseStart + 1, endLine: span.baseStart };
    }
    const baseNext = span.baseStart + Math.max(span.baseCount, 1);
    delta = baseNext - headNext;
  }
  return { startLine: line + delta, endLine: line + delta };
}
