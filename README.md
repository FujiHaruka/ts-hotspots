# ts-hotspots

Static analysis that points AI coding agents at the hotspots worth refactoring or reviewing in your TypeScript repo.

> Status: under active development. Output schemas may change between minor versions.

## Why

AI coding agents explore a repository by reading what looks salient — conspicuous filenames, recently-touched files, the first hits from grep. None of that ranks a codebase by where the work concentrates. Asked to refactor or review an unfamiliar TypeScript codebase, agents start confidently in the wrong place and miss the real hotspots.

`ts-hotspots` gives the agent a starting point: coordinates (`file:line`) and metric facts pointing at the spots most worth reading first. No rewrite plans, no judgments — the agent reads from there and decides what to do.

## Design principles

- **Agent-first output.** Pipe to your agent, not your dashboard.
- **Measure, don't lint.** No verdicts, no failed builds — just ranked coordinates.
- **Facts, not opinions.** Axis + value + rank; the agent reasons.

## What it surfaces

Four readings of "worth reading first", as subcommands of one CLI:

- `ts-hotspots complexity` (alias `comp`) — per-function metrics ranked into hotspot candidates. Best for *"where should I refactor?"*
- `ts-hotspots duplication` (alias `dup`) — near-duplicate code regions across the tree or against a PR diff. Best for *"is this change copy-pasting something we already have?"*
- `ts-hotspots architecture` (alias `arch`) — exported components ranked by structural pressure on the dependency graph. Best for *"which components are load-bearing?"*
- `ts-hotspots cochange` (alias `coch`) — file pairs that change together in git history. Best for *"which files outside the static graph are entangled with this one?"*

All four operate on git-tracked TypeScript sources (`.ts` / `.tsx` / `.mts` / `.cts`) and emit machine-readable output. No `tsconfig.json` required; monorepos work out of the box.

## Quick start

```bash
npx ts-hotspots complexity       # markdown report to stdout
npx ts-hotspots complexity | claude --permission-mode plan
```

The default output is a Markdown document containing a short instruction block followed by a JSON code block — pipeable straight into an agent in plan mode, which then knows it should read the top candidates and propose a plan. The JSON shape (schematic):

```jsonc
{
  "hotspots": [
    {
      "kind": "complexity",
      "ref": { "location": "src/foo.ts:42-87", ... },
      "score": { "axis": "...", "value": ... },
      "metrics": { ... },
      "dismissalId": "comp:..."
    }
  ]
}
```

Pass `--format json` for the raw JSON without the Markdown wrapper, or `--verbose` for the full per-axis breakdown.

## Subcommands

### complexity (comp)

Ranks individual functions (including methods, arrow functions, and TSX components) by per-function metrics like cognitive complexity, line count, parameter count, and recent churn.

```bash
ts-hotspots complexity                       # scan the working tree
ts-hotspots comp --diff origin/main...       # show only hotspots in changed files
ts-hotspots comp --file src/foo.ts           # raw metrics for every function in one file
```

Each hotspot reports a `file:line` location, the axis it ranked highest on, and the raw metric values that triggered it.

Command-specific options:

- `--metrics <list>` — comma-separated axis ids to include
- `--file <path>` — single-file drill-down (raw metrics for every function in the file)
- `--diff <revrange>` — display only hotspots in files changed by the revrange (rankings still computed against the full working tree)
- `--churn-window <N>` / `--no-churn` — control the recent-commit window used for the churn axis (default 200)

### duplication (dup)

Finds near-duplicate code regions: copy-pasted fragments that have been lightly edited (renamed identifiers, reordered statements, slightly different argument shape). Tuned for recall — the goal is to surface every spot worth a second look, not to declare a strict clone verdict.

```bash
ts-hotspots duplication                      # scan HEAD
ts-hotspots dup --diff origin/main...        # changed code vs. the rest of the tree
ts-hotspots dup --ref release/v2             # scan a specific ref
```

Each group reports the locations of every member fragment, a similarity score, and a short evidence block listing the shared calls and properties that drove the match. Group order is biased toward refactor value: when two groups have similar shapes, the one whose files have been edited more often comes first. Cold groups are not hidden — only re-ranked behind hotter ones.

Command-specific options:

