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

/**
 * `coch:<hex>` dismissal id for a cochange cluster row. Hashes the
 * lex-sorted member set so the id is stable as long as the cluster
 * keeps the same files (the order in which `collapseClusters` discovered
 * the constituent pairs is irrelevant). Same `coch:` prefix and 16-hex
 * width as pair ids.
 *
 * The hashed input is prefixed with `cluster\n` so the cluster and pair
 * input spaces never overlap — without this, a hypothetical 2-member
 * cluster would hash to the same id as the corresponding pair.
 */
export function computeCochangeClusterDismissalId(
  members: readonly string[],
): string {
  const sorted = [...members].sort();
  const hex = createHash("sha256")
    .update(`cluster\n${sorted.join("\n")}`)
    .digest("hex");
  return `coch:${hex.slice(0, 16)}`;
}
