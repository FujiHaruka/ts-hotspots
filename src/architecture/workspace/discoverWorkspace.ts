/**
 * Decide whether the repo at `repoRoot` is a workspace, and if so
 * enumerate its package directories.
 *
 * Discovery sources (in priority order):
 *   1. `pnpm-workspace.yaml` — `packages:` block.
 *   2. `package.json#workspaces` — string array, or `{ packages: [...] }`.
 *
 * Both sources contribute *patterns* (literal dirs, single-segment
 * globs, optional `!` negations); `expandPackageGlobs` walks the
 * filesystem to turn those into a sorted list of package roots that
 * actually have a `package.json`.
 *
 * Returns `null` when no workspace declaration exists at all — single-
 * package mode. The empty result `{ mode, packageRoots: [] }` only
 * happens when a workspace declaration is present but matches no
 * directories.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path/posix";
import { expandPackageGlobs } from "./expandPackageGlobs.ts";
import { parsePnpmWorkspaceYaml } from "./parsePnpmWorkspace.ts";

type WorkspaceMode = "pnpm-workspace" | "package-json-workspaces";

interface DiscoveredWorkspace {
  readonly mode: WorkspaceMode;
  /** Repo-relative POSIX directory paths, sorted. */
  readonly packageRoots: readonly string[];
}

interface RootPackageJson {
  workspaces?: unknown;
}

function readPnpmWorkspacePatterns(repoRoot: string): string[] | null {
  let text: string;
  try {
    text = readFileSync(join(toPosix(repoRoot), "pnpm-workspace.yaml"), "utf8");
  } catch {
    return null;
  }
  return parsePnpmWorkspaceYaml(text);
}

function readPackageJsonWorkspaces(repoRoot: string): string[] | null {
  let text: string;
  try {
    text = readFileSync(join(toPosix(repoRoot), "package.json"), "utf8");
  } catch {
    return null;
  }
  let parsed: RootPackageJson;
  try {
    parsed = JSON.parse(text) as RootPackageJson;
  } catch {
    return null;
  }
  const ws = parsed.workspaces;
  if (Array.isArray(ws)) {
    return ws.filter((s): s is string => typeof s === "string");
  }
  if (ws !== null && typeof ws === "object" && "packages" in ws) {
    const inner = (ws as { packages?: unknown }).packages;
    if (Array.isArray(inner)) {
      return inner.filter((s): s is string => typeof s === "string");
    }
  }
  return null;
}

export function discoverWorkspace(
  repoRoot: string,
): DiscoveredWorkspace | null {
  const pnpmPatterns = readPnpmWorkspacePatterns(repoRoot);
  if (pnpmPatterns !== null) {
    const { roots } = expandPackageGlobs(repoRoot, pnpmPatterns);
    return { mode: "pnpm-workspace", packageRoots: roots };
  }
  const npmPatterns = readPackageJsonWorkspaces(repoRoot);
  if (npmPatterns !== null) {
    const { roots } = expandPackageGlobs(repoRoot, npmPatterns);
    return { mode: "package-json-workspaces", packageRoots: roots };
  }
  return null;
}

function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}
