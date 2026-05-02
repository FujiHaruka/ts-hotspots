/**
 * Read a single package's `package.json` and normalise the fields the
 * resolver cares about: `name`, `main`, `exports`. All paths are
 * returned repo-relative POSIX so they slot into `knownFiles` /
 * `packageMap` without further conversion.
 *
 * Failures (missing file, invalid JSON, missing `name`) collapse to
 * `null` — workspace mode is recall-oriented but a package without a
 * name cannot participate in name-based resolution.
 */

import { readFileSync, statSync } from "node:fs";
import { resolve as resolveNative } from "node:path";
import { join } from "node:path/posix";
import { parseExportsField } from "./exportsMap.ts";
import type { PackageInfo } from "./types.ts";

interface RawPackageJson {
  readonly name?: unknown;
  readonly main?: unknown;
  readonly exports?: unknown;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

function fileExists(absPath: string): boolean {
  try {
    return statSync(absPath).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve `target` (a package-relative `./...` string) to a repo-relative
 * POSIX path. Returns `null` when the target can't be reduced cleanly.
 */
export function joinRelativeToPackage(
  packageRoot: string,
  target: string,
): string | null {
  if (target === "" || target === ".") return null;
  // Drop the leading `./` so `path.posix.join` doesn't emit `./foo`.
  const trimmed = target.startsWith("./") ? target.slice(2) : target;
  if (trimmed === "") return null;
  // Disallow `..` escaping the package root.
  if (trimmed.startsWith("../") || trimmed === "..") return null;
  if (packageRoot === "" || packageRoot === ".") return trimmed;
  return join(packageRoot, trimmed);
}

export function readPackage(
  repoRoot: string,
  packageRoot: string,
): PackageInfo | null {
  const pkgJsonAbs = resolveNative(repoRoot, packageRoot, "package.json");
  let raw: string;
  try {
    raw = readFileSync(pkgJsonAbs, "utf8");
  } catch {
    return null;
  }
  let parsed: RawPackageJson;
  try {
    parsed = JSON.parse(raw) as RawPackageJson;
  } catch {
    return null;
  }
  const name = parsed.name;
  if (typeof name !== "string" || name === "") return null;

  const mainTarget =
    typeof parsed.main === "string" && parsed.main !== ""
      ? joinRelativeToPackage(toPosix(packageRoot), parsed.main)
      : null;
  const exportsMap = parseExportsField(parsed.exports);

  // Detect `<root>/tsconfig.json`; M2 records the path, M3 loads it.
  const tsconfigAbs = resolveNative(repoRoot, packageRoot, "tsconfig.json");
  const tsconfigPath = fileExists(tsconfigAbs)
    ? join(toPosix(packageRoot), "tsconfig.json")
    : null;

  return {
    name,
    root: toPosix(packageRoot),
    exportsMap,
    mainTarget,
    tsconfigPath,
    tsconfig: null,
  };
}
