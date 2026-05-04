import type { Config } from "../config/index.ts";
import { execGit, gitCatFileBatch } from "../diff/gitRunner.ts";
import { matchesAnyGlob } from "../diff/internal/globMatch.ts";

interface BaseSource {
  path: string;
  text: string;
}

interface ListBaseSourcesResult {
  sources: BaseSource[];
  /**
   * Count of `.ts` / `.tsx` files that matched `config.exclude.globs` and
   * were therefore not read. Non-TypeScript files are not counted. Useful
   * for the report's analysis summary so users can see whether their
   * exclude rules are doing what they expect.
   */
  excludedCount: number;
}

/**
 * Enumerate `.ts` / `.tsx` sources on the base side of the PR for indexing.
 *
 * `repoPath` is the git repo root (resolved by `findGitRoot` in `main.ts`),
 * so `git rev-parse --show-prefix` returns empty and the whole tree is
 * scanned. The pathspec branch below is kept for callers that hand in a
 * subdirectory directly (e.g. test helpers).
 *
 * Output paths from `git ls-tree --full-tree` are repo-root-relative
 * regardless of where `repoPath` points; this matches `git show <sha>:<path>`,
 * which also interprets its path relative to the repo root. Without
 * `--full-tree` ls-tree would emit cwd-relative paths that `git show` then
 * fails to resolve, and every file would be silently dropped.
 *
 * Paths are filtered by extension and by `config.exclude.globs`, then read
 * via `git show` one by one. Results are sorted ascending by path for
 * determinism.
 *
 * Files that cannot be read (binary blobs, submodule gitlinks, etc.) are
 * silently skipped — duplicate detection has no meaningful signal on them.
 */
export async function listBaseSources(
  repoPath: string,
  baseSha: string,
  config: Config,
): Promise<ListBaseSourcesResult> {
  const prefixOut = await execGit(repoPath, ["rev-parse", "--show-prefix"]);
  const prefix = prefixOut.trim();
  const lsTreeArgs = [
    "ls-tree",
    "-r",
    "-z",
    "--full-tree",
    "--name-only",
    baseSha,
  ];
  if (prefix !== "") lsTreeArgs.push("--", prefix);
  const out = await execGit(repoPath, lsTreeArgs);

  const paths: string[] = [];
  let excludedCount = 0;
  for (const raw of out.split("\0")) {
    if (raw === "") continue;
    if (!isTypeScript(raw)) continue;
    if (matchesAnyGlob(raw, config.exclude.globs)) {
      excludedCount += 1;
      continue;
    }
    paths.push(raw);
  }
  paths.sort();

  // Read every blob in one `git cat-file --batch` child process instead of
  // fork+exec'ing N separate `git show` calls. Specs that resolve to a
  // missing object or a non-blob are silently dropped (matching the
  // legacy per-file silent-skip for binary blobs and submodule gitlinks).
  const specs = paths.map((p) => `${baseSha}:${p}`);
  const { contents } = await gitCatFileBatch(repoPath, specs);
  const sources: BaseSource[] = [];
  for (let i = 0; i < paths.length; i++) {
    const path = paths[i];
    const spec = specs[i];
    if (path === undefined || spec === undefined) continue;
    const text = contents.get(spec);
    if (text === undefined) continue;
    sources.push({ path, text });
  }
  return { sources, excludedCount };
}

function isTypeScript(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.endsWith(".ts") || lower.endsWith(".tsx");
}

/**
 * Count newline-terminated lines in a UTF-8 source. A non-empty file with
 * no trailing newline still counts as having one final line.
 */
export function countLines(text: string): number {
  if (text.length === 0) return 0;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return text.endsWith("\n") ? count : count + 1;
}
