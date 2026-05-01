import ts from "typescript";
import type { FunctionLikeNode } from "./types.ts";

export function getFunctionBody(
  node: FunctionLikeNode,
): ts.Node | undefined {
  if (node.kind === ts.SyntaxKind.ArrowFunction) {
    return (node as ts.ArrowFunction).body;
  }
  return (node as Exclude<FunctionLikeNode, ts.ArrowFunction>).body;
}

const NESTED_FUNCTION_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.Constructor,
]);

/**
 * Walk the AST under `body` (inclusive), invoking `visit` on every node, but
 * **stop descending** once a nested function-like declaration is encountered
 * — those are scored standalone by their own collector pass.
 */
export function walkBodyExcludingNestedFunctions(
  body: ts.Node,
  visit: (node: ts.Node) => void,
): void {
  walk(body, visit, true);
}

function walk(
  node: ts.Node,
  visit: (node: ts.Node) => void,
  isRoot: boolean,
): void {
  if (!isRoot && NESTED_FUNCTION_KINDS.has(node.kind)) {
    return;
  }
  visit(node);
  ts.forEachChild(node, (child) => {
    walk(child, visit, false);
  });
}
