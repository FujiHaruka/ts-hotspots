/**
 * Top-level orchestrator for the architecture subcommand's component
 * dependency graph.
 *
 * Pure function over in-memory sources: parse each input, collect
 * imports and exports per file, construct one {@link Component} per
 * local export, then for every export walk its declaration subtree and
 * resolve identifier references to canonical components — chasing
 * `export { foo } from './bar'` and `export *` re-exports through to
 * the original definition before recording an edge.
 *
 * Determinism: nodes are sorted by component id, edges by
 * `(from, to, kind, uncertain)`. Identical input — including input
 * order — produces bit-identical output.
 *
 * Resolution failures (target file not in `knownFiles`, name not found
 * after barrel-chase, dynamic import with non-literal specifier) are
 * silently dropped. Those are not analysis errors; they typically
 * indicate edges that leave the analysed source set (`react`,
 * `node:fs`, runtime config lookups).
 */

import { parseSource } from "../../parser/parseSource.ts";
import {
  type ResolveContext,
  resolveModule,
} from "../resolve/resolveModule.ts";
import type { TsconfigResolution } from "../resolve/tsconfigPaths.ts";
import { DYNAMIC_FANOUT, extractEdges } from "./extractEdges.ts";
import { extractExports, type FileExports } from "./extractExports.ts";
import { extractImports, type ImportBinding } from "./extractImports.ts";
import {
  type Component,
  type Edge,
  type ExportKind,
  type Graph,
  makeComponentId,
} from "./types.ts";

export interface SourceInput {
  /** Repo-relative POSIX path. Used verbatim for `Component.filePath`. */
  readonly path: string;
  readonly text: string;
}

interface BuildGraphOptions {
  readonly sources: readonly SourceInput[];
  /**
   * Preferred entry point. Bundles `tsconfig`, `packageMap`, and the
   * derived `knownFiles` set so resolution is consistent across the
   * top-level edge pass and barrel re-export chasing.
   */
  readonly resolveCtx?: Omit<ResolveContext, "knownFiles">;
  /**
   * @deprecated Pass via `resolveCtx.tsconfig` instead. Kept for one
   * release while callers migrate; will be removed in M3.
   */
  readonly tsconfig?: TsconfigResolution;
}

export function buildGraph(opts: BuildGraphOptions): Graph {
  const { sources } = opts;

  const knownFiles = new Set<string>();
  for (const s of sources) knownFiles.add(s.path);

  // oxlint-disable-next-line no-deprecated -- intentional fallback for the legacy tsconfig field; removed in M3
  const legacyTsconfig = opts.tsconfig;
  const ctx: ResolveContext = {
    knownFiles,
    tsconfig: opts.resolveCtx?.tsconfig ?? legacyTsconfig,
    packageMap: opts.resolveCtx?.packageMap,
  };

  const importsByPath = new Map<string, readonly ImportBinding[]>();
  const exportsByPath = new Map<string, FileExports>();
  const declarationsByPath = new Map<string, FileExports>();

  for (const s of sources) {
    const parsed = parseSource(s.path, s.text);
    importsByPath.set(s.path, extractImports(parsed));
    const fileExports = extractExports(parsed);
    exportsByPath.set(s.path, fileExports);
    declarationsByPath.set(s.path, fileExports);
  }

  const nodes: Component[] = [];
  for (const [filePath, fileExports] of exportsByPath) {
    for (const local of fileExports.local.values()) {
      nodes.push({
        id: makeComponentId(filePath, local.exportName, local.exportKind),
        filePath,
        exportName: local.exportName,
        exportKind: local.exportKind,
        line: local.line,
        endLine: local.endLine,
      });
    }
  }

  const resolveExportRef = makeExportResolver(exportsByPath, ctx);

  const edges: Edge[] = [];
  for (const [filePath, fileExports] of exportsByPath) {
    const imports = importsByPath.get(filePath) ?? [];
    const importsByLocal = new Map<string, ImportBinding>();
    for (const b of imports) importsByLocal.set(b.localName, b);

    for (const local of fileExports.local.values()) {
      const fromId = makeComponentId(
        filePath,
        local.exportName,
        local.exportKind,
      );
      const rawEdges = extractEdges(local.declarationNode, importsByLocal);
      for (const re of rawEdges) {
        const targetFile = resolveModule(re.moduleSpecifier, filePath, ctx);
        if (targetFile === null) continue;

        if (re.remoteName === DYNAMIC_FANOUT) {
          const targetExports = exportsByPath.get(targetFile);
          if (targetExports === undefined) continue;
          for (const tgt of targetExports.local.values()) {
            edges.push({
              from: fromId,
              to: makeComponentId(targetFile, tgt.exportName, tgt.exportKind),
              kind: "dynamic",
              uncertain: true,
            });
          }
          continue;
        }

        const canonical = resolveExportRef(targetFile, re.remoteName);
        if (canonical === null) continue;
        edges.push({
          from: fromId,
          to: canonical.id,
          kind: re.kind,
          uncertain: re.uncertain,
        });
      }
    }
  }

  nodes.sort((a, b) => compareStrings(a.id, b.id));
  edges.sort(compareEdges);

  return { nodes, edges };
}

