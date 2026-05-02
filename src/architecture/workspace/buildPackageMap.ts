/**
 * Combine `discoverWorkspace` + `readPackage` into a `PackageMap`.
 *
 * `byName` lets the resolver answer "which package is `@scope/foo`?".
 * `byFile` lets the resolver ask "which package owns this file?" for
 * the importing source — needed in M3 to look up the right tsconfig.
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
 */

import { readPackage } from "./readPackage.ts";
import type { PackageInfo, PackageMap } from "./types.ts";

export interface BuildPackageMapOptions {
  readonly repoRoot: string;
  /** Repo-relative POSIX directory paths (sorted by `discoverWorkspace`). */
  readonly packageRoots: readonly string[];
}

export function buildPackageMap(opts: BuildPackageMapOptions): PackageMap {
  const packages: PackageInfo[] = [];
  const byName = new Map<string, PackageInfo>();
  const sortedRoots = [...opts.packageRoots].sort();

  for (const root of sortedRoots) {
    const info = readPackage(opts.repoRoot, root);
    if (info === null) continue;
    if (byName.has(info.name)) continue; // First-wins on duplicates.
    byName.set(info.name, info);
    packages.push(info);
  }

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
    packages,
  };
}
