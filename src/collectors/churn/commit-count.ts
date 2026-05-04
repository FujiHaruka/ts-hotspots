import { spawnSync } from "node:child_process";
import { COMMIT_MARKER, walkChurnLog } from "../../util/git/walkChurnLog.ts";

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
interface ChurnFileInput {
  path: string;
}

interface ChurnCollectorOptions {
  rootDir: string;
  files: readonly ChurnFileInput[];
  window: number;
  ref: string;
  onWarning?: (msg: string) => void;
}

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
// Thin adapter over the shared rename-tracking walker in `walkChurnLog`.
// Exported for unit tests.
export function parseChurnLog(
  raw: string,
  fileSet: ReadonlySet<string>,
  prefix = "",
): Map<string, number> {
  const counts = new Map<string, number>();
  let countedThisCommit = new Set<string>();
  walkChurnLog(
    raw,
    fileSet,
    { prefix },
    {
      onCommit: () => {
        countedThisCommit = new Set();
      },
      onChange: (canonical) => {
        if (countedThisCommit.has(canonical)) return;
        counts.set(canonical, (counts.get(canonical) ?? 0) + 1);
        countedThisCommit.add(canonical);
      },
    },
  );
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
