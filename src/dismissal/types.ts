import type { FunctionKind } from "../schema.ts";
import { APP_DIR } from "../util/appDirs.ts";

export const DISMISSAL_REGISTRY_VERSION = 1 as const;
export const DISMISSAL_APP_DIR = APP_DIR;
export const DISMISSAL_REGISTRY_FILE = "dismissed.json";

interface DismissalEntryDisplay {
  file?: string;
  name?: string;
  kind?: FunctionKind;
  startLine?: number;
}

export type DismissalFeature = "comp" | "dup" | "arch" | "coch";

export interface DismissalEntry {
  /**
   * `<feature>:<hex>` form (e.g. `comp:abc123...`, `arch:def456...`).
   * Encodes the source feature in the prefix so `dismiss` / `undismiss`
   * can route on the id alone without a `--feature` flag. Pre-M2 entries
   * (`sha256:<hex>`) are migrated to `comp:<hex>` on load.
   */
  id: string;
  /**
   * Mirrors the `<feature>` prefix in `id`. Stored explicitly so the
   * registry stays self-describing for tools that filter by feature.
   */
  feature: DismissalFeature;
  reason: string;
  dismissedAt: string;
  display?: DismissalEntryDisplay;
}

export interface DismissalRegistry {
  version: typeof DISMISSAL_REGISTRY_VERSION;
  projectPath?: string;
  entries: DismissalEntry[];
}

export function emptyRegistry(): DismissalRegistry {
  return { version: DISMISSAL_REGISTRY_VERSION, entries: [] };
}
