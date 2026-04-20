import type { FunctionKind } from "../schema.ts";

export const DISMISSAL_REGISTRY_VERSION = 1 as const;
export const DISMISSAL_APP_DIR = "ts-hotspots";
export const DISMISSAL_REGISTRY_FILE = "dismissed.json";

export interface DismissalEntryDisplay {
  file?: string;
  name?: string;
  kind?: FunctionKind;
  startLine?: number;
}

export interface DismissalEntry {
  id: string;
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
