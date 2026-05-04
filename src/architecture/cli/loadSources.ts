/**
 * Source loader for the architecture pipeline.
 *
 * Two modes:
 *   - **working tree** (`ref === undefined`): delegate to
 *     `listRepoSources` (the comp/dup whole-tree path) and read each
 *     file from disk via the standard loader.
 *   - **--ref <ref>**: list `.ts/.tsx` paths at the given commit via
 *     `git ls-tree --full-tree`, then read each blob with `git show`.
 *     Mirrors `src/duplication/cli/listBaseSources.ts` exactly so the
 *     same git-show error semantics (silently skip unreadable blobs)
 *     apply.
 *
 * Both paths return `{ path, text }[]` in lex-sorted path order so the
 * downstream graph builder sees deterministic input.
 */

import { readFileSync } from "node:fs";
import {
  execGit,
  gitShow,
  resolveSha,
} from "../../duplication/diff/gitRunner.ts";
import { matchesAnyGlob } from "../../duplication/diff/internal/globMatch.ts";
import { listRepoSources } from "../../loader/listRepoSources.ts";

interface ArchSourceFile {
  /** Repo-relative POSIX path. Used verbatim for graph nodes. */
  path: string;
  text: string;
}

interface LoadArchSourcesOptions {
  rootDir: string;
  ref: string | undefined;
  excludeGlobs: readonly string[];
}

export async function loadArchSources(
  opts: LoadArchSourcesOptions,
): Promise<ArchSourceFile[]> {
  if (opts.ref === undefined) {
    return loadWorkingTreeSources(opts.rootDir, opts.excludeGlobs);
  }
  return loadRefSources(opts.rootDir, opts.ref, opts.excludeGlobs);
}

async function loadWorkingTreeSources(
  rootDir: string,
  excludeGlobs: readonly string[],
): Promise<ArchSourceFile[]> {
  const sources = await listRepoSources(rootDir, { exclude: excludeGlobs });
  const out: ArchSourceFile[] = [];
  for (const s of sources) {
    let text: string;
    try {
      text = readFileSync(s.absolute, "utf8");
    } catch {
      // Working-tree paths from `git ls-files` may have been deleted
      // since the snapshot. Skip — same recall-over-precision posture
      // as dup.
      continue;
    }
    out.push({ path: s.relative, text });
  }
  return out;
}

async function loadRefSources(
  rootDir: string,
  ref: string,
  excludeGlobs: readonly string[],
): Promise<ArchSourceFile[]> {
  const sha = await resolveSha(rootDir, ref);
  const prefixOut = await execGit(rootDir, ["rev-parse", "--show-prefix"]);
  const prefix = prefixOut.trim();
  const lsTreeArgs = ["ls-tree", "-r", "-z", "--full-tree", "--name-only", sha];
  if (prefix !== "") lsTreeArgs.push("--", prefix);
  const out = await execGit(rootDir, lsTreeArgs);

  const paths: string[] = [];
  for (const raw of out.split("\0")) {
    if (raw === "") continue;
    if (!isTypeScript(raw)) continue;
    if (matchesAnyGlob(raw, excludeGlobs)) continue;
    paths.push(raw);
  }
  paths.sort();

  const sources: ArchSourceFile[] = [];
  for (const path of paths) {
    let text: string;
    try {
      // oxlint-disable-next-line no-await-in-loop -- sequential git show keeps child-process count bounded
      text = await gitShow(rootDir, sha, path);
    } catch {
      continue;
    }
    sources.push({ path, text });
  }
  return sources;
}

function isTypeScript(path: string): boolean {
  const lower = path.toLowerCase();
  return (
    lower.endsWith(".ts") ||
    lower.endsWith(".tsx") ||
    lower.endsWith(".mts") ||
    lower.endsWith(".cts")
  );
}
