import { createHash } from "node:crypto";
import type ts from "typescript";

export function computeBodyHash(
  node: ts.Node,
  sourceFile: ts.SourceFile,
): string {
  return hashText(node.getText(sourceFile));
}

export function hashText(raw: string): string {
  const stripped = raw
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const hex = createHash("sha256").update(stripped).digest("hex");
  return `sha256:${hex}`;
}

/**
 * Convert a `bodyHash` (`sha256:<hex>`) into the user-facing `comp:<hex>`
 * `dismissalId` form used in reports and the registry. The two formats
 * exist so the registry can later route on a `<feature>:` prefix without
 * losing the hash algorithm tag inside the body hash itself.
 */
export function bodyHashToCompDismissalId(bodyHash: string): string {
  return `comp:${stripSha256Prefix(bodyHash)}`;
}

/**
 * Compute a `dup:<hex>` group dismissal id from the per-member body
 * hashes. The hashes are sorted lexicographically before concatenation
 * so the id is independent of group member ordering, then SHA-256 is
 * folded over the joined string to give a stable group identity.
 *
 * Bias: the id changes whenever the group's member set changes, so a
 * dismissed group auto-expires once its membership shifts (M5 / D10
 * "recall over precision" — false expiration is preferred over false
 * persistence; the plan accepts the re-dismiss cost).
 */
export function membersToDupDismissalId(
  memberBodyHashes: readonly string[],
): string {
  const normalized = memberBodyHashes.map(stripSha256Prefix).sort();
  const joined = normalized.join("\n");
  const hex = createHash("sha256").update(joined).digest("hex");
  return `dup:${hex}`;
}

/**
 * Normalize a user-provided dismissal id into the post-M2 `<feature>:<hex>`
 * form. Pre-M2 reports surfaced the raw `sha256:<hex>`; users who script
 * against those still pass them in. Anything already carrying a feature
 * prefix passes through unchanged so `dup:<hex>` and `arch:<hex>` ids
 * are routed correctly.
 */
export function normalizeDismissalId(rawId: string): string {
  if (
    rawId.startsWith("comp:") ||
    rawId.startsWith("dup:") ||
    rawId.startsWith("arch:")
  ) {
    return rawId;
  }
  return `comp:${stripSha256Prefix(rawId)}`;
}

/**
 * Compute an `arch:<hex>` dismissal id from a component id of the form
 * `<filePath>::<exportName>::<exportKind>`. Truncated to 16 hex chars
 * (8 bytes) — wide enough to avoid collisions across realistic repo
 * sizes, narrow enough to round-trip through a CLI argument cleanly.
 *
 * Bias: stable across code edits inside the component as long as its
 * file path, export name, and export kind don't change. v1 does not
 * track moves or renames; the dismissal expires when the component id
 * itself shifts. Mirrors the comp/dup precedent — false expiration is
 * preferred over false persistence.
 */
export function componentIdToArchDismissalId(componentId: string): string {
  const hex = createHash("sha256").update(componentId).digest("hex");
  return `arch:${hex.slice(0, 16)}`;
}

function stripSha256Prefix(hash: string): string {
  const SHA256_PREFIX = "sha256:";
  return hash.startsWith(SHA256_PREFIX)
    ? hash.slice(SHA256_PREFIX.length)
    : hash;
}
