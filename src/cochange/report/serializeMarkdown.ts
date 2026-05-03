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
import {
  type ClusterCandidate,
  type ClusterRow,
  collapseClusters,
} from "./collapseClusters.ts";
import {
  computeCochangeClusterDismissalId,
  computeCochangePairDismissalId,
} from "./dismissalId.ts";
import type { CochangeReportInput, SerializeOptions } from "./serializeJson.ts";

/** Mirrors the JSON serializer's slim cap on `recentCommits`. */
const RECENT_DISPLAY_CAP = 5;

export function serializeMarkdown(
  input: CochangeReportInput,
  opts: SerializeOptions,
): string {
  const lines: string[] = [];
  lines.push("# ts-hotspots cochange");
  lines.push("");

  // Match the JSON serializer's collapse rule so the two outputs agree
  // on row count and identity. Anchor mode is pair-only by design.
  const isAnchorMode = input.candidates.some((c) => c.anchor !== undefined);
  const rows: ClusterRow[] = isAnchorMode
    ? input.candidates.map((c) => ({ kind: "pair", candidate: c }))
    : collapseClusters(input.candidates);

  lines.push(...renderHeader(input, opts, rows.length));
  lines.push("");

  if (rows.length === 0) {
    lines.push("No cochange candidates found.");
    lines.push("");
    return lines.join("\n");
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row === undefined) continue;
    lines.push(...renderRow(i + 1, row, input, opts));
    lines.push("");
  }

  return lines.join("\n");
}

function renderHeader(
  input: CochangeReportInput,
  opts: SerializeOptions,
  displayedCount: number,
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
    lines.push(`- displayed: ${String(displayedCount)}`);
  }
  return lines;
}

function renderRow(
  rank: number,
  row: ClusterRow,
  input: CochangeReportInput,
  opts: SerializeOptions,
): string[] {
  return row.kind === "pair"
    ? renderCard(rank, row.candidate, input, opts)
    : renderClusterCard(rank, row.cluster, opts);
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
  const score = c.metrics.support * c.metrics.confidenceMax;
  lines.push(`- score: supportConfidence = ${formatScore(score)}`);
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
    const recentDisplay = c.recent.slice(0, RECENT_DISPLAY_CAP);
    const shownRecent = recentDisplay.map((sha) => `\`${sha}\``).join(", ");
    lines.push(`- recent commits: ${shownRecent}`);
    if (opts.verbose) {
      const first = c.recent[0];
      const last = c.recent[c.recent.length - 1];
      if (first !== undefined && last !== undefined) {
        lines.push(`- co-change window: \`${first}\` -> \`${last}\``);
      }
      const shownAll = c.recent.map((sha) => `\`${sha}\``).join(", ");
      lines.push(`- all co-change commits: ${shownAll}`);
    }
  }
  lines.push(
    `- dismissalId: \`${computeCochangePairDismissalId(c.pathA, c.pathB)}\``,
  );
  return lines;
}

function renderClusterCard(
  rank: number,
  cluster: ClusterCandidate,
  opts: SerializeOptions,
): string[] {
  const lines: string[] = [];
  lines.push(
    `## #${String(rank)} Cluster (${String(cluster.members.length)} files)`,
  );
  lines.push("");
  lines.push(`- score: supportConfidence = ${formatScore(cluster.scoreMax)}`);
  lines.push(
    `- support (median across ${String(cluster.pairs.length)} pairs): ${formatScore(cluster.supportMedian)}`,
  );
  lines.push(
    `- confidenceMax (max across pairs): ${formatRatio(cluster.confidenceMaxOverall)}`,
  );
  lines.push(`- lift (median across pairs): ${formatLift(cluster.liftMedian)}`);
  lines.push("- members:");
  for (const m of cluster.members) {
    lines.push(`  - ${m}`);
  }
  if (cluster.recentUnion.length === 0) {
    lines.push("- recent commits: (none recorded)");
  } else {
    const recentDisplay = cluster.recentUnion.slice(0, RECENT_DISPLAY_CAP);
    const shownRecent = recentDisplay.map((sha) => `\`${sha}\``).join(", ");
    lines.push(`- recent commits (union across pairs): ${shownRecent}`);
    if (opts.verbose) {
      const first = cluster.recentUnion[0];
      const last = cluster.recentUnion[cluster.recentUnion.length - 1];
      if (first !== undefined && last !== undefined) {
        lines.push(`- co-change window: \`${first}\` -> \`${last}\``);
      }
      const shownAll = cluster.recentUnion
        .map((sha) => `\`${sha}\``)
        .join(", ");
      lines.push(`- all co-change commits: ${shownAll}`);
    }
  }
  lines.push(
    `- dismissalId: \`${computeCochangeClusterDismissalId(cluster.members)}\``,
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

function formatScore(v: number): string {
  if (!Number.isFinite(v)) return String(v);
  return v.toFixed(3);
}
