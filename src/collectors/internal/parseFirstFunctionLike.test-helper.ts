import ts from "typescript";
import { parseSource } from "../../parser/parseSource.ts";
import type { FunctionLikeTsNode } from "../types.ts";

const FUNCTION_LIKE_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.Constructor,
]);

export interface ParsedFunctionLike {
  sourceFile: ts.SourceFile;
  fn: FunctionLikeTsNode;
}

/**
 * Parse `text` and return the first function-like declaration encountered in
 * source-order (depth-first). Used by collector tests to replace the prior
 * ts-morph `Project + sf.getFunctions()[0]` pattern.
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
): { sourceFile: ts.SourceFile; fns: FunctionLikeTsNode[] } {
  const { sourceFile } = parseSource(`/proj/t${ext}`, text);
  const fns: FunctionLikeTsNode[] = [];
  const visit = (node: ts.Node): void => {
    if (FUNCTION_LIKE_KINDS.has(node.kind)) {
      fns.push(node as FunctionLikeTsNode);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { sourceFile, fns };
}

function findFirst(node: ts.Node): FunctionLikeTsNode | undefined {
  if (FUNCTION_LIKE_KINDS.has(node.kind)) {
    return node as FunctionLikeTsNode;
  }
  let found: FunctionLikeTsNode | undefined;
  ts.forEachChild(node, (child) => {
    if (found) return;
    found = findFirst(child);
  });
  return found;
}
