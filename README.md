# ts-hotspots

A CLI that statically analyzes a TypeScript project and surfaces likely refactor candidates (hotspots). Built to hand coding agents like Claude Code a starting point for "where should I read first?"

## Quick start

Pipe the report straight into Claude:

```
npx ts-hotspots | claude --permission-mode plan
```

By default `ts-hotspots` emits a Markdown document that contains a short instruction block telling Claude what the data is and what to do with it, followed by the hotspot data inside a fenced JSON code block. The result is that Claude opens in plan mode already knowing it should read the top candidates' code and propose a refactor plan.

## Usage

```
ts-hotspots                  # scans tsconfig.json in the current directory
ts-hotspots <path>           # directory or tsconfig.json
```

The output is a `FunctionReport` focused on hotspot candidates — the coordinates an agent should read first. By default it contains only the primary signal:

- `functionHotspotCandidates` — refs that co-occur across multiple axes, or that rank near the top of a discriminative axis. Each candidate has a `ref` whose `location` is `file:start-end` (or `file:line` for single-line functions), and a `metrics` map containing the raw values for the axes that triggered the candidate. Results are ordered so that refs flagged by more axes come first.

Pass `--full` to also get `functionRankings` (top-N per axis, all axes), `functionAxisMeta` (per-axis dispersion metadata such as spread and unique top-N values), `functionCoOccurrence` (raw co-occurrence entries), and `functions[]` (every function with its full metrics).

Solution-style monorepos (root `tsconfig.json` with `references`) are supported — all referenced projects are walked transitively and loaded into a single TypeChecker, so cross-package analysis works out of the box.

Options:

- `--json` emit raw JSON instead of the default Markdown prompt
- `--top <N>` top N entries per axis (default: 5)
- `--metrics <list>` comma-separated axis ids to include
- `--exclude <glob...>` files to exclude
- `--file <path>` single-file drill-down mode (returns raw metrics for every function in the file)
- `--full` include `functionRankings`, `functionAxisMeta`, `functionCoOccurrence`, and `functions[]` alongside the candidates

## Dismissing false positives

Hotspot candidates are heuristics — some will be fine as-is (intentional state-machine dispatchers, generated code, config tables). To keep the agent from re-evaluating the same false positives on every run, each candidate carries a `dismissalId`. Record a judgment with:

```
ts-hotspots dismiss <dismissalId> --reason "<why it's fine>"
```

Entries are stored per machine under `~/.config/ts-hotspots/<projectKey>/dismissed.json` (honoring `XDG_CONFIG_HOME` if set). This is a personal cache — nothing is written into your repository, and dismissals are not shared across machines or teammates. Subsequent runs on the same project filter that candidate out. The id is a hash of the function's source, so any meaningful edit to the function auto-expires the dismissal and the candidate re-surfaces for re-evaluation.

Supporting subcommands:

```
ts-hotspots list-dismissed [--json]    # inspect the registry
ts-hotspots undismiss <dismissalId>    # remove an entry
```

Stale entries (the function was deleted or edited) are pruned automatically on each run. If you have a leftover `.ts-hotspots/` directory inside the repo from an earlier version, it is no longer used and can be removed.

## Status

Under development.
