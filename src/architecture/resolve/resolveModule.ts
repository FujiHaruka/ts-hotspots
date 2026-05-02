/**
 * Resolve a module specifier (the string after `from` in an import) to a
 * repo-relative source path that exists in the analysed sources.
 *
 * Inputs are intentionally pure — the resolver consults a `knownFiles`
 * `Set` instead of the filesystem so {@link buildGraph} stays
 * deterministic and unit-testable from in-memory fixtures.
 *
 * Resolution rules (v2):
 *
 * 1. **Relative** (`./`, `../`): joined against the importing file's
 *    directory.
 * 2. **Path-mapped** (tsconfig `paths`): every pattern in `mappings` is
 *    tried in declared order (longest pattern first); the first
 *    replacement that yields a known file wins. Path mappings are an
 *    explicit local override and intentionally take precedence over
 *    workspace-package matches with the same prefix.
 * 3. **Workspace package** (`packageMap`): the longest matching package
 *    name from `packageMap.byName` is stripped off the specifier; the
 *    remainder is looked up against the package's normalised
 *    `exports` map, or — if `exports` is absent — the package's `main`
 *    field (no subpath) or legacy file probing under `<root>/<subpath>`.
 * 4. **Anything else** (bare external package, URL, etc.): returns
 *    `null`. node_modules are out of scope.
 *
 * For each candidate path, probe order is: exact match → `.ts` → `.tsx`
 * → `index.ts` → `index.tsx`. `.d.ts` files are skipped — type-only
 * declaration files don't host components.
 */

import path from "node:path/posix";
import { applyExportsMap } from "../workspace/exportsMap.ts";
import type { PackageInfo, PackageMap } from "../workspace/types.ts";
import type { PathMapping, TsconfigResolution } from "./tsconfigPaths.ts";

export interface ResolveContext {
  /** Repo-relative POSIX paths of every source in scope. */
  readonly knownFiles: ReadonlySet<string>;
  /** Root tsconfig resolution data (baseUrl + paths). Defaults to "no mappings". */
  readonly tsconfig?: TsconfigResolution;
  /** Workspace package map. Absent → single-package mode (no name resolution). */
  readonly packageMap?: PackageMap;
}

/** @deprecated Use {@link ResolveContext}. Kept for one release while callers migrate. */
export type ResolveOptions = ResolveContext;

/**
 * Returns the resolved repo-relative file path or `null` when the
 * specifier does not point at a known local source.
 *
 * `fromFile` must be the repo-relative POSIX path of the importing
 * source (matching entries in `knownFiles`). `specifier` is the literal
 * string from the import declaration.
 */
export function resolveModule(
  specifier: string,
  fromFile: string,
  ctx: ResolveContext,
): string | null {
  if (specifier.length === 0) return null;
  const known = ctx.knownFiles;

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const fromDir = path.posix.dirname(fromFile);
    const joined = normalizeRelative(path.posix.join(fromDir, specifier));
    return probe(joined, known);
  }

  // (2) tsconfig path mappings — patterns can include exactly one `*`.
  // Pick the per-package tsconfig when the importing file belongs to a
  // workspace package (M3); otherwise fall back to the root tsconfig.
  const tsconfig = tsconfigForFile(fromFile, ctx);
  if (tsconfig !== undefined && tsconfig.mappings.length > 0) {
    const fromPaths = resolveViaPathMappings(specifier, tsconfig, known);
    if (fromPaths !== null) return fromPaths;
  }

  // (3) Workspace package (`@scope/foo` / `@scope/foo/sub` / bare `foo`).
  const packageMap = ctx.packageMap;
  if (packageMap !== undefined && packageMap.byName.size > 0) {
    const fromPkg = resolveViaWorkspacePackage(specifier, packageMap, known);
    if (fromPkg !== null) return fromPkg;
  }

  return null;
}

