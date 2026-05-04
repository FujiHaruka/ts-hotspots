import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export class NotAGitRepoError extends Error {
  readonly code = "NOT_A_GIT_REPO" as const;
  constructor(start: string) {
    super(notAGitRepoMessage(start));
    this.name = "NotAGitRepoError";
  }
}

export function notAGitRepoMessage(start: string): string {
  return `ts-hotspots requires a git repository (none found at: ${start})`;
}

/**
 * Walk up from `start` until a `.git` entry is found, returning that
 * directory. `.git` may be a directory (normal repo) or a file (worktree
 * / submodule), so we test for either via `existsSync`. Throws
 * `NotAGitRepoError` when no `.git` entry exists on any ancestor.
 */
export function findGitRoot(start: string): string {
  let cur = resolve(start);
  while (true) {
    if (existsSync(join(cur, ".git"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) {
      throw new NotAGitRepoError(start);
    }
    cur = parent;
  }
}
