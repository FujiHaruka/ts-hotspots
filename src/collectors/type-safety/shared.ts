import { type Node, type Project, SyntaxKind, type ts } from "ts-morph";
import type { FunctionLikeNode } from "../types.ts";

export interface UnderlyingChecker {
  isTypeAssignableTo(source: ts.Type, target: ts.Type): boolean;
}

export const TS_IGNORE_RE = /@ts-ignore\b/;
export const TS_EXPECT_ERROR_RE = /@ts-expect-error\b/;
export const TS_NOCHECK_RE = /@ts-nocheck\b/;

export function getFunctionBody(node: FunctionLikeNode): Node | undefined {
  if (node.getKind() === SyntaxKind.ArrowFunction) {
    return node.asKindOrThrow(SyntaxKind.ArrowFunction).getBody();
  }
  return (node as unknown as { getBody(): Node | undefined }).getBody();
}

export function getFunctionReturnTypeNode(
  node: FunctionLikeNode,
): Node | undefined {
  const accessor = node as unknown as {
    getReturnTypeNode?: () => Node | undefined;
  };
  if (typeof accessor.getReturnTypeNode === "function") {
    return accessor.getReturnTypeNode();
  }
  return undefined;
}

export function countAnyKeywordIn(typeNode: Node): number {
  let n = 0;
  const visit = (node: Node): void => {
    if (node.getKind() === SyntaxKind.AnyKeyword) n += 1;
    for (const child of node.getChildren()) visit(child);
  };
  visit(typeNode);
  return n;
}

export function hasNoTypeAnnotation(node: Node): boolean {
  const accessor = node as unknown as {
    getTypeNode?: () => Node | undefined;
  };
  if (typeof accessor.getTypeNode !== "function") return false;
  return accessor.getTypeNode() === undefined;
}

export function nodeTypeIsAny(node: Node): boolean {
  try {
    return node.getType().isAny();
  } catch {
    return false;
  }
}

export function isAssertionKind(kind: SyntaxKind): boolean {
  return (
    kind === SyntaxKind.AsExpression ||
    kind === SyntaxKind.TypeAssertionExpression
  );
}

export function isConstAssertion(assertion: Node): boolean {
  const typeNode = (
    assertion as unknown as { getTypeNode(): Node | undefined }
  ).getTypeNode();
  if (!typeNode) return false;
  if (typeNode.getKind() !== SyntaxKind.TypeReference) return false;
  return typeNode.getText() === "const";
}

export function isEmptyLiteralAssertion(assertion: Node): boolean {
  const expr = (
    assertion as unknown as { getExpression(): Node }
  ).getExpression();
  const kind = expr.getKind();
  if (kind === SyntaxKind.ObjectLiteralExpression) {
    const props = (
      expr as unknown as { getProperties(): readonly Node[] }
    ).getProperties();
    return props.length === 0;
  }
  if (kind === SyntaxKind.ArrayLiteralExpression) {
    const elements = (
      expr as unknown as { getElements(): readonly Node[] }
    ).getElements();
    return elements.length === 0;
  }
  return false;
}

export function getUnderlyingChecker(project: Project): UnderlyingChecker {
  return project.getTypeChecker()
    .compilerObject as unknown as UnderlyingChecker;
}

export function isUnsafeCast(
  assertion: Node,
  checker: UnderlyingChecker,
): boolean {
  const expr = (
    assertion as unknown as { getExpression(): Node }
  ).getExpression();

  let fromType: ts.Type;
  let toType: ts.Type;
  try {
    fromType = expr.getType().compilerType;
    toType = (
      assertion as unknown as { getType(): { compilerType: ts.Type } }
    ).getType().compilerType;
  } catch {
    return false;
  }

  try {
    if (checker.isTypeAssignableTo(fromType, toType)) return false;
    if (checker.isTypeAssignableTo(toType, fromType)) return false;
  } catch {
    return false;
  }
  return true;
}