/**
 * Choose the right tsconfig for an importing file. Per-package tsconfig
 * wins when the file belongs to a workspace package that has one;
 * otherwise the root tsconfig is the fallback (E7). When neither
 * exists, returns `undefined` — the resolver treats that as "no path
 * mappings" and skips the branch.
 */
function tsconfigForFile(
  fromFile: string,
  ctx: ResolveContext,
): TsconfigResolution | undefined {
  const pkg = ctx.packageMap?.byFile(fromFile);
  if (pkg?.tsconfig != null) return pkg.tsconfig;
  return ctx.tsconfig;
}

/**
 * Try to resolve `specifier` through tsconfig path mappings. Returns
 * the resolved path on success, or `null` for both "no pattern matched"
 * and "pattern matched but no target file found" — the caller treats
 * these the same and falls through to workspace resolution. This
 * mirrors TS's Bundler resolver, which doesn't lock in a matched
 * `paths` pattern to a hard miss.
 *
 * Within `paths`, the first matching pattern still wins: a structural
 * match stops the loop, and later patterns are not tried as looser
 * fallbacks (so a typo isn't silently rescued by a wildcard).
 */
function resolveViaPathMappings(
  specifier: string,
  tsconfig: TsconfigResolution,
  known: ReadonlySet<string>,
): string | null {
  for (const mapping of tsconfig.mappings) {
    const replaced = applyPathMapping(specifier, mapping);
    if (replaced === null) continue;
    for (const candidate of replaced) {
      const joined = normalizeRelative(
        path.posix.join(tsconfig.baseUrl, candidate),
      );
      const hit = probe(joined, known);
      if (hit !== null) return hit;
    }
    // Pattern matched but no target hit. Don't try later patterns —
    // they would be looser fallbacks; an explicit narrow match must
    // not be silently rescued by a wildcard rule.
    return null;
  }
  return null;
}

/**
 * Resolve `specifier` against `packageMap`. Returns the resolved path
 * or `null` when the specifier doesn't point at a workspace package or
 * the matched package's exports/main don't yield a known file.
 *
 * Spec separation:
 *   - exports declared, subpath matches → resolve via exports (E3 priority).
 *   - exports declared, subpath unmatched → null (E12 hard miss).
 *   - exports absent, no subpath        → main fallback (E4).
 *   - exports absent, subpath present   → legacy probing under `<root>/<subpath>` (E4).
 */
function resolveViaWorkspacePackage(
  specifier: string,
  packageMap: PackageMap,
  known: ReadonlySet<string>,
): string | null {
  const matched = matchPackageName(specifier, packageMap);
  if (matched === null) return null;
  const { pkg, remainder } = matched;

  // Normalise empty remainder (= bare package name) to `.` per Node's
  // `package.json#exports` semantics.
  const subpath = remainder === "" ? "." : `./${remainder}`;

  if (pkg.exportsMap !== null) {
    const result = applyExportsMap(pkg.exportsMap, subpath);
    if (result === null) return null; // E12 hard miss.
    const candidate = joinPackageRelative(pkg.root, result.target);
    if (candidate === null) return null;
    return probe(candidate, known);
  }

  // No `exports` declaration.
  if (subpath === ".") {
    if (pkg.mainTarget === null) return null;
    return probe(pkg.mainTarget, known);
  }
  // Legacy probing for subpath: `<root>/<subpath>` with extension fallback.
  const candidate = joinPackageRelative(pkg.root, `./${remainder}`);
  if (candidate === null) return null;
  return probe(candidate, known);
}

interface PackageMatch {
  readonly pkg: PackageInfo;
  readonly remainder: string;
}

/**
 * Find the longest package name in `packageMap.byName` that prefixes
 * `specifier`, with a `/` boundary or full match. Returns `null`
 * when no package matches.
 */
