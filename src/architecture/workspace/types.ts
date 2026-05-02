/**
 * Workspace-resolution types.
 *
 * `PackageInfo` represents one package detected in the repo (by
 * pnpm-workspace.yaml or package.json#workspaces). `PackageMap` indexes
 * those by package name and by repo-relative file path so the resolver
 * can answer "what package owns this file?" and "where does this
 * specifier point inside the workspace?" in O(1).
 *
 * `ExportsMap` is a normalised AST of `package.json#exports`: subpath
 * keys are kept in priority order (literals before wildcards, longest
 * literal prefix first), and conditional objects are flattened to a
 * priority-ordered list (default → import → node → types). The shape
 * is deliberately small — only enough to satisfy the lookups we do.
 */

export type ExportsTarget = ExportsLiteral | ExportsConditional;

export interface ExportsLiteral {
  readonly kind: "literal";
  /** Relative target string from package.json (starts with `./`). */
  readonly target: string;
}

export interface ExportsConditional {
  readonly kind: "conditional";
  /** Tried in priority order. */
  readonly conditions: readonly {
    readonly key: string;
    readonly target: ExportsTarget;
  }[];
}

export interface ExportsEntry {
  /** Subpath key as written in package.json — `"."` or `"./foo"` or `"./foo/*"`. */
  readonly subpath: string;
  /** True when the subpath contains a single `*` wildcard. */
  readonly isWildcard: boolean;
  readonly target: ExportsTarget;
}

export interface ExportsMap {
  /**
   * Entries are pre-sorted: non-wildcard subpaths first (longest first),
   * then wildcard subpaths (longest prefix first). Lookups linear-scan
   * and take the first match.
   */
  readonly entries: readonly ExportsEntry[];
}

export interface PackageInfo {
  /** Package name from `package.json#name` (e.g. `@scope/foo`). */
  readonly name: string;
  /** Repo-relative POSIX path to the package directory (e.g. `packages/foo`). */
  readonly root: string;
  /** Normalised `exports` map; `null` when the field is absent or unrecognised. */
  readonly exportsMap: ExportsMap | null;
  /** Repo-relative POSIX path to `main`'s target, or `null`. */
  readonly mainTarget: string | null;
  /** Repo-relative POSIX path to the package's `tsconfig.json`, or `null`. */
  readonly tsconfigPath: string | null;
  /**
   * Loaded tsconfig resolution data for the package, populated by
   * `buildPackageMap` after the package map's name index is built so
   * workspace `extends` chains can be rewritten. `null` when the
   * package has no tsconfig.
   */
  readonly tsconfig:
    | import("../resolve/tsconfigPaths.ts").TsconfigResolution
    | null;
}

export interface PackageMap {
  readonly byName: ReadonlyMap<string, PackageInfo>;
  /**
   * Resolve a repo-relative file path to its owning package via
   * longest-root-prefix match. Returns `undefined` for files that
   * sit outside every workspace package (e.g. root-level scripts).
   */
  readonly byFile: (file: string) => PackageInfo | undefined;
  /** All packages, sorted by `root` for deterministic enumeration. */
  readonly packages: readonly PackageInfo[];
}
