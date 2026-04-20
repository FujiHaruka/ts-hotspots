import { dirname, resolve } from "node:path";
import { enumerateDeclarations } from "../collectors/enumerate-declarations.ts";
import { enumerateSourceFiles } from "../collectors/enumerate-source-files.ts";
import { computeBodyHash } from "../dismissal/hash.ts";
import {
  addEntry,
  findEntry,
  loadRegistry,
  registryPath,
  removeEntry,
  saveRegistry,
  withProjectPath,
} from "../dismissal/store.ts";
import type { DismissalEntry } from "../dismissal/types.ts";
import { loadProject } from "../loader/load-project.ts";

export interface WritableLike {
  write: (chunk: string) => void;
}

export interface DismissOptions {
  id: string;
  reason: string;
  tsconfigPath: string;
}

export function runDismiss(
  options: DismissOptions,
  stdout: WritableLike,
  stderr: WritableLike,
): number {
  const rootDir = resolve(dirname(options.tsconfigPath));
  const registry = loadRegistry(rootDir, {
    onWarning: (msg) => {
      stderr.write(`${msg}\n`);
    },
  });
  if (findEntry(registry, options.id) !== undefined) {
    stdout.write(`ts-hotspots: ${options.id} is already dismissed\n`);
    return 0;
  }
  const entry: DismissalEntry = {
    id: options.id,
    reason: options.reason,
    dismissedAt: new Date().toISOString(),
  };
  const display = tryResolveDisplay(options.tsconfigPath, options.id, stderr);
  if (display !== undefined) entry.display = display;
  const { registry: next } = addEntry(registry, entry);
  saveRegistry(rootDir, withProjectPath(next, rootDir));
  stdout.write(
    `ts-hotspots: dismissed ${options.id} (${registryPath(rootDir)})\n`,
  );
  return 0;
}

export interface ListDismissedOptions {
  tsconfigPath: string;
  json: boolean;
}

export function runListDismissed(
  options: ListDismissedOptions,
  stdout: WritableLike,
  stderr: WritableLike,
): number {
  const rootDir = resolve(dirname(options.tsconfigPath));
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
  tsconfigPath: string;
}

export function runUndismiss(
  options: UndismissOptions,
  stdout: WritableLike,
  stderr: WritableLike,
): number {
  const rootDir = resolve(dirname(options.tsconfigPath));
  const registry = loadRegistry(rootDir, {
    onWarning: (msg) => {
      stderr.write(`${msg}\n`);
    },
  });
  const { registry: next, removed } = removeEntry(registry, options.id);
  if (!removed) {
    stderr.write(`ts-hotspots: ${options.id} not found in registry\n`);
    return 1;
  }
  saveRegistry(rootDir, withProjectPath(next, rootDir));
  stdout.write(`ts-hotspots: removed ${options.id}\n`);
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
      if (computeBodyHash(d.node) === id) {
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
