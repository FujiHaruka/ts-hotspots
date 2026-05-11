import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { findGitRoot } from "../util/git/findGitRoot.ts";
import {
  DISMISSAL_APP_DIR,
  DISMISSAL_REGISTRY_FILE,
  DISMISSAL_REGISTRY_VERSION,
  type DismissalEntry,
  type DismissalFeature,
  type DismissalRegistry,
  emptyRegistry,
} from "./types.ts";

interface LoadOptions {
  onWarning?: (msg: string) => void;
}

function xdgConfigHome(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0 && isAbsolute(xdg)) return xdg;
  return join(homedir(), ".config");
}

function projectKey(absProjectPath: string): string {
  return createHash("sha256").update(absProjectPath).digest("hex").slice(0, 16);
}

export function registryPath(rootDir: string): string {
  const abs = resolve(rootDir);
  return join(
    xdgConfigHome(),
    DISMISSAL_APP_DIR,
    projectKey(abs),
    DISMISSAL_REGISTRY_FILE,
  );
}

/**
 * Pick the directory used as the registry key. The registry is shared
 * across all four features (comp, dup, arch, coch) for one project, so
 * the key has to be uniform regardless of which subcommand ran. When
 * `start` is inside a git repo we use the repo root; otherwise we fall
 * back to `start` itself so the dismissal flow keeps working in
 * non-git directories (only comp supports that today).
 */
export function resolveRegistryDir(start: string): string {
  try {
    return findGitRoot(resolve(start));
  } catch {
    return resolve(start);
  }
}

export function loadRegistry(
  rootDir: string,
  options: LoadOptions = {},
): DismissalRegistry {
  const path = registryPath(rootDir);
  if (!existsSync(path)) return emptyRegistry();
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return normalizeRegistry(parsed);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    options.onWarning?.(
      `ts-hotspots: ignoring invalid dismissal registry at ${path}: ${msg}`,
    );
    return emptyRegistry();
  }
}

export function saveRegistry(
  rootDir: string,
  registry: DismissalRegistry,
): void {
  const path = registryPath(rootDir);
  mkdirSync(dirname(path), { recursive: true });
  const body = `${JSON.stringify(registry, null, 2)}\n`;
  const tmp = `${path}.tmp-${String(process.pid)}-${String(Date.now())}`;
  writeFileSync(tmp, body, "utf8");
  renameSync(tmp, path);
}

interface PruneResult {
  registry: DismissalRegistry;
  prunedCount: number;
}

/**
 * Drop entries that belong to `feature` but whose id is no longer
 * produced by the current run. Entries from other features are left
 * alone — the registry is shared across all four subcommands and each
 * one only knows the ids of its own hotspots, so a comp run must not
 * decide that a dup / arch / coch entry is stale.
 */
export function pruneRegistry(
  registry: DismissalRegistry,
  feature: DismissalFeature,
  currentIds: ReadonlySet<string>,
): PruneResult {
  const kept: DismissalEntry[] = [];
  let prunedCount = 0;
  for (const entry of registry.entries) {
    if (entry.feature !== feature || currentIds.has(entry.id)) {
      kept.push(entry);
    } else {
      prunedCount += 1;
    }
  }
  return {
    registry: withEntries(registry, kept),
    prunedCount,
  };
}

export function registryIdSet(registry: DismissalRegistry): Set<string> {
  return new Set(registry.entries.map((e) => e.id));
}

export function findEntry(
  registry: DismissalRegistry,
  id: string,
): DismissalEntry | undefined {
  return registry.entries.find((e) => e.id === id);
}

export function addEntry(
  registry: DismissalRegistry,
  entry: DismissalEntry,
): { registry: DismissalRegistry; added: boolean } {
  if (findEntry(registry, entry.id) !== undefined) {
    return { registry, added: false };
  }
  return {
    registry: withEntries(registry, [...registry.entries, entry]),
    added: true,
  };
}

export function removeEntry(
  registry: DismissalRegistry,
  id: string,
): { registry: DismissalRegistry; removed: boolean } {
  const next = registry.entries.filter((e) => e.id !== id);
  const removed = next.length !== registry.entries.length;
  return {
    registry: withEntries(registry, next),
    removed,
  };
}

export function withProjectPath(
  registry: DismissalRegistry,
  projectPath: string,
): DismissalRegistry {
  return {
    version: DISMISSAL_REGISTRY_VERSION,
    projectPath,
    entries: registry.entries,
  };
}

function withEntries(
  registry: DismissalRegistry,
  entries: DismissalEntry[],
): DismissalRegistry {
  if (registry.projectPath === undefined) {
    return { version: DISMISSAL_REGISTRY_VERSION, entries };
  }
  return {
    version: DISMISSAL_REGISTRY_VERSION,
    projectPath: registry.projectPath,
    entries,
  };
}

function normalizeRegistry(parsed: unknown): DismissalRegistry {
  if (parsed === null || typeof parsed !== "object") {
    throw new Error("registry is not an object");
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== DISMISSAL_REGISTRY_VERSION) {
    throw new Error(`unsupported registry version: ${String(obj.version)}`);
  }
  if (!Array.isArray(obj.entries)) {
    throw new Error("registry.entries is not an array");
  }
  const entries: DismissalEntry[] = [];
  for (const raw of obj.entries) {
    if (raw === null || typeof raw !== "object") continue;
    const e = raw as Record<string, unknown>;
    if (typeof e.id !== "string" || typeof e.reason !== "string") continue;
    if (typeof e.dismissedAt !== "string") continue;
    const feature: DismissalEntry["feature"] =
      e.feature === "dup"
        ? "dup"
        : e.feature === "arch"
          ? "arch"
          : e.feature === "coch"
            ? "coch"
            : "comp";
    const entry: DismissalEntry = {
      id: migrateLegacyId(e.id, feature),
      feature,
      reason: e.reason,
      dismissedAt: e.dismissedAt,
    };
    if (e.display !== undefined && typeof e.display === "object") {
      entry.display = e.display as DismissalEntry["display"];
    }
    entries.push(entry);
  }
  if (typeof obj.projectPath === "string") {
    return {
      version: DISMISSAL_REGISTRY_VERSION,
      projectPath: obj.projectPath,
      entries,
    };
  }
  return { version: DISMISSAL_REGISTRY_VERSION, entries };
}

/**
 * Translate a pre-M2 dismissal id into the `<feature>:<hex>` form used by
 * post-M2 reports. Pre-M2 ids were the raw `sha256:<hex>` body hash;
 * post-M2 they are `<feature>:<hex>`. Anything that already carries a
 * feature prefix passes through untouched.
 */
function migrateLegacyId(
  rawId: string,
  feature: DismissalEntry["feature"],
): string {
  if (
    rawId.startsWith("comp:") ||
    rawId.startsWith("dup:") ||
    rawId.startsWith("arch:") ||
    rawId.startsWith("coch:")
  ) {
    return rawId;
  }
  const SHA256_PREFIX = "sha256:";
  const hex = rawId.startsWith(SHA256_PREFIX)
    ? rawId.slice(SHA256_PREFIX.length)
    : rawId;
  return `${feature}:${hex}`;
}
