/**
 * Side-effectful git invocation for cochange. Spawns
 * `git log --first-parent -m --name-status -M -n <window> --format=tformat:CMT %h <ref>`
 * in `rootDir` and returns the raw stdout. Returns `undefined` on any
 * spawn / non-zero exit so callers can route the graceful-skip path
 * (non-git, missing git binary) through the same code path as a missing
 * walker output.
 *
 * Mirrors the `runGit` helper in `src/collectors/churn/commit-count.ts`
 * — same flag set, same `core.quotepath=false`, same swallow-and-return
 * posture so the cochange orchestrator reads as a single straight-line
 * function.
 */

import { spawnSync } from "node:child_process";
import { COMMIT_MARKER } from "../../util/git/walkChurnLog.ts";

interface RunGitLogOptions {
  rootDir: string;
  ref: string;
  window: number;
}

export function runGitLog(opts: RunGitLogOptions): string | undefined {
  return runGit(opts.rootDir, [
    "log",
    "--first-parent",
    "-m",
    "--name-status",
    "-M",
    "-n",
    String(opts.window),
    `--format=tformat:${COMMIT_MARKER} %h`,
    opts.ref,
  ]);
}

export function runGitShowPrefix(rootDir: string): string | undefined {
  return runGit(rootDir, ["rev-parse", "--show-prefix"]);
}

function runGit(cwd: string, args: readonly string[]): string | undefined {
  try {
    const res = spawnSync("git", ["-c", "core.quotepath=false", ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    if (res.error) return undefined;
    if (res.status !== 0) return undefined;
    return res.stdout;
  } catch {
    return undefined;
  }
}
