export interface RevRange {
  baseRef: string;
  headRef: string;
  /** `true` for `A...B` (PR-style, merge-base vs head). `false` for `A..B`. */
  threeDot: boolean;
}

export class RevRangeParseError extends Error {
  override readonly name = "RevRangeParseError";
}

const DEFAULT_HEAD = "HEAD";

/**
 * Parse a git-style revision range:
 *   - `A..B`   two-dot: diff base against head directly
 *   - `A...B`  three-dot: diff from merge-base(A, B) to B (PR semantics)
 *   - `A..`  / `A...`  → head side defaults to `HEAD`
 *   - `..B`  / `...B`  → base side defaults to `HEAD`
 *
 * A bare ref without `..` / `...` is rejected; ts-hotspots always needs both
 * endpoints so a single ref would be ambiguous.
 */
export function parseRevRange(input: string): RevRange {
  if (input === "") {
    throw new RevRangeParseError("revrange is empty");
  }

  // `...` must be tried before `..` since `..` is a prefix of `...`.
  const result = trySplit(input, "...", true) ?? trySplit(input, "..", false);
  if (result === null) {
    throw new RevRangeParseError(
      `revrange must contain ".." or "..." (got "${input}")`,
    );
  }
  return result;
}

function trySplit(
  input: string,
  sep: string,
  threeDot: boolean,
): RevRange | null {
  const idx = input.indexOf(sep);
  if (idx === -1) return null;
  if (input.includes(sep, idx + sep.length)) {
    throw new RevRangeParseError(`invalid revrange: "${input}"`);
  }
  const left = input.slice(0, idx);
  const right = input.slice(idx + sep.length);
  return build(left, right, threeDot, input);
}

function build(
  left: string,
  right: string,
  threeDot: boolean,
  input: string,
): RevRange {
  const baseRef = left === "" ? DEFAULT_HEAD : left;
  const headRef = right === "" ? DEFAULT_HEAD : right;
  if (left === "" && right === "") {
    throw new RevRangeParseError(`revrange has no refs: "${input}"`);
  }
  return { baseRef, headRef, threeDot };
}
