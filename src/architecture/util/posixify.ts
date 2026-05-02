/**
 * Normalise a path to forward-slash form. Used wherever we round-trip
 * platform-native paths from `node:path` back into POSIX-style repo-
 * relative strings (graph keys, `knownFiles` entries).
 */
export function posixify(p: string): string {
  return p.replace(/\\/g, "/");
}
