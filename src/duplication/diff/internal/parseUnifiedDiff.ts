import type { ChangedHunk, HunkSpan } from "../../domain/diff.ts";

interface ParsedDiffFile {
  /** head-side path (forward slash). Deleted files are skipped entirely. */
  filePath: string;
  basePath: string | undefined;
  hunks: ChangedHunk[];
  spans: HunkSpan[];
}

/**
 * Parse the stdout of `git diff --unified=0 --no-color --find-renames`.
 *
 * Only head-side ranges are returned (hunks consisting solely of deletions —
 * `@@ -a,b +c,0 @@` — are skipped because they have no head line range).
 *
 * Deleted files (where the `+++` line is `/dev/null`) are dropped so that the
 * caller does not need to deal with them.
 */
export function parseUnifiedDiff(stdout: string): ParsedDiffFile[] {
  const results: ParsedDiffFile[] = [];
  const lines = stdout.split("\n");

  let current: ParsedDiffFile | null = null;
  let skipCurrent = false;

  const flush = (): void => {
    if (current !== null && !skipCurrent) {
      results.push(current);
    }
    current = null;
    skipCurrent = false;
  };

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      flush();
      current = { filePath: "", basePath: undefined, hunks: [], spans: [] };
      skipCurrent = false;
      continue;
    }
    if (current === null) {
      continue;
    }
    if (line.startsWith("+++ ")) {
      const rest = line.slice(4);
      if (rest === "/dev/null") {
        // Deleted file — head side has no content.
        skipCurrent = true;
        continue;
      }
      // `+++ b/<path>` or `+++ "b/<path>"` (quoted form not handled here).
      const path = stripAB(rest);
      current.filePath = path;
      continue;
    }
    if (line.startsWith("--- ")) {
      const rest = line.slice(4);
      current.basePath = rest === "/dev/null" ? undefined : stripAB(rest);
      continue;
    }
    if (line.startsWith("@@")) {
      const span = parseHunkHeader(line);
      if (span !== null) {
        current.spans.push(span);
        if (span.headCount > 0) {
          current.hunks.push({
            startLine: span.headStart,
            endLine: span.headStart + span.headCount - 1,
          });
        }
      }
      continue;
    }
  }
  flush();

  // Drop entries we failed to resolve (missing filePath).
  return results.filter((f) => f.filePath !== "");
}

function stripAB(p: string): string {
  if (p.startsWith("a/") || p.startsWith("b/")) {
    return p.slice(2);
  }
  return p;
}

function parseHunkHeader(line: string): HunkSpan | null {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (m === null) return null;
  const [, a, b, c, d] = m;
  if (a === undefined || c === undefined) return null;
  return {
    baseStart: Number.parseInt(a, 10),
    baseCount: b === undefined ? 1 : Number.parseInt(b, 10),
    headStart: Number.parseInt(c, 10),
    headCount: d === undefined ? 1 : Number.parseInt(d, 10),
  };
}
