/**
 * `coch:<hex>` dismissal id for a cochange file pair.
 *
 * The pair is canonical-ordered (lex on POSIX path) before hashing so
 * `(A, B)` and `(B, A)` produce the same id. Truncated to 16 hex chars
 * (8 bytes) to match `arch:<hex>` width, which is the precedent set by
 * `componentIdToArchDismissalId` — wide enough to avoid collisions across
 * realistic repo sizes, narrow enough to round-trip through a CLI argument.
 */

import { createHash } from "node:crypto";

export function computeCochangePairDismissalId(
  pathA: string,
  pathB: string,
): string {
  const [a, b] = pathA < pathB ? [pathA, pathB] : [pathB, pathA];
  const hex = createHash("sha256").update(`${a}\n${b}`).digest("hex");
  return `coch:${hex.slice(0, 16)}`;
}
