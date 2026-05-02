/**
 * Shared walker over `git log --first-parent -m --name-status -M -n <N> <ref>`
 * output. Handles parsing AND the rename-aware "post-rename canonical path"
 * tracking that lets historical pre-rename entries be credited to a file's
 * current (canonical) path.
 *
 * Callers supply a per-commit visitor; the walker invokes `onCommit` at every
 * commit boundary and `onChange` for each tracked file touched within the
 * current commit. The canonical path passed to `onChange` is always the
 * post-rename path that exists in the working tree today (i.e., a member of
 * the original `fileSet`), not the historical path written in the log line.
 *
 * The walker is the rename-tracking core shared by `parseChurnLog`
 * (per-file commit counting) and the upcoming cochange pair walker. Keep it
 * pure: no I/O, no git invocation, no allocation tied to perf flags.
 */

export const COMMIT_MARKER = "CMT";

export interface WalkChurnLogOptions {
  /**
   * Repo-root-relative POSIX prefix to strip from every log path before
   * comparing against `fileSet` (used in monorepo sub-package mode where
   * `git -C` is run from the package root but `git log` paths are repo-root
   * relative). Empty string means no prefix.
   */
  prefix?: string;
}

export interface ChurnLogVisitor {
  /**
   * Invoked once per commit boundary (the `CMT` marker line). If the caller
   * supplied `--format=tformat:CMT %h` (or similar with a token after the
   * marker), the trailing token is forwarded as `sha`; with the SHA-less
   * `--format=tformat:CMT` format it is `undefined`.
   */
  onCommit?(sha?: string): void;
  /** Invoked for each tracked file touched in the current commit. */
  onChange(canonicalPath: string): void;
}

export function walkChurnLog(
  rawLog: string,
  fileSet: ReadonlySet<string>,
  options: WalkChurnLogOptions,
  visitor: ChurnLogVisitor,
): void {
  const prefix = options.prefix ?? "";
  const prefixWithSlash = prefix === "" ? "" : `${prefix}/`;
  const stripPrefix = (p: string): string | undefined => {
    if (prefixWithSlash === "") return p;
    if (!p.startsWith(prefixWithSlash)) return undefined;
    return p.slice(prefixWithSlash.length);
  };

  // historical path → canonical (current) path. Starts with identity mapping
  // for every currently-known file; grows as we walk renames back in time.
  const tracked = new Map<string, string>();
  for (const f of fileSet) tracked.set(f, f);

  const handleRenameOrCopy = (status: string, rest: string): void => {
    const sep = rest.indexOf("\t");
    if (sep < 0) return;
    const oldRaw = rest.slice(0, sep);
    const newRaw = rest.slice(sep + 1);
    const newRel = stripPrefix(newRaw);
    if (newRel === undefined) return;
    const canonical = tracked.get(newRel);
    if (canonical === undefined) return;

    visitor.onChange(canonical);

    // Going back in time from this commit, the file no longer exists at
    // newRel. For a rename, it existed at oldRel; for a copy, it didn't
    // exist at all (copy creates a new file from an existing one).
    tracked.delete(newRel);
    if (status.startsWith("R")) {
      const oldRel = stripPrefix(oldRaw);
      if (oldRel !== undefined) tracked.set(oldRel, canonical);
    }
  };

  for (const line of rawLog.split("\n")) {
    if (line === "") continue;
    if (line === COMMIT_MARKER) {
      visitor.onCommit?.();
      continue;
    }
    if (line.startsWith(`${COMMIT_MARKER} `) && !line.includes("\t")) {
      visitor.onCommit?.(line.slice(COMMIT_MARKER.length + 1));
      continue;
    }
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const status = line.slice(0, tab);
    const rest = line.slice(tab + 1);

    if (status.startsWith("R") || status.startsWith("C")) {
      handleRenameOrCopy(status, rest);
      continue;
    }

    const rel = stripPrefix(rest);
    if (rel === undefined) continue;
    const canonical = tracked.get(rel);
    if (canonical === undefined) continue;
    visitor.onChange(canonical);
  }
}