/**
 * Plain code-point comparison. We deliberately do not use
 * `localeCompare` because its output depends on the platform's ICU
 * tables, and architecture's "bit-identical output for the same input"
 * invariant must hold across CI runners and developer machines.
 */
function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

interface CanonicalExport {
  readonly id: string;
  readonly filePath: string;
  readonly exportName: string;
  readonly exportKind: ExportKind;
}

/**
 * Build a "given file F and remote name N, find the original local
 * declaration" resolver. Chases:
 *
 * - `export { x } from './y'`            (named re-export)
 * - `export { x as y } from './z'`       (renaming named re-export)
 * - `export * from './w'`                (star re-export — tried in
 *                                         declared order)
 *
 * Cycles in re-export graphs (rare but possible during refactors) are
 * broken by tracking visited `(file, name)` pairs.
 */
function makeExportResolver(
  exportsByPath: ReadonlyMap<string, FileExports>,
  ctx: ResolveContext,
): (file: string, name: string) => CanonicalExport | null {
  const resolveOn = (
    file: string,
    name: string,
    visited: Set<string>,
  ): CanonicalExport | null => {
    const key = `${file}::${name}`;
    if (visited.has(key)) return null;
    visited.add(key);

    const fileExports = exportsByPath.get(file);
    if (fileExports === undefined) return null;

    const local = fileExports.local.get(name);
    if (local !== undefined) {
      return {
        id: makeComponentId(file, local.exportName, local.exportKind),
        filePath: file,
        exportName: local.exportName,
        exportKind: local.exportKind,
      };
    }

    const named = fileExports.namedReexports.get(name);
    if (named !== undefined) {
      const target = resolveModule(named.moduleSpecifier, file, ctx);
      if (target === null) return null;
      return resolveOn(target, named.remoteName, visited);
    }

    for (const star of fileExports.starReexports) {
      const target = resolveModule(star.moduleSpecifier, file, ctx);
      if (target === null) continue;
      const found = resolveOn(target, name, visited);
      if (found !== null) return found;
    }

    return null;
  };

  return (file, name) => resolveOn(file, name, new Set());
}

function compareEdges(a: Edge, b: Edge): number {
  const fromCmp = compareStrings(a.from, b.from);
  if (fromCmp !== 0) return fromCmp;
  const toCmp = compareStrings(a.to, b.to);
  if (toCmp !== 0) return toCmp;
  const kindCmp = compareStrings(a.kind, b.kind);
  if (kindCmp !== 0) return kindCmp;
  if (a.uncertain !== b.uncertain) return a.uncertain ? 1 : -1;
  return 0;
}
