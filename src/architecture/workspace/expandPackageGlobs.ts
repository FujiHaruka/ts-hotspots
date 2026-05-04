/**
 * Expand workspace package globs into a deterministic list of repo-
 * relative POSIX directory paths that contain a `package.json`.
 *
 * Supported pattern shapes:
 *   - **literal** (`apps/web`): kept verbatim if `<dir>/package.json` exists.
 *   - **single-segment glob** (`packages/*`, `apps/*`): one `*` in the
 *     last segment. We `readdirSync` the parent and keep child dirs that
 *     have a `package.json`.
 *   - **negation** (`!packages/excluded`): suppresses any earlier match.
 *
 * Anything more elaborate (`packages/**`, multi-`*` patterns,
 * brace expansion, leading wildcards) is silently dropped — we don't
 * want to silently miss packages, but we also don't want to parse a
 * full glob grammar. Real-world workspaces use `packages/*` plus a
 * sprinkling of literals; the rare oddities can be filed as follow-ups.
 *
 * Hard exclusions (regardless of pattern): `node_modules`, `dist`,
 * `build`, `.next`, `out`, `.cache`, hidden dirs (leading `.`).
 */

import { readdirSync, statSync } from "node:fs";
import { resolve as resolveNative } from "node:path";
import { join } from "node:path/posix";

const HARD_EXCLUDES: ReadonlySet<string> = new Set([
  "node_modules",
  "dist",
  "build",
  ".next",
  "out",
  ".cache",
  ".git",
]);

function shouldSkipChild(name: string): boolean {
  if (HARD_EXCLUDES.has(name)) return true;
  if (name.startsWith(".")) return true;
  return false;
}

function hasPackageJson(repoRoot: string, relDir: string): boolean {
  const abs = resolveNative(repoRoot, relDir, "package.json");
  try {
    return statSync(abs).isFile();
  } catch {
    return false;
  }
}

function expandSinglePattern(repoRoot: string, pattern: string): string[] {
  const cleaned = pattern.replace(/\/+$/, "");
  if (cleaned === "" || cleaned === ".") return [];

  // Plain literal — accept iff package.json exists there.
  if (!cleaned.includes("*")) {
    return hasPackageJson(repoRoot, cleaned) ? [cleaned] : [];
  }

  // Only a single trailing `<prefix>/*` pattern is supported.
  // Everything else (multi-`*`, `**`, mid-segment `*`) returns empty.
  const slashIdx = cleaned.lastIndexOf("/");
  const lastSegment = slashIdx === -1 ? cleaned : cleaned.slice(slashIdx + 1);
  const parent = slashIdx === -1 ? "." : cleaned.slice(0, slashIdx);
  if (lastSegment !== "*") return [];
  if (parent.includes("*")) return [];

  const parentAbs = resolveNative(repoRoot, parent);
  let entries: string[];
  try {
    entries = readdirSync(parentAbs);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const name of entries) {
    if (shouldSkipChild(name)) continue;
    const childRel = parent === "." ? name : join(parent, name);
    const childAbs = resolveNative(repoRoot, childRel);
    let isDir: boolean;
    try {
      isDir = statSync(childAbs).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    if (!hasPackageJson(repoRoot, childRel)) continue;
    out.push(childRel);
  }
  return out;
}

interface ExpandPackageGlobsResult {
  /** Repo-relative POSIX paths of detected package roots, sorted. */
  readonly roots: readonly string[];
}

export function expandPackageGlobs(
  repoRoot: string,
  patterns: readonly string[],
): ExpandPackageGlobsResult {
  const includes = new Set<string>();
  const excludes = new Set<string>();

  for (const raw of patterns) {
    const pattern = raw.trim();
    if (pattern === "") continue;
    if (pattern.startsWith("!")) {
      const negated = pattern.slice(1).trim();
      for (const r of expandSinglePattern(repoRoot, negated)) excludes.add(r);
      continue;
    }
    for (const r of expandSinglePattern(repoRoot, pattern)) includes.add(r);
  }

  const roots: string[] = [];
  for (const r of includes) {
    if (excludes.has(r)) continue;
    roots.push(r);
  }
  // Determinism: sort lexicographically.
  roots.sort();
  return { roots };
}
