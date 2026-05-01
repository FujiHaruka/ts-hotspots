/**
 * Lightweight reader for the subset of `tsconfig.json` that affects
 * module resolution: `compilerOptions.baseUrl` and
 * `compilerOptions.paths`. We do not invoke `ts.parseJsonConfigFileContent`
 * because the architecture subcommand stays parser-only — pulling in the
 * full config pipeline would also drag in `ts.sys` filesystem hooks that
 * complicate testing.
 *
 * The reader is forgiving: missing fields, missing files, and JSON parse
 * errors all degrade to "no path mappings", which is the correct default
 * for repos without configured aliases.
 */

import { readFileSync } from "node:fs";
import path from "node:path/posix";

export interface PathMapping {
  /** Pattern from tsconfig (e.g. `@/*`, `~lib/*`, `app`). */
  readonly pattern: string;
  /** Replacement targets (relative to baseUrl). First match wins. */
  readonly targets: readonly string[];
}

export interface TsconfigResolution {
  /** Repo-relative baseUrl (default `.`). */
  readonly baseUrl: string;
  readonly mappings: readonly PathMapping[];
}

interface RawTsconfig {
  compilerOptions?: {
    baseUrl?: unknown;
    paths?: unknown;
  };
}

/**
 * Read `<repoRoot>/tsconfig.json` if present and extract the resolution
 * subset. Always returns a value; absent or malformed configs collapse
 * to `{ baseUrl: ".", mappings: [] }`.
 */
export function readTsconfigResolution(repoRoot: string): TsconfigResolution {
  const tsconfigPath = path.join(toPosix(repoRoot), "tsconfig.json");
  let raw: string;
  try {
    raw = readFileSync(tsconfigPath, "utf8");
  } catch {
    return EMPTY;
  }
  let parsed: RawTsconfig;
  try {
    parsed = JSON.parse(stripJsonComments(raw)) as RawTsconfig;
  } catch {
    return EMPTY;
  }
  return parseTsconfigResolution(parsed);
}

/** Exposed for tests: turn a parsed tsconfig object into resolution data. */
export function parseTsconfigResolution(
  parsed: RawTsconfig,
): TsconfigResolution {
  const opts = parsed.compilerOptions ?? {};
  const baseUrl =
    typeof opts.baseUrl === "string" && opts.baseUrl.length > 0
      ? normalizeBaseUrl(opts.baseUrl)
      : ".";

  const rawPaths = opts.paths;
  if (rawPaths === null || typeof rawPaths !== "object") {
    return { baseUrl, mappings: [] };
  }
  const mappings: PathMapping[] = [];
  for (const [pattern, targets] of Object.entries(
    rawPaths as Record<string, unknown>,
  )) {
    if (!Array.isArray(targets)) continue;
    const stringTargets = targets.filter(
      (t): t is string => typeof t === "string",
    );
    if (stringTargets.length === 0) continue;
    mappings.push({ pattern, targets: stringTargets });
  }
  // Longest pattern first so `@/foo/*` wins over `@/*`. TypeScript itself
  // applies "longest matching prefix"; sorting makes `applyPathMapping`
  // a simple linear scan.
  mappings.sort((a, b) => b.pattern.length - a.pattern.length);
  return { baseUrl, mappings };
}

const EMPTY: TsconfigResolution = { baseUrl: ".", mappings: [] };

function normalizeBaseUrl(raw: string): string {
  const cleaned = toPosix(raw).replace(/\/+$/, "");
  return cleaned.length === 0 ? "." : cleaned;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * Strip `//` line comments and `/* … *​/` block comments. Sufficient for
 * `tsconfig.json` (JSON-with-comments); deliberately not a full JSONC
 * parser — strings containing `//` are not handled, which would only
 * matter for paths embedded in string values that themselves contain
 * a literal `//`. tsconfig keys and path patterns never do.
 */
function stripJsonComments(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
