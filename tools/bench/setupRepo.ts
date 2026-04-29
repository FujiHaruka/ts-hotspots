import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { FileSnapshot } from "./loadFixtures.ts";

export interface SetupRepoResult {
  path: string;
  baseSha: string;
  headSha: string;
  cleanup: () => void;
}

/**
 * Build a throwaway git repository with two commits:
 *   1. all files from `baseFiles` (the "base" snapshot)
 *   2. `baseFiles` replaced by `headFiles` (the "head" snapshot)
 *
 * Any file present on base but absent on head is removed in the second commit,
 * so the diff visible to `runDetector` matches what the fixture author wrote.
 */
export function setupRepo(
  baseFiles: FileSnapshot[],
  headFiles: FileSnapshot[],
  prefix = "ts-dedup-bench-",
): SetupRepoResult {
  const path = mkdtempSync(join(tmpdir(), prefix));
  const git = (...args: string[]): string =>
    execFileSync("git", ["-C", path, ...args], { encoding: "utf-8" });

  git("init", "-q", "-b", "main");
  git("config", "user.email", "bench@example.com");
  git("config", "user.name", "bench");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");

  const writeAll = (files: FileSnapshot[]): void => {
    for (const f of files) {
      const full = join(path, f.relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, f.text, "utf-8");
    }
  };

  const baseRelSet = new Set(baseFiles.map((f) => f.relPath));
  const headRelSet = new Set(headFiles.map((f) => f.relPath));

  writeAll(baseFiles);
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  const baseSha = git("rev-parse", "HEAD").trim();

  for (const rel of baseRelSet) {
    if (!headRelSet.has(rel)) {
      try {
        git("rm", "-q", "-f", rel);
      } catch {
        // ignore
      }
    }
  }
  writeAll(headFiles);
  git("add", "-A");
  git("commit", "-q", "-m", "head");
  const headSha = git("rev-parse", "HEAD").trim();

  const cleanup = (): void => {
    rmSync(path, { recursive: true, force: true });
  };

  return { path, baseSha, headSha, cleanup };
}