function matchPackageName(
  specifier: string,
  packageMap: PackageMap,
): PackageMatch | null {
  let best: PackageMatch | null = null;
  for (const [name, pkg] of packageMap.byName) {
    if (specifier === name) {
      if (best === null || name.length > best.pkg.name.length) {
        best = { pkg, remainder: "" };
      }
      continue;
    }
    if (specifier.startsWith(`${name}/`)) {
      const remainder = specifier.slice(name.length + 1);
      if (best === null || name.length > best.pkg.name.length) {
        best = { pkg, remainder };
      }
    }
  }
  return best;
}

/**
 * Combine a package root (`packages/foo`) and a package-relative target
 * (`./src/x.ts` or `./src/x` or `./src/x/index.ts`) into a repo-relative
 * POSIX path. Returns `null` when the target escapes the package root.
 */
function joinPackageRelative(root: string, target: string): string | null {
  if (target === "" || target === ".") return null;
  const trimmed = target.startsWith("./") ? target.slice(2) : target;
  if (trimmed === "" || trimmed.startsWith("../") || trimmed === "..") {
    return null;
  }
  if (root === "" || root === ".") return trimmed;
  return path.posix.join(root, trimmed);
}

/**
 * Try `target` as a TypeScript source file. Returns the matched
 * `knownFiles` entry, or `null` when nothing fits.
 *
 * Probe order matters: an exact `foo.ts` import must not be rewritten
 * to `foo.ts.ts`, so files that already carry a known extension are
 * tested first.
 */
function probe(target: string, known: ReadonlySet<string>): string | null {
  if (hasSourceExtension(target) && known.has(target)) return target;
  // If the target carries a JS extension that maps to a TS source
  // (`./dist/x.js` → `./dist/x.ts`), try the TS form too. Common in
  // exports maps that point at the build output even when source is
  // available alongside.
  if (target.endsWith(".js")) {
    const swapped = `${target.slice(0, -3)}.ts`;
    if (known.has(swapped)) return swapped;
    const swappedTsx = `${target.slice(0, -3)}.tsx`;
    if (known.has(swappedTsx)) return swappedTsx;
  }
  for (const ext of FILE_EXTENSIONS) {
    const withExt = `${target}${ext}`;
    if (known.has(withExt)) return withExt;
  }
  for (const ext of FILE_EXTENSIONS) {
    const withIndex = path.posix.join(target, `index${ext}`);
    if (known.has(withIndex)) return withIndex;
  }
  return null;
}

const FILE_EXTENSIONS = [".ts", ".tsx"] as const;

function hasSourceExtension(p: string): boolean {
  return p.endsWith(".ts") || p.endsWith(".tsx");
}

/**
 * Apply one `paths` mapping to a specifier. Returns `null` when the
 * pattern does not match the specifier at all; returns the list of
 * candidate replacement paths otherwise.
 *
 * - `@/foo` exact pattern matches the specifier `@/foo` only.
 * - `@/*` wildcard pattern matches anything starting with `@/`; the
 *   captured tail substitutes into each target's `*`.
 */
function applyPathMapping(
  specifier: string,
  mapping: PathMapping,
): string[] | null {
  const star = mapping.pattern.indexOf("*");
  if (star === -1) {
    if (specifier !== mapping.pattern) return null;
    return mapping.targets.map((t) => t.replace(/\*$/, ""));
  }
  const prefix = mapping.pattern.slice(0, star);
  const suffix = mapping.pattern.slice(star + 1);
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return null;
  if (specifier.length < prefix.length + suffix.length) return null;
  const captured = specifier.slice(
    prefix.length,
    specifier.length - suffix.length,
  );
  return mapping.targets.map((t) => t.replace("*", captured));
}

function normalizeRelative(p: string): string {
  // `path.posix.join("a", "../../b")` returns `../b`; drop any leading
  // `../` so the result stays repo-relative. A specifier that escapes
  // the repo root cannot point to a known file anyway.
  return p.replace(/^(\.\.\/)+/, "");
}
