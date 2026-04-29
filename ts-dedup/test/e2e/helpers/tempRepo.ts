import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export interface TempRepo {
  path: string;
  /** Run a git command in the repo and return its stdout. */
  git: (...args: string[]) => string;
  /** Write a file at the given relative path, creating parents as needed. */
  write: (relPath: string, content: string) => void;
  /** Stage everything and commit with the given message; returns the new sha. */
  commit: (message: string) => string;
  /** Resolve a ref to a full sha. */
  rev: (ref: string) => string;
  /** Remove the repository directory. */
  cleanup: () => void;
}

/**
 * Create a throwaway git repo under `os.tmpdir()`, pre-configured with a
 * deterministic committer identity and gpgsign disabled.
 *
 * Tests are expected to call `cleanup()` from an `afterEach` hook. The repo
 * is created with `-b main` so ref resolution is stable across git versions.
 */
export function createTempRepo(prefix = "ts-dedup-e2e-"): TempRepo {
  const path = mkdtempSync(join(tmpdir(), prefix));
  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", path, ...args], { encoding: "utf-8" });
  git("init", "-q", "-b", "main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "test");
  git("config", "commit.gpgsign", "false");

  const write = (relPath: string, content: string): void => {
    const full = join(path, relPath);
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, content, "utf-8");
  };
  const commit = (message: string): string => {
    git("add", "-A");
    git("commit", "-q", "-m", message);
    return git("rev-parse", "HEAD").trim();
  };
  const rev = (ref: string): string => git("rev-parse", ref).trim();
  const cleanup = (): void => {
    rmSync(path, { recursive: true, force: true });
  };

  return { path, git, write, commit, rev, cleanup };
}
