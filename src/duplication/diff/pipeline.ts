import type { ChangedFile, Fragment } from "../domain/index.ts";
import { collectDiff, type DiffRequest } from "./collectDiff.ts";
import { extractChangedFragments } from "./extractChangedFragments.ts";
import { resolveDiffEndpoints } from "./gitRunner.ts";

interface CollectChangedFragmentsResult {
  baseSha: string;
  headSha: string;
  files: ChangedFile[];
  fragmentsByFile: Map<string, Fragment[]>;
  /**
   * `.ts` / `.tsx` files in the diff that matched `config.exclude.globs`
   * and were dropped before fragment extraction.
   */
  excludedFiles: number;
}

/**
 * End-to-end wiring: resolve base/head shas (honouring three-dot semantics),
 * collect the diff, and emit the union of changed fragments per file.
 *
 * The resolved shas are returned alongside so downstream report generation
 * can record which commits were compared (even when no TypeScript files
 * changed).
 */
export async function collectChangedFragments(
  req: DiffRequest,
): Promise<CollectChangedFragmentsResult> {
  const { baseSha, headSha } = await resolveDiffEndpoints(
    req.repoPath,
    req.baseRef,
    req.headRef,
    req.threeDot,
  );

  const { files, excludedCount } = await collectDiff(req);
  const fragmentsByFile = new Map<string, Fragment[]>();
  for (const file of files) {
    const frags = extractChangedFragments(file, req.config);
    fragmentsByFile.set(file.filePath, frags);
  }

  return {
    baseSha,
    headSha,
    files,
    fragmentsByFile,
    excludedFiles: excludedCount,
  };
}
