import { parseSource } from "../../parser/parseSource.ts";
import type { Config } from "../config/config.ts";
import type { ChangedFile, ChangedHunk } from "../domain/diff.ts";
import type { Fragment } from "../domain/fragment.ts";
import { extractFragments } from "../indexer/extractFragments.ts";

/**
 * Given the head-side text of a changed file and its hunks, return every
 * fragment (function / block / window) whose line range intersects at least
 * one hunk. No additional "smallest-enclosing" filtering — recall first.
 *
 * Fragments are returned in the order produced by M1's `extractFragments`,
 * which is deterministic.
 */
export function extractChangedFragments(
  file: ChangedFile,
  config: Config,
): Fragment[] {
  if (file.hunks.length === 0) {
    return [];
  }
  const parsed = parseSource(file.filePath, file.text);
  const all = extractFragments(parsed, config);
  return all.filter((fragment) => intersectsAnyHunk(fragment, file.hunks));
}

export function changedLineShare(
  fragment: Fragment,
  hunks: readonly ChangedHunk[],
): number {
  let changed = 0;
  for (const h of hunks) {
    const lo = Math.max(h.startLine, fragment.startLine);
    const hi = Math.min(h.endLine, fragment.endLine);
    if (hi >= lo) changed += hi - lo + 1;
  }
  return Math.min(1, changed / (fragment.endLine - fragment.startLine + 1));
}

function intersectsAnyHunk(
  fragment: Fragment,
  hunks: readonly { startLine: number; endLine: number }[],
): boolean {
  for (const h of hunks) {
    // Inclusive overlap on [startLine, endLine].
    if (fragment.startLine <= h.endLine && h.startLine <= fragment.endLine) {
      return true;
    }
  }
  return false;
}
