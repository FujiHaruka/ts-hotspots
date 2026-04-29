import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface ExecGitOptions {
  /** Maximum stdout buffer (bytes). Defaults to 64 MiB. */
  maxBuffer?: number;
}

/**
 * Execute `git` with the given args in `cwd` and return stdout as UTF-8.
 *
 * Throws when git exits with a non-zero status (the thrown Error carries
 * stderr on `.stderr`).
 */
export async function execGit(
  cwd: string,
  args: readonly string[],
  options: ExecGitOptions = {},
): Promise<string> {
  const maxBuffer = options.maxBuffer ?? 64 * 1024 * 1024;
  const { stdout } = await execFileAsync("git", ["-C", cwd, ...args], {
    encoding: "utf-8",
    maxBuffer,
  });
  return stdout;
}

/**
 * Resolve a ref (sha, branch, tag, ...) to a full commit sha.
 */
export async function resolveSha(cwd: string, ref: string): Promise<string> {
  const out = await execGit(cwd, ["rev-parse", ref]);
  return out.trim();
}

/**
 * Resolve the merge-base of two refs to a full commit sha.
 * Used for three-dot (`A...B`) PR semantics.
 */
export async function mergeBaseSha(
  cwd: string,
  a: string,
  b: string,
): Promise<string> {
  const out = await execGit(cwd, ["merge-base", a, b]);
  return out.trim();
}

/**
 * Resolve a ts-dedup revrange to concrete shas.
 *
 *   - two-dot (`A..B`):  baseSha = rev-parse A, headSha = rev-parse B
 *   - three-dot (`A...B`): baseSha = merge-base(A, headSha), headSha = rev-parse B
 */
export async function resolveDiffEndpoints(
  cwd: string,
  baseRef: string,
  headRef: string,
  threeDot: boolean,
): Promise<{ baseSha: string; headSha: string }> {
  const headSha = await resolveSha(cwd, headRef);
  const baseSha = threeDot
    ? await mergeBaseSha(cwd, baseRef, headSha)
    : await resolveSha(cwd, baseRef);
  return { baseSha, headSha };
}

/**
 * Run `git diff --unified=0 --no-color --no-renames <base>..<head>`.
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
    "--no-renames",
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
