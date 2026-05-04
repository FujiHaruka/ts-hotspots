import ts from "typescript";
import { makeCollector } from "../makeCollector.ts";
import type { FunctionLikeNode } from "../types.ts";

interface SlocResult {
  sloc: number;
}

export function computeSloc(
  node: FunctionLikeNode,
  sourceFile: ts.SourceFile,
): number {
  const fullText = sourceFile.text;
  const lines = fullText.split("\n");
  const startLine =
    ts.getLineAndCharacterOfPosition(sourceFile, node.getStart(sourceFile))
      .line + 1;
  const endLine =
    ts.getLineAndCharacterOfPosition(sourceFile, node.getEnd()).line + 1;

  // Extract the slice of lines covering the function span (1-indexed).
  const slice: string[] = [];
  for (let i = startLine; i <= endLine; i++) {
    const line = lines[i - 1];
    slice.push(line ?? "");
  }

  // Strip block comments (which may span multiple lines) by preserving newlines
  // so line counts stay aligned. Caveat: this is a pragmatic regex-based strip
  // that does NOT account for `/* */` or `//` occurring inside string/template
  // literals; such edge cases may be miscounted in v1.
  const joined = slice.join("\n");
  const withoutBlockComments = joined.replace(/\/\*[\s\S]*?\*\//g, (match) => {
    const newlines = match.match(/\n/g)?.length ?? 0;
    return "\n".repeat(newlines);
  });

  const strippedLines = withoutBlockComments.split("\n");
  let count = 0;
  for (const line of strippedLines) {
    const noLineComment = line.replace(/\/\/.*$/, "");
    if (noLineComment.trim().length > 0) count += 1;
  }
  return count;
}

export const slocCollector = makeCollector<SlocResult>({
  name: "sloc",
  compute: (decl) => ({ sloc: computeSloc(decl.node, decl.sourceFile) }),
});
