import ts from "typescript";

/**
 * Canonical name of a `ts.SyntaxKind` value.
 *
 * `ts.SyntaxKind` contains range-marker aliases like `FirstStatement`,
 * `LastStatement`, `FirstLiteralToken`, etc. These share their numeric
 * value with a "real" kind (e.g. `VariableStatement`). The stock reverse
 * lookup `ts.SyntaxKind[k]` returns whichever name was assigned last in
 * enum init order, which — unfortunately — for several kinds ends up being
 * the alias, not the real name.
 *
 * We build a stable reverse map once by walking every string key in
 * `ts.SyntaxKind` and, for each numeric value, keeping the *first* key we
 * encounter that is not a range-marker alias. This yields a stable,
 * version-agnostic mapping (e.g. `244 → "VariableStatement"`) without
 * having to curate per-collision overrides by hand.
 */

const REVERSE_MAP: Map<ts.SyntaxKind, string> = buildReverseMap();

function buildReverseMap(): Map<ts.SyntaxKind, string> {
  const map = new Map<ts.SyntaxKind, string>();
  const entries = Object.entries(ts.SyntaxKind).filter(
    (entry) => typeof entry[1] === "number",
  ) as [string, number][];
  for (const [name, value] of entries) {
    if (isRangeAlias(name)) {
      continue;
    }
    if (!map.has(value)) {
      map.set(value, name);
    }
  }
  return map;
}

function isRangeAlias(name: string): boolean {
  return (
    name.startsWith("First") ||
    name.startsWith("Last") ||
    name === "Count" ||
    name === "Unknown"
  );
}

export function syntaxKindName(kind: ts.SyntaxKind): string {
  const cached = REVERSE_MAP.get(kind);
  if (cached !== undefined) {
    return cached;
  }
  // Fallback for truly unknown kinds (should be unreachable in practice).
  return ts.SyntaxKind[kind];
}
