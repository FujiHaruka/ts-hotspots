# ts-hotspots

A CLI that statically analyzes a TypeScript project and points coding agents at the spots most worth reading first. It returns coordinates and metric facts as JSON (or a Markdown prompt wrap), and leaves the judgment of *what to do* to the agent or reviewer downstream.

Three complementary readings of "worth reading first" are supported as subcommands of the same binary:

- `ts-hotspots complexity` (alias `comp`) — per-function metrics (cognitive complexity, sloc, parameters, churn, …) ranked into a small set of **hotspot candidates**. Best for "where in this codebase should I refactor?"
- `ts-hotspots duplication` (alias `dup`) — Type-3 **duplication candidates** found across the tree or against a PR diff. Best for "is this change copy-pasting something we already have?"
- `ts-hotspots architecture` (alias `arch`) — exported components ranked by **structural pressure** (fan-in / fan-out / centrality). Best for "which components are load-bearing in this codebase?"

All three commands operate on a directory inside a git repository and emit machine-readable output. None of them propose refactors themselves — they hand the agent coordinates and evidence.

## Install

```
npm i -D ts-hotspots          # or pnpm add -D, yarn add -D
```

Requires Node.js 24+.

## Hotspot candidates: `ts-hotspots complexity`

Pipe the report straight into Claude:

```
npx ts-hotspots complexity | claude --permission-mode plan
```

By default the tool emits a Markdown document containing a short instruction block followed by the hotspot data inside a fenced JSON code block. Claude opens in plan mode already knowing it should read the top candidates and propose a refactor plan.

### Usage

```
ts-hotspots complexity                  # scans the current directory
ts-hotspots complexity <path>           # directory inside a git repo
ts-hotspots comp <path>                 # short alias
```

`<path>` points at a directory inside a git working tree. Sources are enumerated via `git ls-files` (`.ts`, `.tsx`, `.mts`, `.cts`), so untracked files are skipped — commit before analyzing. No `tsconfig.json` is required; monorepos work without further configuration.

The output is focused on hotspot candidates — the coordinates an agent should read first. By default it contains only the primary signal:

- `hotspots` — refs that co-occur across multiple metric axes, or that rank near the top of a discriminative axis. Each candidate has `kind: "complexity"`, a `ref` whose `location` is `file:start-end` (or `file:line` for single-line functions), a `score` (`{ axis, value }` — the metric where this candidate ranked highest), and a `metrics` map with the raw values for the axes that triggered it. Candidates flagged by more axes come first.

Pass `--verbose` to also get `functionRankings` (top-N per axis), `functionAxisMeta` (per-axis dispersion metadata), `functionCoOccurrence` (raw co-occurrence entries), and `functions[]` (every function with its full metrics).

Options:

- `--format markdown|json` output format (default: markdown)
- `--limit <N|all>` cap `hotspots[]` at the top N (default: 20). Pass `all` to keep every candidate.
- `--metrics <list>` comma-separated axis ids to include
- `--exclude <glob...>` extra path globs to drop (repeatable; built-in defaults already cover `node_modules`, `dist`, generated files, and tests)
- `--file <path>` single-file drill-down (returns raw metrics for every function in the file)
- `--diff <revrange>` scope hotspots to functions in files changed by a git revrange (e.g. `origin/main...`). Rankings are still computed against the full head ref.
- `--verbose` include `functionRankings`, `functionAxisMeta`, `functionCoOccurrence`, and `functions[]` alongside the candidates

## Duplication candidates: `ts-hotspots duplication`

`duplication` finds Type-3 duplicates: copy-pasted regions that have been lightly edited (renamed identifiers, reordered statements, slightly different argument shape). It is tuned for **recall** — the goal is to surface every spot worth a second look, not to declare a strict clone verdict.

By default it scans the entire repository at HEAD. Pass `--diff <revrange>` to compare a diff's changed code against the rest of the tree.

```
ts-hotspots duplication [path]                       # whole-repo: every duplicate cluster at HEAD
ts-hotspots duplication [path] --diff <revrange>     # diff mode: changed code vs. the rest of the tree
ts-hotspots dup                                      # short alias
```

`[path]` points at a directory inside a git repository; the repo root is discovered by walking up until a `.git` entry is found (defaults to the current directory).

`<revrange>` is the standard git form: `A...B` (merge-base vs. head, recommended for PRs), `A..B` (direct), `A...` / `...B` (HEAD on the open side).

Examples:

```
ts-hotspots duplication > report.md
ts-hotspots duplication --format json > report.json
ts-hotspots duplication --diff origin/main... > report.md
ts-hotspots duplication --diff origin/main...HEAD --format json > report.json
ts-hotspots duplication --exclude 'src/legacy/**'
```

By default the tool emits a Markdown document containing a short instruction block followed by the report data inside a fenced JSON code block — pipeable straight into an agent in plan mode. Each entry in `hotspots[]` has `kind: "duplication"`, the coordinates of every fragment in the group (`anchor` in PR mode, `members[]` always), a `score` (`{ axis: "combined", value }` — the median similarity across pairs, in 0..1), and an `evidence` block listing the top shared `calls` and `properties` — just enough to point at why the group surfaced and where to read first. Pass `--format json` for the machine-readable form.

Group order is biased toward refactor value: when two groups have similar shapes, the one whose files have been edited more often in the recent commit window comes first. Cold groups are not hidden — only re-ranked behind hotter ones.

