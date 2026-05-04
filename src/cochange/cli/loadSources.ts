/**
 * Source loader for the cochange pipeline.
 *
 * Cochange does not parse files — only the path set is needed (the walk
 * intersects every commit's touched-file set against this set). So this
 * is a thin wrapper over `listRepoSources` that returns repo-relative
 * POSIX paths in lex order. Mirrors `src/architecture/cli/loadSources.ts`'s
 * working-tree branch but skips the file-read step entirely.
 */

import { listRepoSources } from "../../loader/listRepoSources.ts";

interface LoadCochangeSourcesOptions {
  rootDir: string;
  excludeGlobs: readonly string[];
}

export async function loadCochangeSources(
  opts: LoadCochangeSourcesOptions,
): Promise<string[]> {
  const sources = await listRepoSources(opts.rootDir, {
    exclude: opts.excludeGlobs,
  });
  return sources.map((s) => s.relative);
}
