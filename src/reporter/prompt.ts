export const FUNCTION_REPORT_PROMPT = `# ts-hotspots report

This is the output of \`ts-hotspots\`, a static analyzer that scans a TypeScript project and surfaces likely refactor candidates (hotspots) based on multiple quality axes (complexity, length, nesting, type safety, and more).

## Your task

You have been handed a list of hotspot candidates below. For each one, \`ref\` gives a \`file:start-end\` coordinate (or \`file:line\` for single-line functions) and the function name; \`axes\` lists the quality axes on which it scored highly, and \`metrics\` shows the raw values for those axes. Each candidate also carries a \`dismissalId\` derived from its source — use it with the \`dismiss\` subcommand described below.

Walk the candidates **from the top of the list downward**, evaluating them one at a time, until you find one that genuinely warrants refactoring. For each candidate:

1. Read the code at its coordinate (and immediate callers/callees if needed for context).
2. Assess whether it actually warrants refactoring — metrics are heuristics, not verdicts. A high score can be a false positive (e.g. intentionally long config tables, generated code, a switch that is already the clearest form).
3. If it does **not** warrant work, briefly note why, then record the judgment by running \`ts-hotspots dismiss <dismissalId> --reason "<why>"\` so the candidate is filtered from future runs. The dismissal auto-expires the next time the function body is meaningfully edited, so the candidate will re-surface for re-evaluation when that happens. Move on to the next candidate.
4. If it **does**, stop the search and propose a concrete refactor plan scoped to that single hotspot. Do not continue down the list in the same pass.

If you reach the end of the list without finding a worthwhile target, say so rather than forcing a refactor. Focus on understanding before suggesting, and never propose refactors without reading the actual code.
`;

export const ERROR_REPORT_PROMPT = `# ts-hotspots error

\`ts-hotspots\` failed to produce a report. See the error details below.
`;
