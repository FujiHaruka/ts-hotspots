import { readFileSync } from "node:fs";
import { parseSource } from "../parser/parseSource.ts";
import type { SourceFileInfo } from "./types.ts";

export interface LoadProjectSource {
  /** Absolute path on disk (used to read the file). */
  absolute: string;
  /** Project-relative path, POSIX-normalized (carried into `SourceFileInfo.path`). */
  relative: string;
}

export interface LoadProjectOptions {
  /**
   * Sources to read and parse. The caller (typically `listRepoSources`)
   * decides which files count — `loadProject` does not consult any tsconfig
   * and does not type-check.
   */
  sources: readonly LoadProjectSource[];
}

export interface LoadedProject {
  files: readonly SourceFileInfo[];
}

/**
 * Read each source off disk and parse it into a `ts.SourceFile`. Sources
 * that fail to read (e.g. deleted between `git ls-files` and now) are
 * silently skipped.
 */
export function loadProject(options: LoadProjectOptions): LoadedProject {
  const files: SourceFileInfo[] = [];
  for (const source of options.sources) {
    let text: string;
    try {
      text = readFileSync(source.absolute, "utf8");
    } catch {
      continue;
    }
    const { sourceFile } = parseSource(source.absolute, text);
    files.push({ path: source.relative, sourceFile });
  }
  return { files };
}
