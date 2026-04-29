import ts from "typescript";

export interface ParsedSource {
  readonly filePath: string;
  readonly sourceFile: ts.SourceFile;
}

/**
 * Parse a single TypeScript source into a `ts.SourceFile`.
 *
 * The script kind is derived from the file extension:
 * - `.tsx` → `ScriptKind.TSX`
 * - `.ts` / `.mts` / `.cts` / anything else → `ScriptKind.TS`
 *
 * v1 is syntax-only; no `ts.Program` / type checker is needed.
 */
export function parseSource(filePath: string, text: string): ParsedSource {
  const scriptKind = detectScriptKind(filePath);
  const sourceFile = ts.createSourceFile(
    filePath,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind,
  );
  return { filePath, sourceFile };
}

function detectScriptKind(filePath: string): ts.ScriptKind {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx")) {
    return ts.ScriptKind.TSX;
  }
  return ts.ScriptKind.TS;
}
