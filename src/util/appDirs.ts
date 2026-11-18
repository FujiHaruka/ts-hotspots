import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export const APP_DIR = "ts-hotspots";

function xdgDir(envName: string, fallback: string): string {
  const value = process.env[envName];
  if (value && value.length > 0 && isAbsolute(value)) return value;
  return join(homedir(), fallback);
}

export function xdgConfigHome(): string {
  return xdgDir("XDG_CONFIG_HOME", ".config");
}

export function xdgCacheHome(): string {
  return xdgDir("XDG_CACHE_HOME", ".cache");
}

export function projectKey(projectDir: string): string {
  return createHash("sha256")
    .update(resolve(projectDir))
    .digest("hex")
    .slice(0, 16);
}
