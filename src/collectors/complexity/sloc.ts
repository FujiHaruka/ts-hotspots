import type {
  Collector,
  CollectorContext,
  DeclarationId,
  FunctionLikeNode,
} from "../types.ts";

export interface SlocResult {
  sloc: number;
}

export function computeSloc(node: FunctionLikeNode): number {
  const sourceFile = node.getSourceFile();
  const fullText = sourceFile.getFullText();
  const lines = fullText.split("\n");
  const startLine = node.getStartLineNumber();
  const endLine = node.getEndLineNumber();

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

export const slocCollector: Collector<SlocResult> = {
  name: "sloc",
  collect(ctx: CollectorContext): Map<DeclarationId, SlocResult> {
    const result = new Map<DeclarationId, SlocResult>();
    for (const decl of ctx.declarations) {
      try {
        result.set(decl.id, { sloc: computeSloc(decl.node) });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `slocCollector failed at ${decl.file}:${String(decl.line)} (${decl.id}): ${msg}`,
          { cause: err },
        );
      }
    }
    return result;
  },
};
