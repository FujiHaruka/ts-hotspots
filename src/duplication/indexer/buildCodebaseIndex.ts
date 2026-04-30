import type { Config } from "../config/config.ts";
import type { Fragment } from "../domain/fragment.ts";
import { extractFragments } from "./extractFragments.ts";
import { parseSource } from "./parseSource.ts";

export interface SourceInput {
  /** Relative path; used as-is for `Fragment.filePath`. */
  path: string;
  text: string;
}

/**
 * Build the in-memory codebase fragment index for v1.
 *
 * Given a collection of `.ts` / `.tsx` sources, parse each and concatenate
 * their extracted fragments in input order. Preserves determinism:
 * identical inputs yield identical output (ids included).
 */
export function buildCodebaseIndex(
  sources: readonly SourceInput[],
  config: Config,
): Fragment[] {
  const result: Fragment[] = [];
  for (const source of sources) {
    const parsed = parseSource(source.path, source.text);
    const fragments = extractFragments(parsed, config);
    result.push(...fragments);
  }
  return result;
}
