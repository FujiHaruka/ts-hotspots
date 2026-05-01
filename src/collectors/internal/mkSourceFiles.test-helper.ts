import type { SourceFileInfo } from "../../loader/types.ts";
import { parseSource } from "../../parser/parseSource.ts";

/**
 * Build `SourceFileInfo[]` for collector tests from a `path → content` map.
 * Keys are used both as the project-relative `path` and as the parser's
 * `fileName` (so script kind is derived from the `.ts` / `.tsx` suffix).
 */
export function mkSourceFiles(
  files: Record<string, string>,
): SourceFileInfo[] {
  const out: SourceFileInfo[] = [];
  for (const [path, content] of Object.entries(files)) {
    const { sourceFile } = parseSource(path, content);
    out.push({ path, sourceFile });
  }
  return out;
}
