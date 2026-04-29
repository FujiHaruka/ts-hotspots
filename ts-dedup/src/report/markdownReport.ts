import type {
  CloneGroup,
  FragmentView,
  GroupMember,
} from "../domain/cloneGroup.ts";
import type {
  AnalysisSummary,
  CloneCandidateReport,
  Evidence,
  RecommendationHint,
} from "../domain/report.ts";

/**
 * Render a `CloneCandidateReport` as Markdown intended for an AI reader.
 *
 * Header / metadata always renders, even when `groups` is empty. Each
 * group contributes a numbered section that names its anchor, lists every
 * member with per-pair scores and risk flags, and includes the fragment
 * source as fenced ```ts blocks.
 *
 * Anchor / member labels are mode-aware: PR mode tags the anchor as
 * `changed:` and members as `existing:`; whole-repo mode uses neutral
 * `anchor:` / `member:` because both sides are matching peers.
 *
 * Output ends with a single trailing newline and is fully deterministic
 * given the input.
 */
export function buildMarkdownReport(report: CloneCandidateReport): string {
  const lines: string[] = [];
  lines.push("# ts-dedup report");
  lines.push("");
  lines.push(`mode: ${report.summary.mode}`);
  if (report.summary.mode === "pr") {
    lines.push(`base: ${report.pr.baseSha}`);
    lines.push(`head: ${report.pr.headSha}`);
  } else {
    lines.push(`ref: ${report.pr.headSha}`);
  }
  lines.push(`groups: ${String(report.groups.length)}`);
  lines.push("");
  renderSummary(lines, report.summary);

  const labels = sideLabels(report.summary.mode);
  for (let i = 0; i < report.groups.length; i++) {
    const g = report.groups[i];
    if (g === undefined) continue;
    lines.push("");
    renderGroup(lines, g, i + 1, labels);
  }

  return `${lines.join("\n")}\n`;
}

function sideLabels(mode: AnalysisSummary["mode"]): {
  anchor: string;
  member: string;
} {
  return mode === "pr"
    ? { anchor: "changed", member: "existing" }
    : { anchor: "anchor", member: "member" };
}

function renderSummary(lines: string[], summary: AnalysisSummary): void {
  lines.push("## scope");
  lines.push("");
  if (summary.mode === "pr" && summary.scope.changed !== undefined) {
    lines.push(`- changed: ${formatScope(summary.scope.changed)}`);
    lines.push(`- base:    ${formatScope(summary.scope.base)}`);
  } else {
    lines.push(`- repo:    ${formatScope(summary.scope.base)}`);
  }
  lines.push(
    `- candidate pairs: ${String(summary.pipeline.candidatePairs)} raw → ${String(summary.pipeline.reportedPairs)} reported`,
  );
}

function formatScope(s: AnalysisSummary["scope"]["base"]): string {
  const k = s.fragmentsByKind;
  const kindStr = `function ${String(k.function)} / block ${String(k.block)} / window ${String(k.window)}`;
  const excluded =
    s.excludedFiles === 0 ? "" : ` (${String(s.excludedFiles)} excluded)`;
  return `${String(s.files)} files${excluded}, ${String(s.lines)} lines, ${String(s.fragments)} fragments [${kindStr}]`;
}

function renderGroup(
  lines: string[],
  g: CloneGroup,
  index: number,
  labels: { anchor: string; member: string },
): void {
  const header =
    g.anchor !== undefined
      ? `## ${String(index)}. ${formatRange(g.anchor)} [size ${String(g.size)}]`
      : `## Cluster #${String(index)} [size ${String(g.size)}]`;
  lines.push(header);
  lines.push("");
  const agg = g.aggregateScores;
  lines.push(
    `- combined: ${fmtAxis(agg.combined.min, agg.combined.median, agg.combined.max)}`,
  );
  lines.push(
    `- token: ${fmtAxis(agg.tokenOverlap.min, agg.tokenOverlap.median, agg.tokenOverlap.max)}, statement: ${fmtAxis(agg.statementKindSimilarity.min, agg.statementKindSimilarity.median, agg.statementKindSimilarity.max)}, call: ${fmtAxis(agg.callOverlap.min, agg.callOverlap.median, agg.callOverlap.max)}`,
  );
  renderHint(lines, g.recommendationHint);
  lines.push("");
  lines.push("shared evidence (every member):");
  renderEvidence(lines, g.sharedEvidence);

  if (g.anchor?.code !== undefined) {
    lines.push("");
    lines.push(`${labels.anchor}:`);
    pushFencedCode(lines, g.anchor.code);
  }

  for (let i = 0; i < g.members.length; i++) {
    const m = g.members[i];
    if (m === undefined) continue;
    renderMember(lines, m, i + 1, labels);
  }
}

function renderMember(
  lines: string[],
  m: GroupMember,
  index: number,
  labels: { anchor: string; member: string },
): void {
  lines.push("");
  lines.push(`### member ${String(index)}: ${formatRange(m.fragment)}`);
  lines.push("");
  lines.push(`- combined: ${fmt(m.scores.combined)}`);
  lines.push(
    `- token: ${fmt(m.scores.tokenOverlap)}, statement: ${fmt(m.scores.statementKindSimilarity)}, call: ${fmt(m.scores.callOverlap)}, size: ${fmt(m.scores.sizeCompatibility)}, length: ${fmt(m.scores.lengthScore)}`,
  );
  lines.push("");
  lines.push("evidence:");
  renderEvidence(lines, m.evidence);
  if (m.fragment.code !== undefined) {
    lines.push("");
    lines.push(`${labels.member}:`);
    pushFencedCode(lines, m.fragment.code);
  }
}

function renderHint(lines: string[], hint: RecommendationHint): void {
  lines.push(
    `- confidence: ${hint.confidence} / refactoring: ${hint.likelyRefactoring}`,
  );
  const risks =
    hint.riskFlags.length === 0 ? "(none)" : hint.riskFlags.join(", ");
  lines.push(`- risks: ${risks}`);
}

function renderEvidence(lines: string[], e: Evidence): void {
  lines.push(`- shared calls: ${joinOrNone(e.sharedCalls)}`);
  lines.push(`- shared properties: ${joinOrNone(e.sharedProperties)}`);
  lines.push(
    `- matched statement kinds: ${joinOrNone(e.matchedStatementKinds)}`,
  );
  lines.push(
    `- matched token n-grams (sample): ${joinOrNone(e.matchedTokenNgramsSample)}`,
  );
}

function formatRange(view: FragmentView): string {
  return `${view.filePath}:${String(view.startLine)}-${String(view.endLine)} (${view.kind})`;
}

function pushFencedCode(lines: string[], code: string): void {
  // CommonMark: a fenced block ends at the first line whose fence is at least
  // as long as the opener. Use one more backtick than the longest run inside
  // the code so a literal ``` in the source cannot terminate the fence.
  const fence = "`".repeat(Math.max(3, longestBacktickRun(code) + 1));
  lines.push(`${fence}ts`);
  lines.push(code);
  lines.push(fence);
}

function longestBacktickRun(s: string): number {
  let max = 0;
  const re = /`+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    if (m[0].length > max) max = m[0].length;
  }
  return max;
}

function joinOrNone(xs: readonly string[]): string {
  return xs.length === 0 ? "(none)" : xs.join(", ");
}

function fmt(n: number): string {
  // Two-decimal display keeps markdown compact and deterministic.
  return n.toFixed(2);
}

function fmtAxis(min: number, median: number, max: number): string {
  return `${fmt(min)}/${fmt(median)}/${fmt(max)}`;
}
