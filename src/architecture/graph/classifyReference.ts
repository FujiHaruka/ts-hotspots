/**
 * Decide which {@link EdgeKind} an identifier reference produces, given
 * only its AST context. Pure (no graph or import context required) and
 * shared between the property-access (namespace) and direct-identifier
 * code paths.
 *
 * Hierarchy (first match wins):
 *
 * 1. Inside a type node (`TypeReferenceNode`, `QualifiedName`, etc.) →
 *    `type`. This also covers type-arguments inside `extends Foo<Bar>`,
 *    where `Bar` would otherwise look like part of the heritage clause.
 * 2. Direct expression of `extends` / `implements` heritage clause →
 *    `extends` (class) / `implements` (class) / `type` (interface).
 * 3. The `.expression` of a `NewExpression` → `new`.
 * 4. Anything else → `value`.
 */

import ts from "typescript";
import type { EdgeKind } from "./types.ts";

/**
 * `refTop` is the "outermost wrapper" of the reference: the identifier
 * itself for plain references, or the surrounding `PropertyAccessExpression`
 * / `QualifiedName` for namespace-style references like `ns.Foo`.
 */
export function classifyReference(refTop: ts.Node): EdgeKind {
  const parent = refTop.parent;
  // Heritage clauses are checked *before* the type-position fallback:
  // TypeScript's `ts.isPartOfTypeNode` returns true for the
  // `ExpressionWithTypeArguments` inside `class X implements Y` (and
  // for some interface heritage cases), which would mask the
  // `extends` / `implements` distinction we want.
  if (parent !== undefined) {
    if (ts.isNewExpression(parent) && parent.expression === refTop) {
      return "new";
    }
    if (
      ts.isExpressionWithTypeArguments(parent) &&
      parent.expression === refTop
    ) {
      const heritage = parent.parent;
      if (ts.isHeritageClause(heritage)) {
        const decl = heritage.parent;
        if (ts.isClassDeclaration(decl) || ts.isClassExpression(decl)) {
          if (heritage.token === ts.SyntaxKind.ExtendsKeyword) return "extends";
          if (heritage.token === ts.SyntaxKind.ImplementsKeyword) {
            return "implements";
          }
        }
        // Interface extends is a type-level relationship. Use the lower
        // type weight rather than coining a new edge kind for it.
        if (ts.isInterfaceDeclaration(decl)) return "type";
      }
    }
  }

  if (ts.isPartOfTypeNode(refTop)) return "type";
  return "value";
}
