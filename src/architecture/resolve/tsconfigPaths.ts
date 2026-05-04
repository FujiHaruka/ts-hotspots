/**
 * Reader for the subset of `tsconfig.json` that affects module
 * resolution: `compilerOptions.baseUrl` and `compilerOptions.paths`.
 *
 * Boundary: this is the **one** place where the architecture pipeline
 * reaches the filesystem via `ts.parseJsonConfigFileContent`.
 * Everything past `TsconfigResolution` (specifier resolution, the
 * graph builder, the report) stays parser-only and `knownFiles`-
 * driven. Delegating tsconfig parsing to TS gives us spec-accurate
 * handling of `extends` chains (relative / `node_modules` / array
 * form / `${configDir}` / wholesale `paths` inheritance) without
 * reinventing the resolver. See `parseConfigHost.ts` for the
 * workspace-extends rewrite that lets `extends` chase a package by
 * name even before `pnpm install` materialises `node_modules`.
 *
 * Failures (missing file, invalid JSON, parser diagnostics on
 * `extends` resolution) collapse to `EMPTY` (`{ baseUrl: ".", mappings:
 * [] }`) — no path mappings, no errors raised. The resolver keeps
 * running with the relative-import + workspace-package branches.
 */

import { dirname, isAbsolute, resolve as resolveNative } from "node:path";
import ts from "typescript";
import { posixify } from "../util/posixify.ts";
import {
  type MakeParseConfigHostOptions,
  makeParseConfigHost,
} from "./parseConfigHost.ts";

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

const EMPTY: TsconfigResolution = { baseUrl: ".", mappings: [] };

interface ReadTsconfigOptions extends Partial<MakeParseConfigHostOptions> {
  /**
   * Absolute path to the tsconfig file. When omitted, defaults to
   * `<repoRoot>/tsconfig.json`. Used by the per-package loader.
   */
  readonly tsconfigPath?: string;
}

/**
 * Read a tsconfig (default: `<repoRoot>/tsconfig.json`) through the
 * TypeScript API and extract the resolution subset.
 *
 * The returned `mappings` are sorted longest-pattern-first so the
 * resolver's linear scan picks up `@/feature/*` before `@/*`.
 *
 * Always returns a value: absent or malformed configs collapse to
 * `EMPTY`.
 */
export function readTsconfigResolution(
  repoRoot: string,
  opts: ReadTsconfigOptions = {},
): TsconfigResolution {
  const tsconfigPath =
    opts.tsconfigPath ?? resolveNative(repoRoot, "tsconfig.json");
  const host = makeParseConfigHost({
    repoRoot: opts.repoRoot ?? repoRoot,
    packageMap: opts.packageMap,
  });

  const read = ts.readConfigFile(tsconfigPath, (p) => host.readFile(p));
  if (read.error !== undefined) return EMPTY;
  const json = read.config as unknown;
  if (json === undefined || json === null) return EMPTY;

  // basePath is the directory containing the tsconfig — TS uses it
  // both as the implicit baseUrl and as the resolution root for
  // `extends` chains.
  const basePath = dirname(tsconfigPath);
  const parsed = ts.parseJsonConfigFileContent(
    json,
    host,
    basePath,
    undefined,
    tsconfigPath,
  );

  return toTsconfigResolution(parsed.options, repoRoot, basePath);
}

/**
 * Build a `TsconfigResolution` from parsed compiler options. Path
 * mappings are normalised to repo-relative POSIX paths so the
 * downstream resolver can use them verbatim against `knownFiles`.
 */
function toTsconfigResolution(
  options: ts.CompilerOptions,
  repoRoot: string,
  basePath: string,
): TsconfigResolution {
  const repoRootAbs = resolveNative(repoRoot);
  // oxlint-disable no-deprecated -- TS 5+ marks `baseUrl` deprecated;
  // we still read it because users (and inherited tsconfigs) keep
  // setting it for path-mapping resolution.
  const baseUrlAbs =
    typeof options.baseUrl === "string" && options.baseUrl !== ""
      ? resolveNative(basePath, options.baseUrl)
      : basePath;
  // oxlint-enable no-deprecated
  const baseUrl = absToRepoRel(repoRootAbs, baseUrlAbs);

  const rawPaths = options.paths;
  if (rawPaths === undefined) {
    return { baseUrl, mappings: [] };
  }
  const mappings: PathMapping[] = [];
  for (const [pattern, targets] of Object.entries(rawPaths)) {
    if (!Array.isArray(targets)) continue;
    const stringTargets = targets.filter(
      (t): t is string => typeof t === "string",
    );
    if (stringTargets.length === 0) continue;
    mappings.push({ pattern, targets: stringTargets });
  }
  mappings.sort((a, b) => b.pattern.length - a.pattern.length);
  return { baseUrl, mappings };
}

function absToRepoRel(repoRootAbs: string, abs: string): string {
  // Convert an absolute path to repo-relative POSIX. When the absolute
  // path falls outside the repo (rare: a tsconfig with `baseUrl`
  // pointing into a sibling directory), we still emit it relative,
  // even if that means leading `../`. Downstream `applyPathMapping`
  // normalises any escaping.
  if (!isAbsolute(abs)) return posixify(abs);
  let rel: string;
  if (abs === repoRootAbs) {
    rel = ".";
  } else if (abs.startsWith(`${repoRootAbs}/`)) {
    rel = abs.slice(repoRootAbs.length + 1);
  } else if (abs.startsWith(`${repoRootAbs}\\`)) {
    rel = abs.slice(repoRootAbs.length + 1);
  } else {
    // Outside the repo. Fall back to the absolute path (POSIX-shaped)
    // so the consumer at least has a usable string. `applyPathMapping`
    // strips leading `../` so escaping the repo collapses to a no-op.
    rel = abs;
  }
  return posixify(rel) || ".";
}

/**
 * In-memory variant of `readTsconfigResolution` used by tests. Takes a
 * raw tsconfig-shaped object and produces the same `TsconfigResolution`
 * the file-based path would, **but without** running TS's `extends` /
 * `${configDir}` / paths-inheritance pipeline. Production code paths
 * always go through `readTsconfigResolution`; this helper exists only
 * so unit tests can construct fixtures without touching disk.
 */
export function parseTsconfigResolution(parsed: {
  compilerOptions?: { baseUrl?: unknown; paths?: unknown };
}): TsconfigResolution {
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
  mappings.sort((a, b) => b.pattern.length - a.pattern.length);
  return { baseUrl, mappings };
}

function normalizeBaseUrl(raw: string): string {
  const cleaned = posixify(raw).replace(/\/+$/, "");
  return cleaned.length === 0 ? "." : cleaned;
}
