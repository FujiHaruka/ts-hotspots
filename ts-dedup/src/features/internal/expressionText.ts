import ts from "typescript";

/**
 * Return the "leftmost identifier" of a property/element access chain.
 *
 * - `a.b.c` → `a`
 * - `a[0].b` → `a`
 * - `this.foo` → `this`
 * - `super.foo` → `super`
 * - `foo()` → `foo`
 * - `foo().bar` → `foo`
 *
 * When the chain is rooted in something that isn't a bare name (complex
 * expression, literal, etc.), `*` is returned as an opaque placeholder so
 * that the fingerprint still has a stable shape.
 */
export function leftmostIdentifierText(expr: ts.Expression): string {
  let cur: ts.Expression = expr;
  // Unwrap parentheses, non-null assertions, satisfies / as casts — these
  // are transparent for fingerprint purposes.
  for (;;) {
    if (ts.isParenthesizedExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    if (ts.isNonNullExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    if (ts.isAsExpression(cur) || ts.isSatisfiesExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    if (ts.isTypeAssertionExpression(cur)) {
      cur = cur.expression;
      continue;
    }
    break;
  }

  if (ts.isPropertyAccessExpression(cur)) {
    return leftmostIdentifierText(cur.expression);
  }
  if (ts.isElementAccessExpression(cur)) {
    return leftmostIdentifierText(cur.expression);
  }
  if (ts.isCallExpression(cur)) {
    return leftmostIdentifierText(cur.expression);
  }
  if (ts.isNewExpression(cur)) {
    return leftmostIdentifierText(cur.expression);
  }
  if (ts.isIdentifier(cur) || ts.isPrivateIdentifier(cur)) {
    return cur.text;
  }
  if (cur.kind === ts.SyntaxKind.ThisKeyword) {
    return "this";
  }
  if (cur.kind === ts.SyntaxKind.SuperKeyword) {
    return "super";
  }
  return "*";
}
