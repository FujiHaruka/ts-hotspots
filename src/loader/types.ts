import type ts from "typescript";

/**
 * One TypeScript source file that has been read off disk and parsed via
 * `ts.createSourceFile`.
 *
 * `path` is project-relative, POSIX-normalized (matching the relative path
 * supplied by `listRepoSources`). `sourceFile` is the parsed AST root.
 */
export interface SourceFileInfo {
  path: string;
  sourceFile: ts.SourceFile;
}
