import type { Config } from "../config/index.ts";
import type { ChangedFile } from "../domain/index.ts";
import { gitDiff, gitShow, resolveDiffEndpoints } from "./gitRunner.ts";
import { matchesAnyGlob } from "./internal/globMatch.ts";
import { parseUnifiedDiff } from "./internal/parseUnifiedDiff.ts";

export interface DiffRequest {
  repoPath: string;
  baseRef: string;
  headRef: string;
  /**
   * `true` for `A...B` (PR semantics: base = merge-base(A, B)).
   * `false` for `A..B` (raw two-dot diff).
   */
  threeDot: boolean;
  config: Config;
}

interface CollectDiffResult {
  files: ChangedFile[];
  /**
   * Count of `.ts` / `.tsx` files in the diff that matched
   * `config.exclude.globs`. Files with non-TypeScript extensions or
   * deletion-only hunks are not counted here.
   */
  excludedCount: number;
}

/**
 * Collect all head-side changed files between `baseRef..headRef`.
 *
 * Filtering rules:
 *   1. Only `.ts` / `.tsx` files are kept (case-insensitive).
 *   2. Files matching any of `config.exclude.globs` are dropped.
 *   3. Deleted files have no head side and are skipped upstream by the diff
 *      parser.
 *   4. Hunks that are pure deletions (no head line range) are skipped by the
 *      diff parser. Files whose remaining hunks array is empty are dropped.
 *
 * The returned `files` array is sorted by `filePath` for determinism.
 * `excludedCount` reports how many `.ts`/`.tsx` files rule (2) dropped, so
 * the caller can surface that in the analysis summary.
 */
export async function collectDiff(
  req: DiffRequest,
): Promise<CollectDiffResult> {
  const { repoPath, baseRef, headRef, threeDot, config } = req;

  const { baseSha, headSha } = await resolveDiffEndpoints(
    repoPath,
    baseRef,
    headRef,
    threeDot,
  );

  const diffOut = await gitDiff(repoPath, baseSha, headSha);
  const parsed = parseUnifiedDiff(diffOut);

  const filtered: typeof parsed = [];
  let excludedCount = 0;
  for (const f of parsed) {
    if (!isTypeScript(f.filePath)) continue;
    if (matchesAnyGlob(f.filePath, config.exclude.globs)) {
      excludedCount += 1;
      continue;
    }
    if (f.hunks.length === 0) continue;
    filtered.push(f);
  }

  // Sort by path for determinism.
  filtered.sort((a, b) =>
    a.filePath < b.filePath ? -1 : a.filePath > b.filePath ? 1 : 0,
  );

  const result: ChangedFile[] = [];
  for (const p of filtered) {
    // oxlint-disable-next-line no-await-in-loop -- sequential git show keeps child-process count bounded
    const text = await gitShow(repoPath, headSha, p.filePath);
    result.push({
      filePath: p.filePath,
      headSha,
      baseSha,
      text,
      hunks: p.hunks,
    });
  }
  return { files: result, excludedCount };
}

function isTypeScript(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".ts") || lower.endsWith(".tsx");
}
