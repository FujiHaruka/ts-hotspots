import ts from "typescript";
import { parseSource } from "../../parser/parseSource.ts";
import type { FunctionLikeNode } from "../types.ts";

const FUNCTION_LIKE_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.Constructor,
]);

interface ParsedFunctionLike {
  sourceFile: ts.SourceFile;
  fn: FunctionLikeNode;
}

/**
 * Parse `text` and return the first function-like declaration encountered in
 * source-order (depth-first).
 */
export function parseFirstFunctionLike(
  text: string,
  ext: ".ts" | ".tsx" = ".ts",
): ParsedFunctionLike {
  const { sourceFile } = parseSource(`/proj/t${ext}`, text);
  const fn = findFirst(sourceFile);
  if (!fn) throw new Error("no function-like declaration in source");
  return { sourceFile, fn };
}

/**
 * Parse `text` and return all function-like declarations in source-order
 * (depth-first). Useful for fixtures with nested or sibling functions.
 */
export function parseAllFunctionLikes(
  text: string,
  ext: ".ts" | ".tsx" = ".ts",
): { sourceFile: ts.SourceFile; fns: FunctionLikeNode[] } {
  const { sourceFile } = parseSource(`/proj/t${ext}`, text);
  const fns: FunctionLikeNode[] = [];
  const visit = (node: ts.Node): void => {
    if (FUNCTION_LIKE_KINDS.has(node.kind)) {
      fns.push(node as FunctionLikeNode);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { sourceFile, fns };
}

function findFirst(node: ts.Node): FunctionLikeNode | undefined {
  if (FUNCTION_LIKE_KINDS.has(node.kind)) {
    return node as FunctionLikeNode;
  }
  let found: FunctionLikeNode | undefined;
  ts.forEachChild(node, (child) => {
    if (found) return;
    found = findFirst(child);
  });
  return found;
}
