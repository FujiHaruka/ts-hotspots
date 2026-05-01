/**
 * Identify the exports of a parsed source. Two kinds of records are
 * produced:
 *
 * - {@link LocalExport}: a real definition that becomes a graph node.
 *   Produced for `export function`, `export class`, `export const|let|var`,
 *   `export type`, `export interface`, `export enum`, the various
 *   `export default` shapes, and bare `export { foo }` clauses that
 *   re-export a locally declared symbol.
 *
 * - {@link NamedReexport} / {@link StarReexport}: an
 *   `export { foo } from './bar'` or `export * from './bar'` statement.
 *   These do **not** become nodes — barrel files are normalised away
 *   during edge construction. We still capture them so {@link buildGraph}
 *   can chase imports through them to the canonical definition.
 *
 * Algorithm: three passes over the top-level statements:
 *
 * 1. Index every top-level *declaration* by name (whether exported or
 *    not) — needed for pass 3 below.
 * 2. Walk each statement: declarations carrying an `export` modifier
 *    populate `local`; `export default …` and `export { … } from '…'`
 *    populate `local` / re-export tables directly.
 * 3. Bare `export { foo }` (no `from`) re-binds names from the file's
 *    local scope — resolve against the index from pass 1.
 *
 * Pass 1 is what lets us catch `const foo = 1; export { foo };` —
 * pattern that pass 2 alone misses because the const has no `export`
 * modifier.
 */

import ts from "typescript";
import type { ParsedSource } from "../../parser/parseSource.ts";
import { DEFAULT_EXPORT_NAME, type ExportKind } from "./types.ts";

export interface LocalExport {
  readonly exportName: string;
  readonly exportKind: ExportKind;
  /** 1-based line of the defining declaration. */
  readonly line: number;
  /** 1-based, inclusive end line of the declaration node. */
  readonly endLine: number;
  /**
   * The declaration node whose body is later scanned for references.
   * For `export const x = expr`, this is the VariableDeclaration; for
   * default exports of an expression, the ExportAssignment itself.
   */
  readonly declarationNode: ts.Node;
}

export interface NamedReexport {
  readonly exportName: string;
  readonly remoteName: string;
  readonly moduleSpecifier: string;
  readonly isTypeOnly: boolean;
}

export interface StarReexport {
  readonly moduleSpecifier: string;
  readonly isTypeOnly: boolean;
}

export interface FileExports {
  readonly local: ReadonlyMap<string, LocalExport>;
  readonly namedReexports: ReadonlyMap<string, NamedReexport>;
  readonly starReexports: readonly StarReexport[];
}

interface DeclIndexEntry {
  readonly exportKind: ExportKind;
  readonly line: number;
  readonly endLine: number;
  readonly declarationNode: ts.Node;
}

export function extractExports(parsed: ParsedSource): FileExports {
  const { sourceFile } = parsed;
  const local = new Map<string, LocalExport>();
  const namedReexports = new Map<string, NamedReexport>();
  const starReexports: StarReexport[] = [];

  // Pass 1 — index every top-level declaration by name.
  const declIndex = new Map<string, DeclIndexEntry>();
  for (const stmt of sourceFile.statements) {
    indexTopLevelDeclarations(stmt, sourceFile, declIndex);
  }

  // Pass 2 — declarations carrying `export` (with or without `default`),
  // standalone `export default …`, and `export { … } from '…'`.
  for (const stmt of sourceFile.statements) {
    visitExportingStatement(stmt, sourceFile, {
      local,
      namedReexports,
      starReexports,
    });
  }

  // Pass 3 — bare `export { foo }` / `export { bar as baz }` (no `from`)
  // promotes already-declared locals into the export set.
  for (const stmt of sourceFile.statements) {
    if (!ts.isExportDeclaration(stmt)) continue;
    if (stmt.moduleSpecifier !== undefined) continue;
    const exportClause = stmt.exportClause;
    if (exportClause === undefined) continue;
    if (!ts.isNamedExports(exportClause)) continue;
    for (const elem of exportClause.elements) {
      const exportName = elem.name.text;
      const localName =
        elem.propertyName !== undefined ? elem.propertyName.text : exportName;
      const indexed = declIndex.get(localName);
      if (indexed === undefined) continue;
      if (local.has(exportName)) continue; // already added via pass 2
      local.set(exportName, {
        exportName,
        exportKind: indexed.exportKind,
        line: indexed.line,
        endLine: indexed.endLine,
        declarationNode: indexed.declarationNode,
      });
    }
  }

  return { local, namedReexports, starReexports };
}

interface ExportSinks {
  local: Map<string, LocalExport>;
  namedReexports: Map<string, NamedReexport>;
  starReexports: StarReexport[];
}

function indexTopLevelDeclarations(
  stmt: ts.Statement,
  sourceFile: ts.SourceFile,
  index: Map<string, DeclIndexEntry>,
): void {
  if (ts.isFunctionDeclaration(stmt) && stmt.name !== undefined) {
    index.set(stmt.name.text, {
      exportKind: "function",
      line: lineOf(sourceFile, stmt),
      endLine: endLineOf(sourceFile, stmt),
      declarationNode: stmt,
    });
  } else if (ts.isClassDeclaration(stmt) && stmt.name !== undefined) {
    index.set(stmt.name.text, {
      exportKind: "class",
      line: lineOf(sourceFile, stmt),
      endLine: endLineOf(sourceFile, stmt),
      declarationNode: stmt,
    });
  } else if (ts.isVariableStatement(stmt)) {
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      index.set(decl.name.text, {
        exportKind: "const",
        line: lineOf(sourceFile, decl),
        endLine: endLineOf(sourceFile, decl),
        declarationNode: decl,
      });
    }
  } else if (ts.isTypeAliasDeclaration(stmt)) {
    index.set(stmt.name.text, {
      exportKind: "type",
      line: lineOf(sourceFile, stmt),
      endLine: endLineOf(sourceFile, stmt),
      declarationNode: stmt,
    });
  } else if (ts.isInterfaceDeclaration(stmt)) {
    index.set(stmt.name.text, {
      exportKind: "interface",
      line: lineOf(sourceFile, stmt),
      endLine: endLineOf(sourceFile, stmt),
      declarationNode: stmt,
    });
  } else if (ts.isEnumDeclaration(stmt)) {
    index.set(stmt.name.text, {
      exportKind: "enum",
      line: lineOf(sourceFile, stmt),
      endLine: endLineOf(sourceFile, stmt),
      declarationNode: stmt,
    });
  }
}