For deeper diagnostics — per-member scores, fragment source, full evidence (statement kinds and token n-grams), the recommendation hint, and the analysis summary — re-run with `--verbose`. The verbose output also includes `aggregateChurn` (the recent-commit counts of the files involved), so an agent can see why a group climbed.

Common options:

- `--format markdown|json` output format (default: markdown)
- `--exclude <glob>` extra path glob to drop (repeatable; built-in defaults already cover `node_modules`, `dist`, generated files, and tests)
- `--limit <N|all>` cap `hotspots[]` at the top N by combined score (default: 20)
- `--verbose` emit the rich schema (per-member scores, fragment source, full evidence, recommendation hint, analysis summary)
- `--diff <revrange>` scope to a git diff (mutually exclusive with `--ref`)
- `--ref <ref>` ref to scan in whole-repo mode (default: `HEAD`; mutually exclusive with `--diff`)
- `--churn-window <N>` how many recent commits the churn-aware ranker walks (default: 200; pass `--no-churn` to disable)
- `--phase-timings[=summary|verbose]` emit a JSON Lines perf log to stderr

Run `ts-hotspots duplication --help` for the full list.

The exit code is 0 even when zero candidates are reported — detection is the tool's job, deciding what to do is the agent's.

## Architecture hotspots: `ts-hotspots architecture`

`architecture` ranks exported components — every named export, default export, function, class, const, type, interface, or enum — by structural pressure on the dependency graph. The graph is built parser-only (no `ts.Program`, no TypeChecker), with re-exports normalised to their original definitions, then six smell types compete for the candidate's primary slot:

- `architectural_hub` — high fan-in, fan-out, and reverse closure simultaneously
- `high_fanout_component` — depends on far more than its peers
- `high_impact_component` — many callers and a wide downstream wavefront
- `bridge_component` — sits on a large fraction of shortest paths (Brandes betweenness)
- `unstable_dependency_candidate` — depends on less-stable modules (SDP violation)
- `over_shared_component` — high fan-in / fan-out and previously suppressed

```
ts-hotspots architecture                        # scans the working tree
ts-hotspots arch --ref release/v2               # build the graph at a specific commit
ts-hotspots arch --diff origin/main...          # display only components in changed files
```

Each entry in `hotspots[]` has `kind: "architecture"`, the component's defining `file:line` coordinate, the export name and kind, a primary smell + up to two secondary smells, the contributing-axis breakdown for the primary smell (raw value, percentile, rank, threshold delta, z-score), an `edgeMix` summary (`fanIn` / `fanOut` / `runtimeShare`), and a `dismissalId` (`arch:<hex>`).

Common options:

- `--format markdown|json` output format (default: markdown)
- `--exclude <glob>` extra path glob to drop (repeatable; built-in defaults already cover `node_modules`, `dist`, generated files, and tests)
- `--limit <N|all>` cap `hotspots[]` at the top N by composite score (default: 20)
- `--verbose` emit the rich schema (per-secondary metrics, project component count, summary)
- `--diff <revrange>` display filter only — rankings are still computed against the full graph
- `--ref <ref>` build the graph at the given commit (default: working tree)
- `--include-tests` include test files (and stories / cypress / playwright) in the graph; off by default because test edges distort fan-in / fan-out
- `--no-include-types` drop type-only edges entirely (default: keep them at weight 0.3)
- `--phase-timings[=summary|verbose]` emit a JSON Lines perf log to stderr

### Optional config

You can place a `.ts-hotspots.json` at the repo root to downweight edges that touch glob-matched files. Use it for legacy areas you do not want to surface yet, or for barrel files whose fan-out is structurally inevitable:

```json
{
  "architecture": {
    "downweight": [
      { "glob": "src/legacy/**", "factor": 0.5 },
      { "glob": "**/*.barrel.ts", "factor": 0.3 }
    ]
  }
}
```

`factor` is in `[0, 1]`. Edges where either endpoint matches a rule's glob have their weight multiplied; multiple matching rules compose multiplicatively.

## Dismissing false positives

All three features are heuristics — some surfaces will be fine as-is (intentional state-machine dispatchers, generated code, copy-pasted config tables, deliberate parallel structures, load-bearing public APIs). To keep the agent from re-evaluating the same false positives every run, each reported entry carries a `dismissalId`:

- `comp:<hex>` for complexity hotspot candidates (one per function)
- `dup:<hex>` for duplication hotspots (one per group, derived from the group's member set)
- `arch:<hex>` for architecture hotspots (one per component, derived from the component id)

Record a judgment with:

```
ts-hotspots dismiss <dismissalId> --reason "<why it's fine>"
```

Entries are stored per machine under `~/.config/ts-hotspots/<projectKey>/dismissed.json` (honoring `XDG_CONFIG_HOME` if set). This is a personal cache — nothing is written into your repository, and dismissals are not shared across machines or teammates. Subsequent runs filter the entry from the report.

Auto-expiry is intentional: the id is a hash of the underlying source (the function body for `comp:`, the group's member fingerprints for `dup:`, the canonical component id for `arch:`). Any meaningful edit invalidates the id, so a dismissal you made for a structure that has since changed is dropped and the candidate re-surfaces. Stale entries are pruned automatically on each run; you do not need to garbage-collect by hand.

Supporting subcommands:

```
ts-hotspots list-dismissed [--json]    # inspect the registry
ts-hotspots undismiss <dismissalId>    # remove an entry
```

## Status

Under development.
