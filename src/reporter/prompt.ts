export type ReportFeature = "complexity" | "duplication";

export const COMPLEXITY_REPORT_PROMPT = `# ts-hotspots report

This is the output of \`ts-hotspots\`, a static analyzer that scans a TypeScript project and surfaces likely refactor candidates (hotspots) based on multiple quality axes (complexity, length, nesting, side-effect density, and more).

## Your task

You have been handed a list of hotspot candidates below. For each one, \`ref\` gives a \`file:start-end\` coordinate (or \`file:line\` for single-line functions) and the function name; \`axes\` lists the quality axes on which it scored highly, and \`metrics\` shows the raw values for those axes. Each candidate also carries a \`dismissalId\` derived from its source — use it with the \`dismiss\` subcommand described below.

Walk the candidates **from the top of the list downward**, evaluating them one at a time, until you find one that genuinely warrants refactoring. For each candidate:

1. Read the code at its coordinate (and immediate callers/callees if needed for context).
2. Assess whether it actually warrants refactoring — metrics are heuristics, not verdicts. A high score can be a false positive (e.g. intentionally long config tables, generated code, a switch that is already the clearest form).
3. If it does **not** warrant work, briefly note why, then record the judgment by running \`ts-hotspots dismiss <dismissalId> --reason "<why>"\` so the candidate is filtered from future runs. The dismissal auto-expires the next time the function body is meaningfully edited, so the candidate will re-surface for re-evaluation when that happens. Move on to the next candidate.
4. If it **does**, stop the search and propose a concrete refactor plan scoped to that single hotspot. Do not continue down the list in the same pass.

If you reach the end of the list without finding a worthwhile target, say so rather than forcing a refactor. Focus on understanding before suggesting, and never propose refactors without reading the actual code.
`;

export const COMPLEXITY_ERROR_PROMPT = `# ts-hotspots error

\`ts-hotspots\` failed to produce a report. See the error details below.
`;

export const DUPLICATION_REPORT_PROMPT = `# ts-hotspots duplication report

This is the output of \`ts-hotspots duplication\`, a static analyzer that surfaces likely Type-3 (modified-with-renames) duplication in a TypeScript codebase. PR mode (\`<revrange>\`) pivots on fragments changed between two refs; whole-repo mode (\`--whole-repo\`) clusters mutually similar fragments across an entire ref.

## Your task

You have been handed a list of clone-candidate \`groups\` below. Each group has an \`anchor\` (PR mode) or none (whole-repo cluster), a \`members[]\` array of fragments judged similar enough, per-axis \`scores\` and group-level \`aggregateScores\` in the 0..1 range (\`tokenOverlap\`, \`statementKindSimilarity\`, \`callOverlap\`, \`sizeCompatibility\`, \`lengthScore\`, plus a \`combined\` summary), \`sharedEvidence\` listing the calls / properties / statement kinds / token n-grams every member has in common, and a \`recommendationHint\` (\`confidence\`, \`likelyRefactoring\`, \`riskFlags\`). Each fragment's \`location\` is \`file:start-end\` (or \`file:line\` for single-line fragments) and its \`kind\` is \`function\` / \`block\` / \`window\`.

Walk the groups **from the top of the list downward**, evaluating them one at a time, until you find one that genuinely warrants extracting a shared helper or otherwise unifying the duplication. For each group:

1. Read the anchor and each member at its coordinate.
2. Decide whether the duplication is real and reducible. Members can be shape-similar but bound to incompatible call sites, types, or naming conventions — those are not refactoring targets. The detector biases toward false positives (recall over precision); treat the actual code at the coordinates as the source of truth.
3. If the group does **not** warrant work, briefly note why and move on to the next group.
4. If it **does**, stop the search and propose a concrete extraction / parameterisation plan scoped to that single group. Do not continue down the list in the same pass.

If you reach the end of the list without finding a worthwhile target, say so rather than forcing a refactor. Focus on understanding before suggesting, and never propose refactors without reading the actual code.
`;

export const DUPLICATION_ERROR_PROMPT = `# ts-hotspots duplication error

\`ts-hotspots duplication\` failed to produce a report. See the error details below.
`;

export const REPORT_PROMPTS: Record<
  ReportFeature,
  { ok: string; error: string }
> = {
  complexity: {
    ok: COMPLEXITY_REPORT_PROMPT,
    error: COMPLEXITY_ERROR_PROMPT,
  },
  duplication: {
    ok: DUPLICATION_REPORT_PROMPT,
    error: DUPLICATION_ERROR_PROMPT,
  },
};
