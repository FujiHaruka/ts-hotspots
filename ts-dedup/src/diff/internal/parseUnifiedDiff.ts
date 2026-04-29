import type { ChangedHunk } from "../../domain/diff.ts";

export interface ParsedDiffFile {
  /** head-side path (forward slash). Deleted files are skipped entirely. */
  filePath: string;
  hunks: ChangedHunk[];
}

/**
 * Parse the stdout of `git diff --unified=0 --no-color --no-renames`.
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
      current = { filePath: "", hunks: [] };
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
      // `--- a/<path>` or `--- /dev/null` for new files. Nothing to do.
      continue;
    }
    if (line.startsWith("@@")) {
      const hunk = parseHunkHeader(line);
      if (hunk !== null) {
        current.hunks.push(hunk);
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

/**
 * Parse a `@@ -a,b +c,d @@` header.
 *
 * Returns `null` when the head-side length `d` is 0 (deletion-only hunk has
 * no head line range).
 */
function parseHunkHeader(line: string): ChangedHunk | null {
  // Regex: `@@ -<a>[,<b>] +<c>[,<d>] @@ ...`
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line);
  if (m === null) {
    return null;
  }
  const cStr = m[3];
  const dStr = m[4];
  if (cStr === undefined) {
    return null;
  }
  const c = Number.parseInt(cStr, 10);
  const d = dStr === undefined ? 1 : Number.parseInt(dStr, 10);
  if (d <= 0) {
    // Deletion-only hunk: head has no lines here.
    return null;
  }
  return { startLine: c, endLine: c + d - 1 };
}
