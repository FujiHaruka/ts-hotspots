import { createHash } from "node:crypto";
import type { Node } from "ts-morph";

export function computeBodyHash(node: Node): string {
  return hashText(node.getText());
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
 * Normalize a user-provided dismissal id into the post-M2 `<feature>:<hex>`
 * form. Pre-M2 reports surfaced the raw `sha256:<hex>`; users who script
 * against those still pass them in. Anything already carrying a feature
 * prefix passes through unchanged so future `dup:<hex>` ids (M5) are
 * routed correctly.
 */
export function normalizeDismissalId(rawId: string): string {
  if (rawId.startsWith("comp:") || rawId.startsWith("dup:")) return rawId;
  return `comp:${stripSha256Prefix(rawId)}`;
}

function stripSha256Prefix(hash: string): string {
  const SHA256_PREFIX = "sha256:";
  return hash.startsWith(SHA256_PREFIX)
    ? hash.slice(SHA256_PREFIX.length)
    : hash;
}
