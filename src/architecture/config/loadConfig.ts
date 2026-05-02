/**
 * Read `.ts-hotspots.json` or `ts-hotspots.config.json` at `rootDir`,
 * extract the `architecture` block, and return a parsed `ArchConfig`.
 * Missing files / missing `architecture` block return
 * `EMPTY_ARCH_CONFIG`.
 *
 * Validation is strict: a config that exists but is malformed throws
 * `ArchConfigError` rather than silently falling back. Silent fallback
 * would mask user typos that change ranking results.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  type ArchConfig,
  ArchConfigError,
  type DownweightRule,
  EMPTY_ARCH_CONFIG,
} from "./types.ts";

const CANDIDATE_FILENAMES: readonly string[] = [
  ".ts-hotspots.json",
  "ts-hotspots.config.json",
];

export function loadArchConfig(rootDir: string): ArchConfig {
  for (const filename of CANDIDATE_FILENAMES) {
    const path = join(rootDir, filename);
    if (!existsSync(path)) continue;
    let raw: string;
    try {
      raw = readFileSync(path, "utf8");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ArchConfigError(`failed to read ${path}: ${msg}`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ArchConfigError(`invalid JSON in ${path}: ${msg}`);
    }
    return parseArchConfig(parsed, path);
  }
  return EMPTY_ARCH_CONFIG;
}

export function parseArchConfig(parsed: unknown, source: string): ArchConfig {
  if (parsed === null || typeof parsed !== "object") {
    throw new ArchConfigError(`${source}: top-level value must be an object`);
  }
  const root = parsed as Record<string, unknown>;
  const archBlock = root.architecture;
  if (archBlock === undefined) return EMPTY_ARCH_CONFIG;
  if (archBlock === null || typeof archBlock !== "object") {
    throw new ArchConfigError(`${source}: 'architecture' must be an object`);
  }
  const arch = archBlock as Record<string, unknown>;
  const downweight = parseDownweight(arch.downweight, source);
  return { downweight };
}

function parseDownweight(raw: unknown, source: string): DownweightRule[] {
  if (raw === undefined) return [];
  if (!Array.isArray(raw)) {
    throw new ArchConfigError(
      `${source}: 'architecture.downweight' must be an array`,
    );
  }
  const items = raw as readonly unknown[];
  const rules: DownweightRule[] = [];
  for (const [i, entry] of items.entries()) {
    if (entry === null || typeof entry !== "object") {
      throw new ArchConfigError(
        `${source}: 'architecture.downweight[${String(i)}]' must be an object`,
      );
    }
    const e = entry as Record<string, unknown>;
    const glob = e.glob;
    const factor = e.factor;
    if (typeof glob !== "string" || glob.trim().length === 0) {
      throw new ArchConfigError(
        `${source}: 'architecture.downweight[${String(i)}].glob' must be a non-empty string`,
      );
    }
    if (typeof factor !== "number" || !Number.isFinite(factor)) {
      throw new ArchConfigError(
        `${source}: 'architecture.downweight[${String(i)}].factor' must be a finite number`,
      );
    }
    if (factor < 0 || factor > 1) {
      throw new ArchConfigError(
        `${source}: 'architecture.downweight[${String(i)}].factor' must be in [0, 1] (got ${String(factor)})`,
      );
    }
    rules.push({ glob, factor });
  }
  return rules;
}
