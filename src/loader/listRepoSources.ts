import { resolve, sep } from "node:path";
import { matchesAnyGlob } from "../duplication/diff/internal/globMatch.ts";
import { execGit } from "../util/git/runner.ts";

const SOURCE_EXTENSIONS: readonly string[] = [".ts", ".tsx", ".mts", ".cts"];

export class NotAGitRepositoryError extends Error {
  readonly code = "NOT_A_GIT_REPO";
  constructor(rootDir: string) {
    super(`not a git repository: ${rootDir}`);
    this.name = "NotAGitRepositoryError";
  }
}

export interface RepoSource {
  /** Absolute path on disk. */
  absolute: string;
  /** Path relative to rootDir, POSIX-normalized. */
  relative: string;
}

export interface ListRepoSourcesOptions {
  exclude?: readonly string[];
}

/**
 * List `.ts` / `.tsx` / `.mts` / `.cts` files tracked by git under `rootDir`.
 *
 * Sources are determined by `git ls-files`, so untracked / gitignored files
 * are skipped. Paths are returned relative to `rootDir` (matching git's
 * cwd-relative output) and absolute on disk. Output is filtered against
 * `options.exclude` (POSIX globs) and sorted ascending by relative path for
 * determinism.
 *
 * Throws `NotAGitRepositoryError` when `rootDir` is not inside a git
 * working tree.
 */
export async function listRepoSources(
  rootDir: string,
  options: ListRepoSourcesOptions = {},
): Promise<RepoSource[]> {
  const resolvedRoot = resolve(rootDir);
  let out: string;
  try {
    out = await execGit(resolvedRoot, [
      "ls-files",
      "-z",
      "--",
      "*.ts",
      "*.tsx",
      "*.mts",
      "*.cts",
    ]);
  } catch (err) {
    if (isNotARepoError(err)) {
      throw new NotAGitRepositoryError(resolvedRoot);
    }
    throw err;
  }

  const exclude = options.exclude ?? [];
  const sources: RepoSource[] = [];
  for (const raw of out.split("\0")) {
    if (raw === "") continue;
    const relative = sep === "/" ? raw : raw.split(sep).join("/");
    if (!hasSourceExtension(relative)) continue;
    if (matchesAnyGlob(relative, exclude)) continue;
    sources.push({ relative, absolute: resolve(resolvedRoot, relative) });
  }
  sources.sort((a, b) =>
    a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0,
  );
  return sources;
}

function hasSourceExtension(path: string): boolean {
  const lower = path.toLowerCase();
  return SOURCE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isNotARepoError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  const e = err as { stderr?: string; message?: string };
  const msg = `${e.stderr ?? ""} ${e.message ?? ""}`;
  return msg.includes("not a git repository");
}
