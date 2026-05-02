/**
 * `ts.ParseConfigHost` shim that lets workspace packages satisfy
 * `extends: "@scope/foo/tsconfig.base.json"` without `pnpm install`
 * having materialised `node_modules/@scope/foo`.
 *
 * TS's extends resolver walks parent directories looking for
 * `node_modules/<pkgName>/...`. Each candidate path goes through this
 * host's `fileExists` / `readFile`. When `<pkgName>` matches a
 * workspace package known to the resolver, we transparently rewrite
 * the path to the package's actual repo-relative root, so the host
 * reads the real source-tree file. Anything else falls through to
 * `ts.sys` unchanged.
 *
 * This is the only place where the architecture pipeline reaches the
 * filesystem indirectly through the TypeScript API. The boundary is
 * deliberate (CLAUDE.md: tsconfig reading delegated to TS, specifier
 * resolution stays parser-only and `knownFiles`-driven).
 */

import { resolve as resolveNative } from "node:path";
import ts from "typescript";
import type { PackageMap } from "../workspace/types.ts";

export interface MakeParseConfigHostOptions {
  readonly repoRoot: string;
  /** When present, workspace package extends are rewritten via this map. */
  readonly packageMap?: PackageMap;
}

/**
 * Try to map a path containing `node_modules/<pkgName>/<rest>` to
 * `<repoRoot>/<package.root>/<rest>`. Returns `null` when no rewrite
 * applies — for example, the path doesn't go through node_modules, or
 * the package name isn't a workspace member.
 */
export function rewriteWorkspaceExtends(
  rawPath: string,
  repoRoot: string,
  packageMap: PackageMap,
): string | null {
  // Normalise to forward slashes for the lookup; we'll re-join with
  // platform separators at the end.
  const norm = rawPath.replace(/\\/g, "/");
  const marker = "/node_modules/";
  const idx = norm.lastIndexOf(marker);
  if (idx === -1) return null;
  const after = norm.slice(idx + marker.length);
  if (after === "") return null;

  let pkgName: string;
  let rest: string;
  if (after.startsWith("@")) {
    const slash1 = after.indexOf("/");
    if (slash1 === -1) return null;
    const slash2 = after.indexOf("/", slash1 + 1);
    if (slash2 === -1) {
      pkgName = after;
      rest = "";
    } else {
      pkgName = after.slice(0, slash2);
      rest = after.slice(slash2 + 1);
    }
  } else {
    const slash = after.indexOf("/");
    if (slash === -1) {
      pkgName = after;
      rest = "";
    } else {
      pkgName = after.slice(0, slash);
      rest = after.slice(slash + 1);
    }
  }

  const pkg = packageMap.byName.get(pkgName);
  if (pkg === undefined) return null;

  return resolveNative(repoRoot, pkg.root, rest);
}

export function makeParseConfigHost(
  opts: MakeParseConfigHostOptions,
): ts.ParseConfigHost {
  const { repoRoot, packageMap } = opts;
  const sys = ts.sys;

  const tryRewrite = (path: string): string | null => {
    if (packageMap === undefined) return null;
    const rewritten = rewriteWorkspaceExtends(path, repoRoot, packageMap);
    if (rewritten === null) return null;
    if (rewritten === path) return null;
    return rewritten;
  };

  return {
    useCaseSensitiveFileNames: sys.useCaseSensitiveFileNames,
    readDirectory: (root, exts, excludes, includes, depth) =>
      sys.readDirectory(root, exts, excludes, includes, depth),
    fileExists: (path) => {
      const rewritten = tryRewrite(path);
      if (rewritten !== null && sys.fileExists(rewritten)) return true;
      return sys.fileExists(path);
    },
    readFile: (path) => {
      const rewritten = tryRewrite(path);
      if (rewritten !== null) {
        const data = sys.readFile(rewritten);
        if (data !== undefined) return data;
      }
      return sys.readFile(path);
    },
  };
}
