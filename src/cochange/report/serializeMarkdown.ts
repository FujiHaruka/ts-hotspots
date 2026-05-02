/**
 * Render a cochange report as Markdown. Pure function: takes the same
 * `CochangeReportInput` the JSON serializer accepts and returns the full
 * document as a string. Layout is card-per-hotspot (one section per pair)
 * with a header summarising the analysed window, the gate counts, and the
 * file count, matching the agent-readable density of the other subcommands'
 * reports.
 *
 * Slim cards show the five raw metrics plus the recent-commit evidence.
 * Verbose adds the conditional-probability denominators and the full SHA
 * list / first-last window endpoints.
 */

import type { Candidate } from "../ranking/types.ts";
import { computeCochangePairDismissalId } from "./dismissalId.ts";
import type { CochangeReportInput, SerializeOptions } from "./serializeJson.ts";

export function serializeMarkdown(
  input: CochangeReportInput,
  opts: SerializeOptions,
): string {
  const lines: string[] = [];
  lines.push("# ts-hotspots cochange");
  lines.push("");
  lines.push(...renderHeader(input, opts));
  lines.push("");

  if (input.candidates.length === 0) {
    lines.push("No cochange candidates found.");
    lines.push("");
    return lines.join("\n");
  }

  for (let i = 0; i < input.candidates.length; i++) {
    const c = input.candidates[i];
    if (c === undefined) continue;
    lines.push(...renderCard(i + 1, c, input, opts));
    lines.push("");
  }

  return lines.join("\n");
}

function renderHeader(
  input: CochangeReportInput,
  opts: SerializeOptions,
): string[] {
  const lines: string[] = [];
  if (input.diff !== undefined) {
    lines.push(
      `- diff: \`${input.diff.baseSha}\` -> \`${input.diff.headSha}\` (${String(input.diff.changedFiles)} files changed)`,
    );
  }
  lines.push(
    `- files analyzed: ${String(input.analyzedFileCount)}`,
    `- window: ${String(input.actualWindow)} of ${String(input.requestedWindow)} commits`,
    `- pairs before gate: ${String(input.pairCandidateCountBeforeGate)}`,
    `- pairs after gate: ${String(input.pairsAfterGate)}`,
    `- commits skipped (large-change): ${String(input.commitsSkippedAsLargeChange)}`,
  );
  if (opts.verbose) {
    lines.push(`- displayed: ${String(input.candidates.length)}`);
  }
  return lines;
}

function renderCard(
  rank: number,
  c: Candidate,
  input: CochangeReportInput,
  opts: SerializeOptions,
): string[] {
  const lines: string[] = [];
  if (c.anchor !== undefined) {
    const partner = c.anchor === c.pathA ? c.pathB : c.pathA;
    lines.push(`## #${String(rank)} ${c.anchor} -> ${partner}`);
  } else {
    lines.push(`## #${String(rank)} ${c.pathA} <-> ${c.pathB}`);
  }
  lines.push("");
  lines.push(
    `- score: confidenceMax = ${formatRatio(c.metrics.confidenceMax)}`,
  );
  lines.push(`- support: ${String(c.metrics.support)}`);
  lines.push(
    `- confidenceAtoB: ${formatRatio(c.metrics.confidenceAtoB)} (P(B | A))`,
    `- confidenceBtoA: ${formatRatio(c.metrics.confidenceBtoA)} (P(A | B))`,
    `- lift: ${formatLift(c.metrics.lift)}`,
  );
  if (opts.verbose) {
    lines.push(
      `- changesOfA: ${String(input.perFileChanges.get(c.pathA) ?? 0)}`,
      `- changesOfB: ${String(input.perFileChanges.get(c.pathB) ?? 0)}`,
    );
  }
  if (c.recent.length === 0) {
    lines.push("- recent commits: (none recorded)");
  } else {
    const shown = c.recent.map((sha) => `\`${sha}\``).join(", ");
    lines.push(`- recent commits: ${shown}`);
    if (opts.verbose) {
      const first = c.recent[0];
      const last = c.recent[c.recent.length - 1];
      if (first !== undefined && last !== undefined) {
        lines.push(`- co-change window: \`${first}\` -> \`${last}\``);
      }
      lines.push(`- all co-change commits: ${shown}`);
    }
  }
  lines.push(
    `- dismissalId: \`${computeCochangePairDismissalId(c.pathA, c.pathB)}\``,
  );
  return lines;
}

function formatRatio(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  return v.toFixed(3);
}

function formatLift(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  return v.toFixed(2);
}
