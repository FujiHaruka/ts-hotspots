export type ReportFeature = "complexity" | "duplication";

export const COMPLEXITY_REPORT_PROMPT = `# ts-hotspots report

This is the output of \`ts-hotspots\`, a static analyzer that scans a TypeScript project and surfaces likely refactor candidates (hotspots) based on multiple quality axes (complexity, length, nesting, side-effect density, and more).

## Your task

You have been handed a list of hotspot candidates below in \`hotspots[]\`. Each candidate has \`kind: "complexity"\`, a \`ref\` giving a \`file:start-end\` coordinate (or \`file:line\` for single-line functions) and the function name, a \`score\` (\`{ axis, value }\` — the metric where this candidate ranked highest), a \`metrics\` map with the raw values for every quality axis it hit, and a \`dismissalId\` derived from its source — use the id with the \`dismiss\` subcommand described below.

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

You have been handed a list of clone-candidate hotspots below in \`hotspots[]\`. Each hotspot has \`kind: "duplication"\`, an optional \`anchor\` (PR mode pivots on the changed-side fragment; whole-repo mode has no anchor), a \`members[]\` array of fragments judged similar enough, a \`score\` (\`{ axis: "combined", value }\` — median \`combined\` similarity across pairs, in the 0..1 range), and \`evidence\` listing the top \`calls\` and \`properties\` every member has in common. Each fragment's \`ref.location\` is \`file:start-end\` (or \`file:line\` for single-line fragments) and \`ref.kind\` is \`function\` / \`block\` / \`window\`. Each hotspot also carries a \`dismissalId\` (\`dup:<hex>\`) — use it with the \`dismiss\` subcommand described below.

Walk the hotspots **from the top of the list downward**, evaluating them one at a time, until you find one that genuinely warrants extracting a shared helper or otherwise unifying the duplication. For each hotspot:

1. Read each member (and the anchor, if any) at its coordinate. Source is omitted on purpose — open the files yourself.
2. Decide whether the duplication is real and reducible. Members can be shape-similar but bound to incompatible call sites, types, or naming conventions — those are not refactoring targets. The detector biases toward false positives (recall over precision); treat the actual code at the coordinates as the source of truth.
3. If the hotspot does **not** warrant work, briefly note why and move on to the next one.
4. If it **does**, stop the search and propose a concrete extraction / parameterisation plan scoped to that single hotspot. Do not continue down the list in the same pass.

If you reach the end of the list without finding a worthwhile target, say so rather than forcing a refactor. Focus on understanding before suggesting, and never propose refactors without reading the actual code.

For deeper diagnostics — per-member scores, fragment source, full evidence (statement kinds, token n-grams), recommendation hint, and analysis summary — re-run with \`--verbose\`.
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
