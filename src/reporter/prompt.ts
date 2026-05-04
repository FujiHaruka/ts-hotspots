export type ReportFeature =
  | "complexity"
  | "duplication"
  | "architecture"
  | "cochange";

const walkPrompt = (tail: string) =>
  `Walk the hotspots **from the top of the list downward**, evaluating them one at a time, until you find one ${tail}. For each hotspot:`;

const STEP_3_DISMISS = `If the hotspot does **not** warrant work, briefly note why and run \`ts-hotspots dismiss <dismissalId> --reason "<why>"\` so it is filtered from future runs. Move on to the next.`;

const STEP_4_TAIL = `Do not continue down the list in the same pass.`;

const closing = (suffix = "") =>
  `If you reach the end of the list without finding a worthwhile target, say so rather than forcing a refactor. Focus on understanding before suggesting, and never propose changes without reading the actual code${suffix}.`;

export const COMPLEXITY_REPORT_PROMPT = `# ts-hotspots complexity report

This is the output of \`ts-hotspots complexity\`, a static analyzer that scans a TypeScript project and surfaces likely refactor candidates (hotspots) based on multiple quality axes (complexity, length, nesting, side-effect density, and more).

## Your task

Each hotspot in \`hotspots[]\` is a function ranked high on at least one quality axis (complexity, length, nesting, side-effect density, etc.). \`score\` names the axis it ranked highest on; \`metrics\` carries the raw value for every axis it tripped.

${walkPrompt("that genuinely warrants refactoring")}

1. Read the code at its coordinate (and immediate callers/callees if needed for context).
2. Decide whether it actually warrants refactoring — metrics are heuristics, not verdicts. A high score can be a false positive (e.g. intentionally long config tables, generated code, a switch that is already the clearest form).
3. ${STEP_3_DISMISS}
4. If it **does**, stop the search and propose a concrete refactor plan scoped to that single hotspot. ${STEP_4_TAIL}

${closing()}
`;

export const COMPLEXITY_ERROR_PROMPT = `# ts-hotspots complexity error

\`ts-hotspots complexity\` failed to produce a report. See the error details below.
`;

export const DUPLICATION_REPORT_PROMPT = `# ts-hotspots duplication report

This is the output of \`ts-hotspots duplication\`, a static analyzer that surfaces likely Type-3 (modified-with-renames) duplication in a TypeScript codebase. Diff mode (\`--diff <revrange>\`) pivots on fragments changed between two refs; the default whole-repo mode clusters mutually similar fragments across an entire ref.

## Your task

Each hotspot in \`hotspots[]\` is a cluster of fragments judged similar enough to be a Type-3 clone candidate. In diff mode the cluster has an \`anchor\` (the changed-side fragment everything was matched against); in whole-repo mode it does not. \`score\` is the median pairwise similarity (0..1).

${walkPrompt("that genuinely warrants extracting a shared helper or otherwise unifying the duplication")}

1. Read each member (and the anchor, if any) at its coordinate. Source is omitted on purpose — open the files yourself.
2. Decide whether the duplication is real and reducible. Members can be shape-similar but bound to incompatible call sites, types, or naming conventions — those are not refactoring targets. The detector biases toward false positives (recall over precision); treat the actual code at the coordinates as the source of truth.
3. ${STEP_3_DISMISS}
4. If it **does**, stop the search and propose a concrete extraction / parameterisation plan scoped to that single hotspot. ${STEP_4_TAIL}

${closing()}

For deeper diagnostics — per-member scores, fragment source, full evidence (statement kinds, token n-grams), recommendation hint, and analysis summary — re-run with \`--verbose\`.
`;

export const DUPLICATION_ERROR_PROMPT = `# ts-hotspots duplication error

\`ts-hotspots duplication\` failed to produce a report. See the error details below.
`;

export const ARCHITECTURE_REPORT_PROMPT = `# ts-hotspots architecture report

This is the output of \`ts-hotspots architecture\`, a static analyzer that surfaces structurally load-bearing exported components in a TypeScript codebase. Each candidate is an exported declaration (named export, default export, function, class, const, type, interface, enum) ranked by a percentile-weighted composite of structural metrics (fan-in, fan-out, reverse closure size, PageRank, betweenness, instability, unstable-edge ratio).

## Your task

Each hotspot in \`hotspots[]\` is an exported declaration that tripped one or more structural smells (\`smells\`, ordered by composite descending — drawn from \`architectural_hub\`, \`high_fanout_component\`, \`high_impact_component\`, \`bridge_component\`, \`unstable_dependency_candidate\`, \`over_shared_component\`). \`metrics\` lists the contributing axes for the top smell; use \`percentile\` and \`zScore\` together to tell "barely above threshold" from "extreme outlier".

${walkPrompt("that genuinely warrants restructuring")}

1. Read the export at its coordinate, plus the most prominent callers/callees suggested by the dominant edge kinds.
2. Decide whether the structural pressure is real and reducible. A high fan-in on a deliberately central type (a domain model, a public registry, a barrel that documents the public surface) is *not* a refactoring target — those are load-bearing on purpose. The same metrics on an accidental coupling point are.
3. ${STEP_3_DISMISS}
4. If it **does**, stop the search and propose a concrete restructuring scoped to that single hotspot (extract a sub-interface, split a barrel, invert a dependency, push a stable helper down a layer). ${STEP_4_TAIL}

${closing()}
`;

export const ARCHITECTURE_ERROR_PROMPT = `# ts-hotspots architecture error

\`ts-hotspots architecture\` failed to produce a report. See the error details below.
`;

export const COCHANGE_REPORT_PROMPT = `# ts-hotspots cochange report

This is the output of \`ts-hotspots cochange\`, a static analyzer that surfaces logical coupling between TypeScript files: pairs that change together in git history, even when they are not statically connected by an \`import\`. The signal comes from a flat-window walk of \`git log --first-parent -m --name-status -M\`; renames are followed.

## Your task

Each hotspot in \`hotspots[]\` is a pair of files that change together more often than chance. \`score\` is the more actionable of the two directional confidences (0..1). Pass any SHA in \`evidence.recentCommits\` to \`git show\` to verify.

${walkPrompt("whose coupling is genuinely worth acting on")}

1. Read both files at their coordinates. Run \`git show <sha>\` on one or two of the recent commits if you need to see the change pattern.
2. Decide whether the coupling is real and worth surfacing: shared invariant ("when A's schema changes B must too"), implicit contract, missing abstraction, or just incidental ("both happened to be touched in the same refactor commit").
3. ${STEP_3_DISMISS}
4. If it **does**, stop the search and propose a concrete refactor plan scoped to that single hotspot: extract a shared module, formalise the implicit contract in types, or document the coupling. ${STEP_4_TAIL}

${closing(" at both ends of the pair")}
`;

export const COCHANGE_ERROR_PROMPT = `# ts-hotspots cochange error

\`ts-hotspots cochange\` failed to produce a report. See the error details below.
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
  cochange: {
    ok: COCHANGE_REPORT_PROMPT,
    error: COCHANGE_ERROR_PROMPT,
  },
};
