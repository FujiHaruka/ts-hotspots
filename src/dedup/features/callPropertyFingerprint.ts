import ts from "typescript";
import type { Fragment } from "../domain/fragment.ts";
import type { FeatureKey } from "../domain/feature.ts";
import { leftmostIdentifierText } from "./internal/expressionText.ts";
import {
  type LocatedFragment,
  locateFragmentNode,
} from "./internal/locateFragmentNode.ts";

/**
 * Build call / property-access fingerprint feature keys for a fragment.
 *
 * The extractor walks the fragment's AST subtree(s) and emits one key per
 * visited call, property reference, element access, or `new` expression:
 *
 * - `foo(...)` → `call:CALL:foo`
 * - `a.b.c()` → `call:CALL:a.c` (leftmost identifier + final property)
 * - `await client.get()` → `call:AWAIT_CALL:client.get`
 * - `new UserRepo()` → `call:NEW:UserRepo`
 * - `response.status` (read) → `call:PROP:response.status`
 * - `obj["key"]` → `call:PROP:obj.key`
 * - `obj[i]` → `call:PROP:obj.*`
 *
 * Duplicates are kept as bag semantics matter for later scoring.
 */
export function buildCallPropertyFingerprints(
  fragment: Fragment,
  sourceFile: ts.SourceFile,
): FeatureKey[] {
  return buildCallPropertyFingerprintsFromLocated(
    locateFragmentNode(fragment, sourceFile),
  );
}

/**
 * Fast-path variant for callers that have already located the fragment node.
 */
export function buildCallPropertyFingerprintsFromLocated(
  located: LocatedFragment,
): FeatureKey[] {
  if (located.nodes.length === 0) {
    return [];
  }

  const out: FeatureKey[] = [];
  const subjectNodes = new Set<ts.Node>();

  const visit = (node: ts.Node): void => {
    // First mark the immediate callee of a call/new so we don't also emit
    // a PROP key for it later.
    if (ts.isCallExpression(node)) {
      markSubject(node.expression, subjectNodes);
    }
    if (ts.isNewExpression(node)) {
      markSubject(node.expression, subjectNodes);
    }

    emitForNode(node, out, subjectNodes);
    ts.forEachChild(node, visit);
  };

  for (const n of located.nodes) {
    visit(n);
  }

  return out;
}

function markSubject(expr: ts.Expression, subjects: Set<ts.Node>): void {
  // Unwrap transparent wrappers so the innermost property access marked
  // as a call-subject is also tracked.
  let cur: ts.Expression = expr;
  for (;;) {
    subjects.add(cur);
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
}

function emitForNode(
  node: ts.Node,
  out: FeatureKey[],
  subjects: Set<ts.Node>,
): void {
  if (ts.isCallExpression(node)) {
    const fp = callFingerprint(node);
    if (fp !== undefined) {
      out.push(`call:${fp}`);
    }
    return;
  }
  if (ts.isNewExpression(node)) {
    const name = finalNameOf(node.expression);
    if (name !== undefined) {
      out.push(`call:NEW:${name}`);
    }
    return;
  }
  if (ts.isPropertyAccessExpression(node)) {
    if (subjects.has(node)) {
      return;
    }
    const lhs = leftmostIdentifierText(node.expression);
    const name = node.name.text;
    out.push(`call:PROP:${lhs}.${name}`);
    return;
  }
  if (ts.isElementAccessExpression(node)) {
    if (subjects.has(node)) {
      return;
    }
    const lhs = leftmostIdentifierText(node.expression);
    const key = elementKeyOf(node.argumentExpression);
    out.push(`call:PROP:${lhs}.${key}`);
    return;
  }
}

function callFingerprint(call: ts.CallExpression): string | undefined {
  const awaited = hasAwaitParent(call);
  const prefix = awaited ? "AWAIT_CALL" : "CALL";

  const callee = unwrap(call.expression);
  if (ts.isIdentifier(callee) || ts.isPrivateIdentifier(callee)) {
    return `${prefix}:${callee.text}`;
  }
  if (ts.isPropertyAccessExpression(callee)) {
    const lhs = leftmostIdentifierText(callee.expression);
    return `${prefix}:${lhs}.${callee.name.text}`;
  }
  if (ts.isElementAccessExpression(callee)) {
    const lhs = leftmostIdentifierText(callee.expression);
    const key = elementKeyOf(callee.argumentExpression);
    return `${prefix}:${lhs}.${key}`;
  }
  if (callee.kind === ts.SyntaxKind.ThisKeyword) {
    return `${prefix}:this`;
  }
  if (callee.kind === ts.SyntaxKind.SuperKeyword) {
    return `${prefix}:super`;
  }
  // Bare call of a complex expression — use `*` placeholder so shape stays
  // stable but content is opaque.
  return `${prefix}:*`;
}

function finalNameOf(expr: ts.Expression): string | undefined {
  const e = unwrap(expr);
  if (ts.isIdentifier(e) || ts.isPrivateIdentifier(e)) {
    return e.text;
  }
  if (ts.isPropertyAccessExpression(e)) {
    const lhs = leftmostIdentifierText(e.expression);
    return `${lhs}.${e.name.text}`;
  }
  if (ts.isElementAccessExpression(e)) {
    const lhs = leftmostIdentifierText(e.expression);
    const key = elementKeyOf(e.argumentExpression);
    return `${lhs}.${key}`;
  }
  if (e.kind === ts.SyntaxKind.ThisKeyword) {
    return "this";
  }
  if (e.kind === ts.SyntaxKind.SuperKeyword) {
    return "super";
  }
  return "*";
}

function elementKeyOf(arg: ts.Expression): string {
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) {
    return arg.text;
  }
  return "*";
}

function hasAwaitParent(node: ts.Node): boolean {
  // Walk up through transparent wrappers (parens, non-null, casts) so that
  // `await (client.get())` still registers as awaited.
  let p: ts.Node | undefined = node.parent as ts.Node | undefined;
  while (p !== undefined) {
    if (
      ts.isParenthesizedExpression(p) ||
      ts.isNonNullExpression(p) ||
      ts.isAsExpression(p) ||
      ts.isSatisfiesExpression(p) ||
      ts.isTypeAssertionExpression(p)
    ) {
      p = p.parent as ts.Node | undefined;
      continue;
    }
    return ts.isAwaitExpression(p);
  }
  return false;
}

function unwrap(expr: ts.Expression): ts.Expression {
  let cur: ts.Expression = expr;
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
  return cur;
}
