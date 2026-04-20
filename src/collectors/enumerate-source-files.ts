import { isAbsolute, relative, resolve, sep } from "node:path";
import { Minimatch } from "minimatch";
import type { Project, SourceFile } from "ts-morph";

export interface SourceFileInfo {
  path: string;
  sourceFile: SourceFile;
}

export interface EnumerateSourceFilesOptions {
  exclude?: readonly string[];
}

const SOURCE_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts"];

export function enumerateSourceFiles(
  project: Project,
  rootDir: string,
  options: EnumerateSourceFilesOptions = {},
): SourceFileInfo[] {
  const resolvedRoot = resolve(rootDir);
  const matchers = (options.exclude ?? []).map(
    (p) => new Minimatch(p, { dot: true }),
  );
  const result: SourceFileInfo[] = [];

  for (const sourceFile of project.getSourceFiles()) {
    if (sourceFile.isDeclarationFile()) continue;
    const filePath = sourceFile.getFilePath();
    if (!SOURCE_EXTENSIONS.some((ext) => filePath.endsWith(ext))) continue;
    if (filePath.includes("/node_modules/")) continue;

    const rel = relative(resolvedRoot, filePath);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) continue;
    const relPosix = sep === "/" ? rel : rel.split(sep).join("/");

    if (matchers.some((m) => m.match(relPosix))) continue;

    result.push({ path: relPosix, sourceFile });
  }

  return result;
}
