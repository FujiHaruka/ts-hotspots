import { spawnSync } from "node:child_process";

/**
 * Minimal file descriptor accepted by `collectChurn`.
 *
 * The collector only needs each file's repo-root-relative POSIX path; it
 * does not read the AST. `SourceFileInfo` from the loader is structurally
 * compatible (it carries `path` plus a parsed `sourceFile`), so existing
 * callers that pass `SourceFileInfo[]` continue to work unchanged. The
 * wider type lets the duplication pipeline pass plain `{ path }` records
 * sourced from `git ls-tree` without re-parsing.
 */
export interface ChurnFileInput {
  path: string;
}

export interface ChurnCollectorOptions {
  rootDir: string;
  files: readonly ChurnFileInput[];
  window: number;
  ref: string;
  onWarning?: (msg: string) => void;
}

const COMMIT_MARKER = "CMT";

export function collectChurn(opts: ChurnCollectorOptions): Map<string, number> {
  const fileSet = new Set(opts.files.map((f) => f.path));
  const warn = (reason: string): Map<string, number> => {
    opts.onWarning?.(`ts-hotspots: git churn skipped (${reason})`);
    return new Map();
  };

  const prefixRaw = runGit(opts.rootDir, ["rev-parse", "--show-prefix"]);
  if (prefixRaw === undefined) return warn("not a git repository");
  // `--show-prefix` is repo-root-relative and already posix, with a trailing
  // slash when non-empty. Strip the trailing slash so the parser can rebuild it.
  const prefixPosix = prefixRaw.trim().replace(/\/$/, "");

  const shallow = runGit(opts.rootDir, [
    "rev-parse",
    "--is-shallow-repository",
  ]);
  const isShallow = shallow?.trim() === "true";

  const logOut = runGit(opts.rootDir, [
    "log",
    "--first-parent",
    "-m",
    "--name-status",
    "-M",
    "-n",
    String(opts.window),
    `--format=tformat:${COMMIT_MARKER}`,
    opts.ref,
  ]);
  if (logOut === undefined) return warn("git log failed");

  const counts = parseChurnLog(logOut, fileSet, prefixPosix);

  if (isShallow) {
    opts.onWarning?.(
      "ts-hotspots: git churn may be incomplete (shallow clone)",
    );
  }

  return counts;
}

// Walks `git log --name-status -M` output from newest to oldest, following
// renames backward so pre-rename commits are credited to the current file.
// Exported for unit tests.
export function parseChurnLog(
  raw: string,
  fileSet: ReadonlySet<string>,
  prefix = "",
): Map<string, number> {
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

  const counts = new Map<string, number>();
  const bump = (canonical: string, countedThisCommit: Set<string>): void => {
    if (countedThisCommit.has(canonical)) return;
    counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
    countedThisCommit.add(canonical);
  };

  let countedThisCommit = new Set<string>();
  const handleRenameOrCopy = (status: string, rest: string): void => {
    const sep = rest.indexOf("\t");
    if (sep < 0) return;
    const oldRaw = rest.slice(0, sep);
    const newRaw = rest.slice(sep + 1);
    const newRel = stripPrefix(newRaw);
    if (newRel === undefined) return;
    const canonical = tracked.get(newRel);
    if (canonical === undefined) return;

    bump(canonical, countedThisCommit);

    // Going back in time from this commit, the file no longer exists at
    // newRel. For a rename, it existed at oldRel; for a copy, it didn't
    // exist at all (copy creates a new file from an existing one).
    tracked.delete(newRel);
    if (status.startsWith("R")) {
      const oldRel = stripPrefix(oldRaw);
      if (oldRel !== undefined) tracked.set(oldRel, canonical);
    }
  };

  for (const line of raw.split("\n")) {
    if (line === "") continue;
    if (line === COMMIT_MARKER) {
      countedThisCommit = new Set();
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
    bump(canonical, countedThisCommit);
  }

  return counts;
}

function runGit(cwd: string, args: readonly string[]): string | undefined {
  try {
    // `core.quotepath=false` keeps non-ASCII paths as raw UTF-8 instead of
    // octal-escaping and double-quoting them, so `fileSet.has()` matches.
    const res = spawnSync("git", ["-c", "core.quotepath=false", ...args], {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    if (res.error) return undefined;
    if (res.status !== 0) return undefined;
    return res.stdout;
  } catch {
    return undefined;
  }
}
