/**
 * Parse and apply `package.json#exports`.
 *
 * Supported shapes (E2 / E3 / E12):
 *   - **string** at the top level → entire package: `{ subpath: ".", target: literal }`.
 *   - **object** with subpath keys (`"."` / `"./client"` / `"./foo/*"`).
 *     Values may be a string, a conditional object, or a string array.
 *   - **object** with conditional keys at the top level (no subpath
 *     prefix) → flattened to a single `"."` entry.
 *   - **conditional object**: keys like `default`, `import`, `node`,
 *     `types`, custom keys. Resolution order is fixed:
 *       `default → import → node → types → (any other)`.
 *     The first key whose target resolves to a string wins.
 *   - **wildcard subpath**: a single `*` in the key (`"./foo/*"`); the
 *     captured tail substitutes into the target's `*`. Multiple `*`s
 *     in either key or target are treated as a literal match (matched
 *     character-for-character) — Node spec extras outside scope.
 *   - **string array**: tried in order, first string wins. Conditional
 *     entries inside the array are recursed.
 *
 * Out of scope:
 *   - dynamic condition negotiation (we pick a fixed priority list).
 *   - subpath imports (`"#internal"`).
 *   - external relative-target probing past the literal `*` substitution.
 *
 * E12: when a package declares `exports` and a specifier's subpath
 * matches no entry, callers must treat the lookup as a hard miss
 * (Node's "not exported" semantics).
 */

import type {
  ExportsConditional,
  ExportsEntry,
  ExportsLiteral,
  ExportsMap,
  ExportsTarget,
} from "./types.ts";

const CONDITION_PRIORITY: readonly string[] = [
  "default",
  "import",
  "node",
  "types",
];

function priorityOf(key: string): number {
  const idx = CONDITION_PRIORITY.indexOf(key);
  return idx === -1 ? CONDITION_PRIORITY.length : idx;
}

function isSubpathKey(key: string): boolean {
  return key === "." || key.startsWith("./");
}

function isLiteralTarget(value: unknown): value is string {
  return typeof value === "string";
}

/**
 * Walk a raw exports value and produce an ExportsTarget. Returns `null`
 * when the value cannot be turned into anything usable.
 */
function parseTarget(value: unknown): ExportsTarget | null {
  if (isLiteralTarget(value)) {
    if (!value.startsWith("./")) return null;
    const lit: ExportsLiteral = { kind: "literal", target: value };
    return lit;
  }
  if (Array.isArray(value)) {
    // Treat as alternatives: first usable string wins.
    for (const item of value) {
      const t = parseTarget(item);
      if (t !== null) return t;
    }
    return null;
  }
  if (value !== null && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const conditions: {
      readonly key: string;
      readonly target: ExportsTarget;
    }[] = [];
    for (const k of Object.keys(obj)) {
      const child = parseTarget(obj[k]);
      if (child === null) continue;
      conditions.push({ key: k, target: child });
    }
    if (conditions.length === 0) return null;
    conditions.sort((a, b) => {
      const pa = priorityOf(a.key);
      const pb = priorityOf(b.key);
      if (pa !== pb) return pa - pb;
      // Stable secondary order by key for determinism.
      return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
    });
    const cond: ExportsConditional = { kind: "conditional", conditions };
    return cond;
  }
  return null;
}

export function parseExportsField(field: unknown): ExportsMap | null {
  if (field === undefined || field === null) return null;

  // Top-level string → equivalent to `{ ".": "<string>" }`.
  if (isLiteralTarget(field)) {
    const target = parseTarget(field);
    if (target === null) return null;
    return {
      entries: [{ subpath: ".", isWildcard: false, target }],
    };
  }

  if (typeof field !== "object") return null;
  const obj = field as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) return null;

  const allSubpathKeys = keys.every(isSubpathKey);
  const noSubpathKeys = keys.every((k) => !isSubpathKey(k));

  if (noSubpathKeys) {
    // Conditional object at the top level → maps `.` only.
    const target = parseTarget(field);
    if (target === null) return null;
    return {
      entries: [{ subpath: ".", isWildcard: false, target }],
    };
  }

  if (!allSubpathKeys) {
    // Mixed map (some subpaths, some condition keys) is invalid per
    // Node spec; bail rather than guess.
    return null;
  }

  const entries: ExportsEntry[] = [];
  for (const subpath of keys) {
    const target = parseTarget(obj[subpath]);
    if (target === null) continue;
    const isWildcard = (subpath.match(/\*/g) ?? []).length === 1;
    entries.push({ subpath, isWildcard, target });
  }
  if (entries.length === 0) return null;

  // Sort: literals first (longest first), then wildcards (longest
  // prefix first). This makes lookups linear-scan + first-hit-wins.
  entries.sort((a, b) => {
    if (a.isWildcard !== b.isWildcard) return a.isWildcard ? 1 : -1;
    if (a.subpath.length !== b.subpath.length) {
      return b.subpath.length - a.subpath.length;
    }
    return a.subpath < b.subpath ? -1 : a.subpath > b.subpath ? 1 : 0;
  });

  return { entries };
}

/**
 * Pick the highest-priority literal string out of a target tree.
 * Returns `null` when the tree contains no literal terminal.
 */
function resolveTargetToLiteral(target: ExportsTarget): string | null {
  if (target.kind === "literal") return target.target;
  for (const c of target.conditions) {
    const lit = resolveTargetToLiteral(c.target);
    if (lit !== null) return lit;
  }
  return null;
}

/**
 * Substitute the captured wildcard tail into a target literal.
 * Single `*` only; multi-`*` literals are returned unchanged.
 */
function substituteWildcard(literal: string, captured: string): string {
  const stars = (literal.match(/\*/g) ?? []).length;
  if (stars !== 1) return literal;
  return literal.replace("*", captured);
}

interface ApplyExportsResult {
  /** Repo-relative-style target (starts with `./`). */
  readonly target: string;
}

/**
 * Apply an `ExportsMap` to a subpath like `"."` or `"./client"`.
 *
 * Returns `null` when no entry matches (E12 hard miss) or the matched
 * entry has no resolvable literal under the priority order.
 */
export function applyExportsMap(
  map: ExportsMap,
  subpath: string,
): ApplyExportsResult | null {
  for (const entry of map.entries) {
    if (!entry.isWildcard) {
      if (entry.subpath !== subpath) continue;
      const lit = resolveTargetToLiteral(entry.target);
      if (lit === null) return null;
      return { target: lit };
    }
    const star = entry.subpath.indexOf("*");
    const prefix = entry.subpath.slice(0, star);
    const suffix = entry.subpath.slice(star + 1);
    if (!subpath.startsWith(prefix)) continue;
    if (!subpath.endsWith(suffix)) continue;
    // Wildcard captures must be non-empty (Node spec): `./prefix/*` does
    // not match the bare `./prefix/`.
    if (subpath.length <= prefix.length + suffix.length) continue;
    const captured = subpath.slice(
      prefix.length,
      subpath.length - suffix.length,
    );
    const lit = resolveTargetToLiteral(entry.target);
    if (lit === null) return null;
    return { target: substituteWildcard(lit, captured) };
  }
  return null;
}
