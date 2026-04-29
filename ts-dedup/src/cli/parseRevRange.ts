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
 * A bare ref without `..` / `...` is rejected; ts-dedup always needs both
 * endpoints so a single ref would be ambiguous.
 */
export function parseRevRange(input: string): RevRange {
  if (input === "") {
    throw new RevRangeParseError("revrange is empty");
  }

  const threeDotIdx = input.indexOf("...");
  if (threeDotIdx !== -1) {
    if (input.includes("...", threeDotIdx + 3)) {
      throw new RevRangeParseError(`invalid revrange: "${input}"`);
    }
    const left = input.slice(0, threeDotIdx);
    const right = input.slice(threeDotIdx + 3);
    return build(left, right, true, input);
  }

  const twoDotIdx = input.indexOf("..");
  if (twoDotIdx !== -1) {
    if (input.includes("..", twoDotIdx + 2)) {
      throw new RevRangeParseError(`invalid revrange: "${input}"`);
    }
    const left = input.slice(0, twoDotIdx);
    const right = input.slice(twoDotIdx + 2);
    return build(left, right, false, input);
  }

  throw new RevRangeParseError(
    `revrange must contain ".." or "..." (got "${input}")`,
  );
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
