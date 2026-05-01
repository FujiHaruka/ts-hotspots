import { execGit } from "./runner.ts";

/**
 * Return the list of file paths that changed between `baseSha..headSha`,
 * relative to the git repo root at `repoPath`. Deletions are filtered out
 * (`--diff-filter=d`) so callers only see paths that exist on the head
 * side.
 *
 * Output is sorted by `git`'s natural ordering (lexicographic on the path
 * string), matching git's standard `--name-only` behaviour.
 */
export async function listChangedFilePaths(
  repoPath: string,
  baseSha: string,
  headSha: string,
): Promise<string[]> {
  const out = await execGit(repoPath, [
    "diff",
    "--name-only",
    "--diff-filter=d",
    "--no-renames",
    `${baseSha}..${headSha}`,
  ]);
  const paths: string[] = [];
  for (const line of out.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.length > 0) paths.push(trimmed);
  }
  return paths;
}
