/**
 * Cochange pair walker. Consumes `git log --first-parent -m --name-status -M`
 * output (with `--format=tformat:CMT %h` so commit boundaries carry the short
 * SHA) and produces the raw co-occurrence map cochange ranks against.
 *
 * The walker is pure: it takes the log string and a tracked file-set and
 * returns the data layer cochange's metrics step consumes. Higher layers
 * (gate, sort, schema) are not this module's concern.
 */

import { walkChurnLog } from "../../util/git/walkChurnLog.ts";

export interface PairEvidence {
  support: number;
  /**
   * All short SHAs where the pair was co-touched (newest → oldest, walk
   * order). Length matches `support`; the serializer is responsible for
   * truncating to the 5-SHA slim display cap when needed.
   */
  recent: string[];
}

export interface WalkCochangeOptions {
  prefix?: string;
  /**
   * Drop commits whose surviving (canonical, tracked) file count exceeds this
   * threshold. The count is taken AFTER mapping to canonical paths and
   * intersecting with `fileSet`, so an unrelated 200-file mass-rename whose
   * tracked-and-canonical fan-out is 5 still counts as 5.
   */
  maxFilesPerCommit: number;
}

export interface WalkCochangeResult {
  perFileChanges: Map<string, number>;
  pairs: Map<string, PairEvidence>;
  /**
   * Total number of commits the walk consumed (every `CMT` boundary line),
   * including those skipped by the `maxFilesPerCommit` filter. The spec
   * defines `actualWindow` as commits-the-walk-saw, not the post-filter set.
   */
  actualWindow: number;
  commitsSkippedAsLargeChange: number;
}

export function walkCochange(
  rawLog: string,
  fileSet: ReadonlySet<string>,
  options: WalkCochangeOptions,
): WalkCochangeResult {
  const perFileChanges = new Map<string, number>();
  const pairs = new Map<string, PairEvidence>();
  let actualWindow = 0;
  let commitsSkippedAsLargeChange = 0;

  let currentSha: string | undefined;
  let touched = new Set<string>();
  let commitOpen = false;

  const flushCurrentCommit = (): void => {
    if (!commitOpen) return;
    actualWindow++;
    if (touched.size === 0) return;
    if (touched.size > options.maxFilesPerCommit) {
      commitsSkippedAsLargeChange++;
      return;
    }
    for (const path of touched) {
      perFileChanges.set(path, (perFileChanges.get(path) ?? 0) + 1);
    }
    if (touched.size >= 2) {
      const sorted = [...touched].sort();
      const sha = currentSha;
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const key = makePairKey(sorted[i]!, sorted[j]!);
          let entry = pairs.get(key);
          if (entry === undefined) {
            entry = { support: 0, recent: [] };
            pairs.set(key, entry);
          }
          entry.support++;
          if (sha !== undefined) {
            entry.recent.push(sha);
          }
        }
      }
    }
  };

  walkChurnLog(
    rawLog,
    fileSet,
    { prefix: options.prefix },
    {
      onCommit: (sha) => {
        flushCurrentCommit();
        currentSha = sha;
        touched = new Set();
        commitOpen = true;
      },
      onChange: (canonical) => {
        touched.add(canonical);
      },
    },
  );
  flushCurrentCommit();

  return { perFileChanges, pairs, actualWindow, commitsSkippedAsLargeChange };
}

export function makePairKey(a: string, b: string): string {
  return a < b ? `${a} ${b}` : `${b} ${a}`;
}

export function parsePairKey(key: string): [string, string] {
  const sep = key.indexOf(" ");
  return [key.slice(0, sep), key.slice(sep + 1)];
}