function visitExportingStatement(
  stmt: ts.Statement,
  sourceFile: ts.SourceFile,
  sinks: ExportSinks,
): void {
  // export {…} from '…'  /  export * from '…'  /  export * as ns from '…'
  if (ts.isExportDeclaration(stmt)) {
    if (stmt.moduleSpecifier === undefined) return;
    if (!ts.isStringLiteral(stmt.moduleSpecifier)) return;
    const moduleSpecifier = stmt.moduleSpecifier.text;
    const isTypeOnly = stmt.isTypeOnly;
    const clause = stmt.exportClause;
    if (clause === undefined) {
      sinks.starReexports.push({ moduleSpecifier, isTypeOnly });
      return;
    }
    if (ts.isNamespaceExport(clause)) {
      // `export * as ns from '…'`. v1 collapses it to a star — the
      // namespace alias only matters when an *importer* writes
      // `import { ns }` and then `ns.foo`, which the importer-side
      // namespace-import path already handles.
      sinks.starReexports.push({ moduleSpecifier, isTypeOnly });
      return;
    }
    for (const elem of clause.elements) {
      const exportName = elem.name.text;
      const remoteName =
        elem.propertyName !== undefined ? elem.propertyName.text : exportName;
      sinks.namedReexports.set(exportName, {
        exportName,
        remoteName,
        moduleSpecifier,
        isTypeOnly: isTypeOnly || elem.isTypeOnly,
      });
    }
    return;
  }

  // export default …
  if (ts.isExportAssignment(stmt)) {
    if (stmt.isExportEquals === true) return; // CJS `export = X`
    sinks.local.set(DEFAULT_EXPORT_NAME, {
      exportName: DEFAULT_EXPORT_NAME,
      exportKind: "default",
      line: lineOf(sourceFile, stmt),
      endLine: endLineOf(sourceFile, stmt),
      declarationNode: stmt,
    });
    return;
  }

  if (!hasExportModifier(stmt)) return;
  const isDefault = hasDefaultModifier(stmt);

  if (ts.isFunctionDeclaration(stmt) && stmt.name !== undefined) {
    addLocal(sinks.local, stmt.name.text, "function", stmt, sourceFile);
    if (isDefault) {
      sinks.local.set(DEFAULT_EXPORT_NAME, {
        exportName: DEFAULT_EXPORT_NAME,
        exportKind: "default",
        line: lineOf(sourceFile, stmt),
        endLine: endLineOf(sourceFile, stmt),
        declarationNode: stmt,
      });
    }
  } else if (ts.isClassDeclaration(stmt) && stmt.name !== undefined) {
    addLocal(sinks.local, stmt.name.text, "class", stmt, sourceFile);
    if (isDefault) {
      sinks.local.set(DEFAULT_EXPORT_NAME, {
        exportName: DEFAULT_EXPORT_NAME,
        exportKind: "default",
        line: lineOf(sourceFile, stmt),
        endLine: endLineOf(sourceFile, stmt),
        declarationNode: stmt,
      });
    }
  } else if (ts.isVariableStatement(stmt)) {
    for (const decl of stmt.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name)) continue;
      addLocal(sinks.local, decl.name.text, "const", decl, sourceFile);
    }
  } else if (ts.isTypeAliasDeclaration(stmt)) {
    addLocal(sinks.local, stmt.name.text, "type", stmt, sourceFile);
  } else if (ts.isInterfaceDeclaration(stmt)) {
    addLocal(sinks.local, stmt.name.text, "interface", stmt, sourceFile);
  } else if (ts.isEnumDeclaration(stmt)) {
    addLocal(sinks.local, stmt.name.text, "enum", stmt, sourceFile);
  }
}

function addLocal(
  sink: Map<string, LocalExport>,
  exportName: string,
  exportKind: ExportKind,
  declarationNode: ts.Node,
  sourceFile: ts.SourceFile,
): void {
  sink.set(exportName, {
    exportName,
    exportKind,
    line: lineOf(sourceFile, declarationNode),
    endLine: endLineOf(sourceFile, declarationNode),
    declarationNode,
  });
}

function hasExportModifier(stmt: ts.Statement): boolean {
  const modifiers = (stmt as ts.HasModifiers).modifiers;
  if (modifiers === undefined) return false;
  for (const m of modifiers) {
    if (m.kind === ts.SyntaxKind.ExportKeyword) return true;
  }
  return false;
}

function hasDefaultModifier(stmt: ts.Statement): boolean {
  const modifiers = (stmt as ts.HasModifiers).modifiers;
  if (modifiers === undefined) return false;
  for (const m of modifiers) {
    if (m.kind === ts.SyntaxKind.DefaultKeyword) return true;
  }
  return false;
}

function lineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile))
      .line + 1
  );
}

function endLineOf(sourceFile: ts.SourceFile, node: ts.Node): number {
  return (
    ts.getLineAndCharacterOfPosition(sourceFile, node.getEnd()).line + 1
  );
}
