export type FragmentKind = "function" | "block" | "window";

export interface Fragment {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  kind: FragmentKind;
  text: string;
  astNodeKind: string;
}

/**
 * Inclusive line count of a fragment. The extractor guarantees
 * `endLine >= startLine`, so the result is always >= 1 for emitted
 * fragments — callers that pass `Fragment` literals in tests must respect
 * the same invariant or add their own defensive floor.
 */
export function fragmentLineCount(f: Fragment): number {
  return f.endLine - f.startLine + 1;
}
