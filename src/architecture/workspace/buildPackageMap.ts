/**
 * Combine `discoverWorkspace` + `readPackage` into a `PackageMap`.
 *
 * `byName` lets the resolver answer "which package is `@scope/foo`?".
 * `byFile` lets the resolver ask "which package owns this file?" for
 * the importing source — needed for `tsconfigByFile` lookups so each
 * source file gets its own package's `paths` aliases.
 *
 * `byFile` uses **longest-root-prefix** match so nested workspace
 * packages (e.g. `apps/web` and `apps/web/internal`) resolve to the
 * deepest match, not the parent. Files outside any package root return
 * `undefined` (e.g. repo-root scripts, shared `tools/` outside the
 * workspace).
 *
 * Determinism: `packages` is sorted by `root`. Duplicate package names
 * are resolved by keeping the first (sorted-root order) and dropping
 * the rest — workspace setups with duplicate names are misconfigured;
 * the silent skip avoids a hard crash and keeps lookups deterministic.
 *
 * Two-pass tsconfig loading:
 *   1. Read every package's metadata (`name`, `exports`, `main`,
 *      `tsconfigPath`) without touching the tsconfigs.
 *   2. Build the name index, then load each package's tsconfig with
 *      that index as the workspace `extends` rewrite source. This
 *      breaks the chicken-and-egg between "to read a tsconfig that
 *      extends `@scope/base/tsconfig.base.json` we need the
 *      packageMap" and "to build the packageMap we need every
 *      package's tsconfig".
 */

import { resolve as resolveNative } from "node:path";
import { readTsconfigResolution } from "../resolve/tsconfigPaths.ts";
import { readPackage } from "./readPackage.ts";
import type { PackageInfo, PackageMap } from "./types.ts";

export interface BuildPackageMapOptions {
  readonly repoRoot: string;
  /** Repo-relative POSIX directory paths (sorted by `discoverWorkspace`). */
  readonly packageRoots: readonly string[];
}

export function buildPackageMap(opts: BuildPackageMapOptions): PackageMap {
  const initialPackages: PackageInfo[] = [];
  const seenNames = new Set<string>();
  const sortedRoots = [...opts.packageRoots].sort();

  // Pass 1: read package metadata, build the name index without
  // tsconfigs.
  for (const root of sortedRoots) {
    const info = readPackage(opts.repoRoot, root);
    if (info === null) continue;
    if (seenNames.has(info.name)) continue; // First-wins on duplicates.
    seenNames.add(info.name);
    initialPackages.push(info);
  }

  const initialByName = new Map<string, PackageInfo>();
  for (const p of initialPackages) initialByName.set(p.name, p);
  const initialMap = makeMap(initialPackages, initialByName);

  // Pass 2: load each package's tsconfig (when present), using the
  // name index for workspace `extends` rewriting.
  const finalPackages: PackageInfo[] = [];
  const byName = new Map<string, PackageInfo>();
  for (const info of initialPackages) {
    let tsconfig: PackageInfo["tsconfig"] = null;
    if (info.tsconfigPath !== null) {
      const tsconfigAbs = resolveNative(opts.repoRoot, info.tsconfigPath);
      tsconfig = readTsconfigResolution(opts.repoRoot, {
        tsconfigPath: tsconfigAbs,
        packageMap: initialMap,
      });
    }
    const final: PackageInfo = { ...info, tsconfig };
    finalPackages.push(final);
    byName.set(final.name, final);
  }

  return makeMap(finalPackages, byName);
}

function makeMap(
  packages: readonly PackageInfo[],
  byName: ReadonlyMap<string, PackageInfo>,
): PackageMap {
  // For longest-prefix lookup, sort packages by descending root length.
  const byLengthDesc = [...packages].sort(
    (a, b) => b.root.length - a.root.length,
  );

  const byFile = (file: string): PackageInfo | undefined => {
    for (const pkg of byLengthDesc) {
      if (file === pkg.root) return pkg;
      // Match `<root>/...` exactly — `apps/webapp` must not match
      // package root `apps/web`.
      if (file.startsWith(`${pkg.root}/`)) return pkg;
    }
    return undefined;
  };

  return {
    byName,
    byFile,
    packages: [...packages],
  };
}
