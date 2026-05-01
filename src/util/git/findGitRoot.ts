import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Walk up from `start` until a `.git` entry is found, returning that
 * directory. `.git` may be a directory (normal repo) or a file (worktree
 * / submodule), so we test for either via `existsSync`. Throws when no
 * `.git` entry exists on any ancestor.
 */
export function findGitRoot(start: string): string {
  let cur = resolve(start);
  while (true) {
    if (existsSync(join(cur, ".git"))) return cur;
    const parent = dirname(cur);
    if (parent === cur) {
      throw new Error(`not in a git repository: ${start}`);
    }
    cur = parent;
  }
}
