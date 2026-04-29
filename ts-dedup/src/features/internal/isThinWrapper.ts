import ts from "typescript";
import type { Config } from "../../config/config.ts";
import type { Fragment } from "../../domain/fragment.ts";
import { locateFragmentNode } from "./locateFragmentNode.ts";

export type ThinWrapperConfig = Config["report"]["thinWrapper"];

/**
 * Decide whether a fragment is a "thin wrapper" — i.e. its body is just a
 * trivial prelude (a couple of `const x = call(...)` declarations) followed
 * by a single `return` of one named call / JSX / `new` expression.
 *
 * Thin wrappers are already DRYed against a shared component / helper, so
 * pairing two of them with each other produces a high-similarity report
 * candidate that has no actionable refactor suggestion. The report
 * pipeline uses this judgement to drop both-side thin-wrapper pairs.
 *
 * Pure on `(fragment, sourceFile, config)` — no side effects, no caching.
 * Callers should memoise per fragment id when they need to apply it
 * across many pairs.
 */
export function isThinWrapperFragment(
  fragment: Fragment,
  sourceFile: ts.SourceFile,
  config: ThinWrapperConfig,
): boolean {
  const located = locateFragmentNode(fragment, sourceFile);
  const stmts = located.directStatements;
  if (stmts.length === 0) {
    return false;
  }

  if (fragment.kind === "window" && stmts.length > config.maxBodyStatements) {
    return false;
  }

  let i = 0;
  while (
    i < stmts.length &&
    i < config.maxPreludeStatements &&
    isTrivialPreludeStatement(stmts[i])
  ) {
    i += 1;
  }

  if (stmts.length - i !== 1) {
    return false;
  }
  const last = stmts[i];
  if (last === undefined || !ts.isReturnStatement(last)) {
    return false;
  }
  const expr = last.expression;
  if (expr === undefined) {
    return false;
  }
  return isAllowedReturnExpression(expr);
}

function isTrivialPreludeStatement(node: ts.Node | undefined): boolean {
  if (node === undefined || !ts.isVariableStatement(node)) {
    return false;
  }
  const decls = node.declarationList.declarations;
  if (decls.length !== 1) {
    return false;
  }
  const init = decls[0]?.initializer;
  if (init === undefined) {
    return false;
  }
  return ts.isCallExpression(init);
}

function isAllowedReturnExpression(expr: ts.Expression): boolean {
  return (
    ts.isJsxElement(expr) ||
    ts.isJsxSelfClosingElement(expr) ||
    ts.isJsxFragment(expr) ||
    ts.isCallExpression(expr) ||
    ts.isNewExpression(expr)
  );
}
