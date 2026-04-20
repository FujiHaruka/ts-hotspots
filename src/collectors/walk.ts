import { type Node, SyntaxKind } from "ts-morph";

const NESTED_FUNCTION_KINDS = new Set<SyntaxKind>([
  SyntaxKind.FunctionDeclaration,
  SyntaxKind.MethodDeclaration,
  SyntaxKind.ArrowFunction,
  SyntaxKind.FunctionExpression,
  SyntaxKind.GetAccessor,
  SyntaxKind.SetAccessor,
  SyntaxKind.Constructor,
]);

export function walkBodyExcludingNestedFunctions(
  body: Node,
  visit: (node: Node) => void,
): void {
  walk(body, visit, true);
}

function walk(node: Node, visit: (node: Node) => void, isRoot: boolean): void {
  if (!isRoot && NESTED_FUNCTION_KINDS.has(node.getKind())) {
    return;
  }
  visit(node);
  for (const child of node.getChildren()) {
    walk(child, visit, false);
  }
}
