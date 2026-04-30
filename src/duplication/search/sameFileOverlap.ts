interface FragmentRange {
  filePath: string;
  startLine: number;
  endLine: number;
}

/**
 * True when two fragments live in the same file and their inclusive line
 * ranges intersect (touching counts as intersecting).
 *
 * Matches the search-time skip introduced in `a996536`: same-file
 * sliding-window siblings share the overlapping region's feature set, so
 * any "match" between them mostly reports the extractor's granularity
 * rather than a real clone. Both the inverted-index path
 * (`candidateSearch.ts#tally`) and the LSH path
 * (`runLshCandidateGeneration`) drop such pairs at search time.
 */
export function isSameFileOverlap(a: FragmentRange, b: FragmentRange): boolean {
  return (
    a.filePath === b.filePath &&
    a.endLine >= b.startLine &&
    b.endLine >= a.startLine
  );
}
