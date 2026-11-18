import { execGit } from "../../util/git/runner.ts";

export {
  execGit,
  gitCatFileBatch,
  resolveDiffEndpoints,
  resolveSha,
} from "../../util/git/runner.ts";

/**
 * Run `git diff --unified=0 --no-color --find-renames <base>..<head>`.
 */
export async function gitDiff(
  cwd: string,
  baseSha: string,
  headSha: string,
): Promise<string> {
  return execGit(cwd, [
    "diff",
    "--unified=0",
    "--no-color",
    "--find-renames",
    `${baseSha}..${headSha}`,
  ]);
}

/**
 * Run `git show <ref>:<path>` and return the file contents.
 *
 * Throws when the path is missing on the ref or the content cannot be read
 * as UTF-8 text.
 */
export async function gitShow(
  cwd: string,
  ref: string,
  path: string,
): Promise<string> {
  return execGit(cwd, ["show", `${ref}:${path}`]);
}
