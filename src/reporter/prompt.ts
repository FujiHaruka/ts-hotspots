export type ReportFeature = "complexity" | "duplication" | "architecture";

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

This is the output of \`ts-hotspots duplication\`, a static analyzer that surfaces likely Type-3 (modified-with-renames) duplication in a TypeScript codebase. Diff mode (\`--diff <revrange>\`) pivots on fragments changed between two refs; the default whole-repo mode clusters mutually similar fragments across an entire ref.

## Your task

You have been handed a list of clone-candidate hotspots below in \`hotspots[]\`. Each hotspot has \`kind: "duplication"\`, an optional \`anchor\` (diff mode pivots on the changed-side fragment; whole-repo mode has no anchor), a \`members[]\` array of fragments judged similar enough, a \`score\` (\`{ axis: "combined", value }\` — median \`combined\` similarity across pairs, in the 0..1 range), and \`evidence\` listing the top \`calls\` and \`properties\` every member has in common. Each fragment's \`ref.location\` is \`file:start-end\` (or \`file:line\` for single-line fragments) and \`ref.kind\` is \`function\` / \`block\` / \`window\`. Each hotspot also carries a \`dismissalId\` (\`dup:<hex>\`) — use it with the \`dismiss\` subcommand described below.

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

export const ARCHITECTURE_REPORT_PROMPT = `# ts-hotspots architecture report

This is the output of \`ts-hotspots architecture\`, a static analyzer that surfaces structurally load-bearing exported components in a TypeScript codebase. Each candidate is an exported declaration (named export, default export, function, class, const, type, interface, enum) ranked by a percentile-weighted composite of structural metrics (fan-in, fan-out, reverse closure size, PageRank, betweenness, instability, unstable-edge ratio).

## Your task

You have been handed a list of architecture hotspots below in \`hotspots[]\`. Each hotspot has \`kind: "architecture"\`, a \`ref\` giving the export's defining \`file:line\` coordinate, the export name and kind, a \`score\` (\`{ axis: "composite", value }\` — the top-listed smell's composite, in 0..1), \`smells\` (an array of smell types this node tripped, ordered by composite descending — values from \`architectural_hub\`, \`high_fanout_component\`, \`high_impact_component\`, \`bridge_component\`, \`unstable_dependency_candidate\`, \`over_shared_component\`), a \`metrics\` map with the contributing axis values + percentiles for the top-listed smell, and a \`dismissalId\` (\`arch:<hex>\`).

Walk the hotspots **from the top of the list downward**, evaluating them one at a time, until you find one that genuinely warrants restructuring. For each hotspot:

1. Read the export at its coordinate, plus the most prominent callers/callees suggested by the dominant edge kinds.
2. Decide whether the structural pressure is real and reducible. A high fan-in on a deliberately central type (a domain model, a public registry, a barrel that documents the public surface) is *not* a refactoring target — those are load-bearing on purpose. The same metrics on an accidental coupling point are.
3. If the hotspot does **not** warrant work, briefly note why and run \`ts-hotspots dismiss <dismissalId> --reason "<why>"\` so it is filtered from future runs. Move on.
4. If it **does**, stop the search and propose a concrete restructuring scoped to that single component (extract a sub-interface, split a barrel, invert a dependency, push a stable helper down a layer). Do not continue down the list in the same pass.

If you reach the end of the list without finding a worthwhile target, say so rather than forcing a refactor. Focus on understanding before suggesting, and never propose changes without reading the actual code.
`;

export const ARCHITECTURE_ERROR_PROMPT = `# ts-hotspots architecture error

\`ts-hotspots architecture\` failed to produce a report. See the error details below.
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
  architecture: {
    ok: ARCHITECTURE_REPORT_PROMPT,
    error: ARCHITECTURE_ERROR_PROMPT,
  },
};