- `--diff <revrange>` — compare the diff's changed code against the rest of the tree (mutually exclusive with `--ref`)
- `--ref <ref>` — ref to scan in whole-repo mode (default `HEAD`)
- `--churn-window <N>` / `--no-churn` — control the recent-commit window used for ranking (default 200)
- `--phase-timings[=summary|verbose]` — emit a JSON Lines perf log to stderr

### architecture (arch)

Ranks exported symbols — every named export, default export, function, class, const, type, interface, or enum — by structural pressure on the dependency graph. Re-exports are normalised to their original definitions.

```bash
ts-hotspots architecture                     # scan the working tree
ts-hotspots arch --diff origin/main...       # show only hotspots in changed files
ts-hotspots arch --ref release/v2            # build the graph at a specific ref
```

Each hotspot reports the component's defining `file:line`, its export name and kind, the structural pattern that ranked it highest, and a summary of incoming vs. outgoing edges.

Command-specific options:

- `--diff <revrange>` — display filter only (rankings still computed against the full graph)
- `--ref <ref>` — build the graph at the given commit (default: working tree)
- `--include-tests` — include test files in the graph (off by default — test edges distort fan-in / fan-out)
- `--no-include-types` — drop type-only edges entirely (default: keep them at reduced weight)

### cochange (coch)

Ranks file pairs that change together in git history. Two files repeatedly touched in the same commit, even when no static import edge connects them, are logically coupled — editing one usually means the other needs a look. The walk is rename-tracked, so a refactor that moves `foo.ts` to `lib/foo.ts` does not split its history.

```bash
ts-hotspots cochange                         # walk the last 200 commits at HEAD
ts-hotspots coch --diff origin/main...       # show only pairs touching changed files
ts-hotspots coch --file src/foo.ts           # rank co-change partners of one file
```

Each hotspot reports the canonical-ordered file pair, a co-change score, and the raw counts behind it.

Command-specific options:

- `--diff <revrange>` — display filter only
- `--ref <ref>` — endpoint of the history window (default `HEAD`)
- `--window <N>` — number of commits in the window (default 200)
- `--min-support <N>` — drop pairs with raw co-change count below N (default 3); protects against one-off coincidences
- `--max-files-per-commit <N>` — ignore commits touching more than N files (default 50); protects against mass renames, formatter passes, dependency bumps
- `--file <path>` — single-anchor mode: rank only the partners of `<path>`

## Common options

These work across all four subcommands:

- `--format markdown|json` — output format (default: markdown)
- `--limit <N|all>` — cap `hotspots[]` at the top N (default: 20)
- `--exclude <glob>` — extra path glob to drop, repeatable (built-in defaults already cover `node_modules`, `dist`, generated files, and tests)
- `--verbose` — emit the rich schema (per-axis details, summaries, raw inputs)

Run `ts-hotspots <subcommand> --help` for the full list, including subcommand-specific flags.

## Dismissing false positives

All four features are heuristics — some surfaces will be fine as-is (intentional state-machine dispatchers, generated code, deliberate parallel structures, load-bearing public APIs, file pairs that genuinely belong together). To keep the agent from re-evaluating the same false positives every run, each reported entry carries a `dismissalId`. Record a judgment with:

```bash
ts-hotspots dismiss <dismissalId> --reason "<why it's fine>"
```

Entries are stored per machine under `~/.config/ts-hotspots/<projectKey>/dismissed.json` (honoring `XDG_CONFIG_HOME`). This is a personal cache — nothing is written into your repository, and dismissals are not shared across machines or teammates. Subsequent runs filter the entry from the report.

The id is a hash of the underlying source, so any meaningful edit invalidates it and the candidate re-surfaces. Stale entries are pruned automatically.

Supporting subcommands:

```bash
ts-hotspots list-dismissed [--json]    # inspect the registry
ts-hotspots undismiss <dismissalId>    # remove an entry
```

## Limitations

- Under active development; output schemas may change between minor versions.
- Sources are enumerated via `git ls-files`. Run inside a git working tree and commit before analyzing — untracked files are skipped.
- Very large repos may need `--exclude` or (for cochange) `--max-files-per-commit` tuning.
- Dismissals are stored per-machine, not shared across teammates.
