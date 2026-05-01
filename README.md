# ts-hotspots

A CLI that statically analyzes a TypeScript project and points coding agents at the spots most worth reading first. It returns coordinates and metric facts as JSON (or a Markdown prompt wrap), and leaves the judgment of *what to do* to the agent or reviewer downstream.

Two complementary readings of "worth reading first" are supported as subcommands of the same binary:

- `ts-hotspots complexity` (alias `comp`) — per-function metrics (cognitive complexity, sloc, parameters, churn, …) ranked into a small set of **hotspot candidates**. Best for "where in this codebase should I refactor?"
- `ts-hotspots duplication` (alias `dup`) — Type-3 **duplication candidates** found across the tree or against a PR diff. Best for "is this change copy-pasting something we already have?"

Both commands operate on a directory inside a git repository and emit machine-readable output. Neither tool proposes refactors itself — they hand the agent coordinates and evidence.

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
- `--verbose` include `functionRankings`, `functionAxisMeta`, `functionCoOccurrence`, and `functions[]` alongside the candidates

## Duplication candidates: `ts-hotspots duplication`

`duplication` finds Type-3 duplicates: copy-pasted regions that have been lightly edited (renamed identifiers, reordered statements, slightly different argument shape). It is tuned for **recall** — the goal is to surface every spot worth a second look, not to declare a strict clone verdict.

It runs in two modes:

```
ts-hotspots duplication <revrange> [path]            # PR mode: changed code vs. the rest of the tree
ts-hotspots duplication --whole-repo [path]          # whole-repo mode: every duplicate cluster at one ref
ts-hotspots dup --whole-repo                         # short alias
```

`[path]` points at a directory inside a git repository; the repo root is discovered by walking up until a `.git` entry is found (defaults to the current directory).

`<revrange>` is the standard git form: `A...B` (merge-base vs. head, recommended for PRs), `A..B` (direct), `A...` / `...B` (HEAD on the open side).

Examples:

```
ts-hotspots duplication origin/main... > report.md
ts-hotspots duplication origin/main...HEAD --format json > report.json
ts-hotspots duplication --whole-repo --format json > report.json
ts-hotspots duplication --whole-repo --exclude 'src/legacy/**'
```

By default the tool emits a Markdown document containing a short instruction block followed by the report data inside a fenced JSON code block — pipeable straight into an agent in plan mode. Each entry in `hotspots[]` has `kind: "duplication"`, the coordinates of every fragment in the group (`anchor` in PR mode, `members[]` always), a `score` (`{ axis: "combined", value }` — the median similarity across pairs, in 0..1), and an `evidence` block listing the top shared `calls` and `properties` — just enough to point at why the group surfaced and where to read first. Pass `--format json` for the machine-readable form.

For deeper diagnostics — per-member scores, fragment source, full evidence (statement kinds and token n-grams), the recommendation hint, and the analysis summary — re-run with `--verbose`.

Common options:

- `--format markdown|json` output format (default: markdown)
- `--exclude <glob>` extra path glob to drop (repeatable; built-in defaults already cover `node_modules`, `dist`, generated files, and tests)
- `--limit <N|all>` cap `hotspots[]` at the top N by combined score (default: 20)
- `--verbose` emit the rich schema (per-member scores, fragment source, full evidence, recommendation hint, analysis summary)
- `--ref <ref>` ref to scan in `--whole-repo` mode (default: `HEAD`)
- `--phase-timings[=summary|verbose]` emit a JSON Lines perf log to stderr

Run `ts-hotspots duplication --help` for the full list.

The exit code is 0 even when zero candidates are reported — detection is the tool's job, deciding what to do is the agent's.

## Dismissing false positives

Both features are heuristics — some surfaces will be fine as-is (intentional state-machine dispatchers, generated code, copy-pasted config tables, deliberate parallel structures). To keep the agent from re-evaluating the same false positives every run, each reported entry carries a `dismissalId`:

- `comp:<hex>` for complexity hotspot candidates (one per function)
- `dup:<hex>` for duplication hotspots (one per group, derived from the group's member set)

Record a judgment with:

```
ts-hotspots dismiss <dismissalId> --reason "<why it's fine>"
```

Entries are stored per machine under `~/.config/ts-hotspots/<projectKey>/dismissed.json` (honoring `XDG_CONFIG_HOME` if set). This is a personal cache — nothing is written into your repository, and dismissals are not shared across machines or teammates. Subsequent runs filter the entry from the report.

Auto-expiry is intentional: the id is a hash of the underlying source (the function body for `comp:`, the group's member fingerprints for `dup:`). Any meaningful edit invalidates the id, so a dismissal you made for a structure that has since changed is dropped and the candidate re-surfaces. Stale entries are pruned automatically on each run; you do not need to garbage-collect by hand.

Supporting subcommands:

```
ts-hotspots list-dismissed [--json]    # inspect the registry
ts-hotspots undismiss <dismissalId>    # remove an entry
```

## Status

Under development.
