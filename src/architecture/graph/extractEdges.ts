/**
 * Walk a single LocalExport's declaration subtree, find every
 * identifier reference that resolves to one of the file's import
 * bindings, and emit raw edge facts.
 *
 * "Raw" because the target component is identified by `(moduleSpecifier,
 * remoteName)` here — the actual cross-file resolution to a canonical
 * component id (chasing barrels, picking the right kind) happens once
 * in {@link buildGraph}, where the full file index is available.
 *
 * Reference detection is name-based: if an identifier in the export's
 * subtree shares a name with an import binding, it counts as a use. We
 * do not do scope analysis, so a local parameter/variable named after
 * an imported binding will produce a false-positive edge — accepted by
 * the project's recall-over-precision posture.
 *
 * Three identifier shapes are handled explicitly:
 *
 * - Plain identifier `foo` → use `foo`'s binding directly.
 * - Property access `ns.foo` (runtime) where `ns` is a namespace import
 *   → look up `foo` on `ns`'s module.
 * - Qualified name `ns.Foo` (type position) where `ns` is a namespace
 *   import → look up `Foo` on `ns`'s module, type kind.
 *
 * Identifier *declaration* positions (function/class/parameter/variable
 * names, property names in object literals, etc.) are excluded so that
 * a re-declaration of an import name does not feed back into the graph.
 *
 * Dynamic `import('./foo')` calls with a string-literal argument are
 * emitted with `remoteName === DYNAMIC_FANOUT` to signal that
 * {@link buildGraph} should expand the edge to every component in the
 * resolved file (uncertain = true). Dynamic imports with non-literal
 * arguments are skipped in v1.
 */

import ts from "typescript";
import { classifyReference } from "./classifyReference.ts";
import type { ImportBinding } from "./extractImports.ts";
import type { EdgeKind } from "./types.ts";

/**
 * Sentinel value for {@link RawEdge.remoteName} that tells
 * {@link buildGraph} to fan out across every export of the resolved
 * target file. Used for dynamic imports (`import('./foo')`).
 */
export const DYNAMIC_FANOUT = "*";

interface RawEdge {
  /** Module specifier the import came from (verbatim). */
  readonly moduleSpecifier: string;
  /** Name to look up on the resolved file, or {@link DYNAMIC_FANOUT}. */
  readonly remoteName: string;
  readonly kind: EdgeKind;
  readonly uncertain: boolean;
}

export function extractEdges(
  declarationNode: ts.Node,
  importsByLocal: ReadonlyMap<string, ImportBinding>,
): RawEdge[] {
  const edges: RawEdge[] = [];

  const visit = (node: ts.Node): void => {
    // Dynamic import: `import('./foo')`. Only string-literal arguments
    // are statically resolvable; other shapes (`import(expr)`) are
    // intentionally dropped — flagging them would require a target we
    // cannot pin, and "every file" would dominate the graph.
    //
    // `ts.isImportCall` is non-public in this TS version; the public
    // shape is "CallExpression whose .expression is an ImportKeyword
    // token" — that is what `import()` parses into.
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword
    ) {
      const arg = node.arguments[0];
      if (arg !== undefined && ts.isStringLiteral(arg)) {
        edges.push({
          moduleSpecifier: arg.text,
          remoteName: DYNAMIC_FANOUT,
          kind: "dynamic",
          uncertain: true,
        });
      }
    }

    if (ts.isIdentifier(node) && !isDeclarationName(node)) {
      const binding = importsByLocal.get(node.text);
      if (binding !== undefined) {
        const edge = makeEdgeForBinding(node, binding);
        if (edge !== null) edges.push(edge);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(declarationNode);
  return edges;
}

function makeEdgeForBinding(
  idNode: ts.Identifier,
  binding: ImportBinding,
): RawEdge | null {
  if (binding.kind === "namespace") {
    const access = readNamespaceAccess(idNode);
    if (access === null) {
      // `ns` referenced bare — passing the whole namespace as a value.
      // Without a property name we cannot pin the edge to a specific
      // export; skip in v1 (could become an "all of ns" edge later).
      return null;
    }
    let kind = classifyReference(access.refTop);
    if (binding.isTypeOnly) kind = "type";
    return {
      moduleSpecifier: binding.moduleSpecifier,
      remoteName: access.propertyName,
      kind,
      uncertain: false,
    };
  }

  // Named or default import.
  let kind = classifyReference(idNode);
  if (binding.isTypeOnly) kind = "type";
  return {
    moduleSpecifier: binding.moduleSpecifier,
    remoteName: binding.remoteName,
    kind,
    uncertain: false,
  };
}

interface NamespaceAccess {
  readonly refTop: ts.Node;
  readonly propertyName: string;
}

function readNamespaceAccess(idNode: ts.Identifier): NamespaceAccess | null {
  const parent = idNode.parent;
  if (parent === undefined) return null;
  if (
    ts.isPropertyAccessExpression(parent) &&
    parent.expression === idNode &&
    ts.isIdentifier(parent.name)
  ) {
    return { refTop: parent, propertyName: parent.name.text };
  }
  if (ts.isQualifiedName(parent) && parent.left === idNode) {
    return { refTop: parent, propertyName: parent.right.text };
  }
  return null;
}

/**
 * Conservative declaration-name filter. Catches the common cases where
 * an identifier *binds* a name rather than referring to one:
 *
 * - function / class / method / parameter / variable / property names
 * - type alias / interface / enum names
 * - import / export specifier names (already handled at the import-extraction
 *   layer, but re-checked here for safety)
 * - object literal property keys
 *
 * False negatives here turn into spurious self-edges; false positives
 * here only suppress edges that would have been valid. Both are
 * tolerable.
 */
function isDeclarationName(idNode: ts.Identifier): boolean {
  const parent = idNode.parent;
  if (parent === undefined) return false;

  // Right-hand-side of a property access (`obj.foo` — `foo` here)
  if (
    ts.isPropertyAccessExpression(parent) &&
    parent.name === idNode &&
    parent.expression !== idNode
  ) {
    return true;
  }
  // Right-hand-side of a qualified type name
  if (ts.isQualifiedName(parent) && parent.right === idNode) {
    return true;
  }
  // Object literal key, parameter, etc. all expose `.name` on the parent.
  // Conservative cover: any "named declaration" parent whose `.name` IS
  // this identifier is a declaration site.
  if ("name" in parent && (parent as { name?: ts.Node }).name === idNode) {
    if (
      ts.isFunctionDeclaration(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isClassExpression(parent) ||
      ts.isMethodDeclaration(parent) ||
      ts.isMethodSignature(parent) ||
      ts.isPropertyDeclaration(parent) ||
      ts.isPropertySignature(parent) ||
      ts.isPropertyAssignment(parent) ||
      ts.isShorthandPropertyAssignment(parent) ||
      ts.isParameter(parent) ||
      ts.isVariableDeclaration(parent) ||
      ts.isBindingElement(parent) ||
      ts.isTypeAliasDeclaration(parent) ||
      ts.isInterfaceDeclaration(parent) ||
      ts.isEnumDeclaration(parent) ||
      ts.isEnumMember(parent) ||
      ts.isFunctionExpression(parent) ||
      ts.isArrowFunction(parent) ||
      ts.isImportSpecifier(parent) ||
      ts.isImportClause(parent) ||
      ts.isNamespaceImport(parent) ||
      ts.isExportSpecifier(parent) ||
      ts.isTypeParameterDeclaration(parent) ||
      ts.isLabeledStatement(parent)
    ) {
      return true;
    }
  }
  return false;
}
