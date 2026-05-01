/**
 * Resolve a module specifier (the string after `from` in an import) to a
 * repo-relative source path that exists in the analysed sources.
 *
 * Inputs are intentionally pure — the resolver consults a `knownFiles`
 * `Set` instead of the filesystem so {@link buildGraph} stays
 * deterministic and unit-testable from in-memory fixtures.
 *
 * Resolution rules (v1):
 *
 * 1. **Relative** (`./`, `../`): joined against the importing file's
 *    directory.
 * 2. **Path-mapped**: every pattern in `mappings` is tried in declared
 *    order (longest pattern first; see `parseTsconfigResolution`); the
 *    first replacement that yields a known file wins.
 * 3. **Anything else** (bare specifier, absolute import, URL, etc.):
 *    not a local source — returns `null`. node_modules are out of scope.
 *
 * For each candidate path, probe order is: exact match → `.ts` → `.tsx`
 * → `index.ts` → `index.tsx`. `.d.ts` files are skipped — type-only
 * declaration files don't host components.
 */

import path from "node:path/posix";
import type { PathMapping, TsconfigResolution } from "./tsconfigPaths.ts";

export interface ResolveOptions {
  /** Repo-relative POSIX paths of every source in scope. */
  readonly knownFiles: ReadonlySet<string>;
  /** tsconfig resolution data (baseUrl + paths). Defaults to "no mappings". */
  readonly tsconfig?: TsconfigResolution;
}

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
  opts: ResolveOptions,
): string | null {
  if (specifier.length === 0) return null;
  const known = opts.knownFiles;
  const tsconfig = opts.tsconfig;

  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    const fromDir = path.posix.dirname(fromFile);
    const joined = normalizeRelative(path.posix.join(fromDir, specifier));
    return probe(joined, known);
  }

  // tsconfig path mappings — patterns can include exactly one `*`.
  if (tsconfig !== undefined && tsconfig.mappings.length > 0) {
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
      // First matching pattern owns the specifier — falling through to
      // the next pattern after a structural match would let `*` rules
      // accidentally rescue a typo.
      return null;
    }
  }

  return null;
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
