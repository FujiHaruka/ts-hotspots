import { createHash } from "node:crypto";
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { APP_DIR, projectKey, xdgCacheHome } from "../../util/appDirs.ts";
import type { CloneCandidateReport } from "../domain/report.ts";

const CACHE_FORMAT = 1;
const ENTRY_SUFFIX = ".json.gz";

interface CacheLimits {
  maxEntries: number;
  maxBytes: number;
}

export const DEFAULT_CACHE_LIMITS: CacheLimits = {
  maxEntries: 10,
  maxBytes: 200 * 1024 * 1024,
};

interface CacheEnvelope {
  format: number;
  report: CloneCandidateReport;
}

export function reportCacheDir(projectDir: string): string {
  return join(xdgCacheHome(), APP_DIR, projectKey(projectDir), "duplication");
}

export function reportCacheKey(input: object): string {
  return createHash("sha256")
    .update(JSON.stringify({ format: CACHE_FORMAT, input }))
    .digest("hex");
}

export function readCachedReport(
  dir: string,
  key: string,
): CloneCandidateReport | undefined {
  const path = join(dir, `${key}${ENTRY_SUFFIX}`);
  try {
    const parsed = JSON.parse(
      gunzipSync(readFileSync(path)).toString("utf8"),
    ) as CacheEnvelope;
    if (parsed.format !== CACHE_FORMAT) return undefined;
    if (parsed.report?.status !== "ok") return undefined;
    if (!Array.isArray(parsed.report.groups)) return undefined;
    const now = new Date();
    utimesSync(path, now, now);
    return parsed.report;
  } catch {
    return undefined;
  }
}

export function writeCachedReport(
  dir: string,
  key: string,
  report: CloneCandidateReport,
  limits: CacheLimits = DEFAULT_CACHE_LIMITS,
): void {
  try {
    mkdirSync(dir, { recursive: true });
    const path = join(dir, `${key}${ENTRY_SUFFIX}`);
    const tmp = `${path}.tmp-${String(process.pid)}-${String(Date.now())}`;
    const envelope: CacheEnvelope = { format: CACHE_FORMAT, report };
    writeFileSync(tmp, gzipSync(JSON.stringify(envelope)));
    renameSync(tmp, path);
    evictOldEntries(dir, limits);
  } catch {
    return;
  }
}

function evictOldEntries(dir: string, limits: CacheLimits): void {
  const entries = readdirSync(dir)
    .filter((name) => name.endsWith(ENTRY_SUFFIX))
    .map((name) => {
      const path = join(dir, name);
      const stat = statSync(path);
      return { path, mtimeMs: stat.mtimeMs, size: stat.size };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.path.localeCompare(b.path));
  let totalBytes = 0;
  entries.forEach((entry, index) => {
    totalBytes += entry.size;
    const keep =
      index === 0 ||
      (index < limits.maxEntries && totalBytes <= limits.maxBytes);
    if (!keep) rmSync(entry.path, { force: true });
  });
}
