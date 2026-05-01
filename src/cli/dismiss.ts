import { dirname, resolve } from "node:path";
import { enumerateDeclarations } from "../collectors/enumerate-declarations.ts";
import { enumerateSourceFiles } from "../collectors/enumerate-source-files.ts";
import {
  bodyHashToCompDismissalId,
  computeBodyHash,
  normalizeDismissalId,
} from "../dismissal/hash.ts";
import {
  addEntry,
  findEntry,
  loadRegistry,
  registryPath,
  removeEntry,
  saveRegistry,
  withProjectPath,
} from "../dismissal/store.ts";
import type { DismissalEntry, DismissalFeature } from "../dismissal/types.ts";
import { loadProject } from "../loader/load-project.ts";

export interface WritableLike {
  write: (chunk: string) => void;
}

export interface DismissOptions {
  id: string;
  reason: string;
  /** Project root used as the registry key. */
  rootDir: string;
  /**
   * Discriminator stored on the entry. Pre-M5 registries default
   * legacy ids to `"comp"` on load (see `migrateLegacyId`); supplying
   * the explicit feature here keeps freshly-added entries self-describing
   * regardless of id format.
   */
  feature: DismissalFeature;
  /**
   * Optional ts-morph project entry point. When present (comp), the
   * dismiss subcommand walks declarations to fill in the entry's
   * `display` fields. Omit for `dup` ids — there is no equivalent
   * cheap resolver, and dup display can be reconstructed by re-running
   * the detector when needed.
   */
  tsconfigPath?: string;
}

export function runDismiss(
  options: DismissOptions,
  stdout: WritableLike,
  stderr: WritableLike,
): number {
  const id = normalizeDismissalId(options.id);
  const rootDir = resolve(options.rootDir);
  const registry = loadRegistry(rootDir, {
    onWarning: (msg) => {
      stderr.write(`${msg}\n`);
    },
  });
  if (findEntry(registry, id) !== undefined) {
    stdout.write(`ts-hotspots: ${id} is already dismissed\n`);
    return 0;
  }
  const entry: DismissalEntry = {
    id,
    feature: options.feature,
    reason: options.reason,
    dismissedAt: new Date().toISOString(),
  };
  if (options.feature === "comp" && options.tsconfigPath !== undefined) {
    const display = tryResolveDisplay(options.tsconfigPath, id, stderr);
    if (display !== undefined) entry.display = display;
  }
  const { registry: next } = addEntry(registry, entry);
  saveRegistry(rootDir, withProjectPath(next, rootDir));
  stdout.write(`ts-hotspots: dismissed ${id} (${registryPath(rootDir)})\n`);
  return 0;
}

export interface ListDismissedOptions {
  rootDir: string;
  json: boolean;
}

export function runListDismissed(
  options: ListDismissedOptions,
  stdout: WritableLike,
  stderr: WritableLike,
): number {
  const rootDir = resolve(options.rootDir);
  const registry = loadRegistry(rootDir, {
    onWarning: (msg) => {
      stderr.write(`${msg}\n`);
    },
  });
  if (options.json) {
    stdout.write(`${JSON.stringify(registry, null, 2)}\n`);
    return 0;
  }
  if (registry.entries.length === 0) {
    stdout.write("(no dismissed entries)\n");
    return 0;
  }
  for (const e of registry.entries) {
    const loc =
      e.display?.file !== undefined
        ? `${e.display.file}:${formatLine(e.display.startLine)} ${e.display.name ?? ""}`.trim()
        : "(unresolved)";
    stdout.write(`${e.id}  ${loc}\n  reason: ${e.reason}\n`);
  }
  return 0;
}

export interface UndismissOptions {
  id: string;
  rootDir: string;
}

export function runUndismiss(
  options: UndismissOptions,
  stdout: WritableLike,
  stderr: WritableLike,
): number {
  const id = normalizeDismissalId(options.id);
  const rootDir = resolve(options.rootDir);
  const registry = loadRegistry(rootDir, {
    onWarning: (msg) => {
      stderr.write(`${msg}\n`);
    },
  });
  const { registry: next, removed } = removeEntry(registry, id);
  if (!removed) {
    stderr.write(`ts-hotspots: ${id} not found in registry\n`);
    return 1;
  }
  saveRegistry(rootDir, withProjectPath(next, rootDir));
  stdout.write(`ts-hotspots: removed ${id}\n`);
  return 0;
}

function formatLine(line: number | undefined): string {
  return line === undefined ? "?" : String(line);
}

function tryResolveDisplay(
  tsconfigPath: string,
  id: string,
  stderr: WritableLike,
): DismissalEntry["display"] | undefined {
  try {
    const { project } = loadProject({ tsconfigPath });
    const rootDir = dirname(tsconfigPath);
    const files = enumerateSourceFiles(project, rootDir);
    const declarations = enumerateDeclarations(project, rootDir, { files });
    for (const d of declarations) {
      if (bodyHashToCompDismissalId(computeBodyHash(d.node)) === id) {
        return {
          file: d.file,
          name: d.name,
          kind: d.kind,
          startLine: d.line,
        };
      }
    }
    return undefined;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    stderr.write(
      `ts-hotspots: could not resolve display fields for ${id}: ${msg}\n`,
    );
    return undefined;
  }
}
