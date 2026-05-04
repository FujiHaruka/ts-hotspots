# `ts-hotspots architecture` subcommand — proposal

Status: draft (requirements only — no implementation plan yet).
Source: re-shaped from a standalone "architectural smell detector" draft so
that it slots into ts-hotspots alongside `complexity` (`comp`) and
`duplication` (`dup`).

## Context

ts-hotspots already gives an agent two coordinate streams:

- `comp` — per-function complexity, ranked by metric.
- `dup` — Type-3 duplication candidate fragments.

Both share the same shape: parse via `ts.createSourceFile` only (no
`ts.Program`/TypeChecker), emit `file:line` coordinates with metric facts,
and let the agent decide what to do. Determinism is a hard invariant, recall
is preferred over precision, and the output is "where to read first" — never
a refactor recommendation.

The original draft proposed a third lens — exported-component dependency
graphs — but assumed the user would hand-classify their codebase into
features / layers / domains and configure allowlists from scratch. The user
has explicitly removed all classification-dependent metrics. This document
re-specifies the subcommand under that constraint, in ts-hotspots' design
language.

## Approach

Add a third subcommand `architecture` (alias `arch`). The unit is the
**exported component** (named export, default export, exported
function/class/const/type, re-exported public API). The deliverable is a
ranked list of candidate components with `file:line` coordinates and metric
facts — same agent-facing role as `comp` and `dup`, just at a different
granularity.

The redesign cuts every metric and smell type that depended on user-supplied
feature/layer/domain categories. What survives is structural — fan-in,
fan-out, reverse closure size, betweenness, instability + unstable-edge
flags, PageRank — all computable from the dependency graph alone with no
configuration beyond exclude globs.

The implementation reuses ts-hotspots' parser-only stance (`src/parser/
parseSource.ts`, no TypeChecker), follows the dup pipeline's module-layout
discipline, must clear the strip-only TS check, must keep `perfLog` zero-
cost when disabled, and must produce bit-identical output for the same
input. The CLI integrates via the same registrar pattern as
`addDuplicationCommand`, the same `--diff` revrange parser, the same
`-e, --exclude` semantics, and the same `dismissal/` registry for suppression
(`arch:<hex>` IDs alongside `comp:<hex>` and `dup:<hex>`).

## Naming: why `architecture`/`arch` and not `dependency`/`dep`

`dep` and `dup` differ by a single vowel, share a leading `d`, and would
sit next to each other in `--help` output and tab-completion menus. That is
the kind of UX paper-cut that breeds typos and screenshot mistakes for the
remaining lifetime of the tool.

Existing names follow the pattern *noun describing the phenomenon being
analyzed*: `complexity`, `duplication`. Continuing that pattern:

| Candidate         | Notes                                                |
| ----------------- | ---------------------------------------------------- |
| `architecture` / `arch` | Describes the goal; visually distinct from `comp`/`dup`; matches the "architectural smells" framing of the original draft. **Chosen.** |
| `coupling` / `coup`     | Describes the phenomenon precisely, but `coup` is loaded with unrelated meaning, and "coupling" alone isn't what the tool reports — it reports several distinct smells. |
| `topology` / `topo`     | Accurate but jargon-heavy; the agent-facing intent ("where should I look first?") doesn't read clearly. |
| `structure` / `struct`  | `struct` collides with TypeScript reading. |

`architecture` reads cleanly in agent-facing prompts ("run
`ts-hotspots arch` and tell me which components look load-bearing") and the
3-letter difference from `arch` to either `comp` or `dup` is unmistakable.

## Consistency review against `comp` and `dup`

This is what the actual flag surfaces look like today, plus the choices
this proposal makes for `arch`. Anything not aligned is called out.

### Shared by all three subcommands

| Concern                | comp                          | dup                           | arch (proposed)              |
| ---------------------- | ----------------------------- | ----------------------------- | ---------------------------- |
| Positional             | `[path]`                      | `[path]`                      | `[path]`                     |
| Output destination     | stdout (redirect)             | stdout (redirect)             | stdout (redirect)            |
| `-e, --exclude <glob>` | repeatable, additive          | repeatable, additive          | repeatable, additive (same wording) |
| `--limit <N\|all>`     | default 20, accepts `all`     | default 20, accepts `all`     | default 20, accepts `all`    |
| `--format <markdown\|json>` | default markdown         | default markdown              | default markdown             |
| `--verbose`            | rich schema                   | rich schema                   | rich schema                  |
| `--diff <revrange>`    | display filter (post-rank)    | base/head sides (build-time)  | display filter (post-rank) — matches comp |
| `--churn-window <N>`   | git churn window              | git churn window              | not in v1 (see asymmetries)  |
| `--churn-ref <ref>`    | git churn ref                 | git churn ref                 | not in v1                    |
| `--no-churn`           | disable churn                 | disable churn                 | not in v1                    |

### Mirrored from dup specifically

| Flag                | dup behavior                              | arch (proposed)                     |
| ------------------- | ----------------------------------------- | ----------------------------------- |
| `--ref <ref>`       | scan a specific commit (default HEAD)     | build the graph at `<ref>` (default working tree) |

`--phase-timings` was originally mirrored from dup but dropped before
v1 ship — the arch pipeline never wired the level into a `JsonlPerfLogger`,
and the runtime is fast enough on real repos that the diagnostic was not
worth the surface area. If a future repo blows past budget, fold
instrumentation back in alongside the betweenness-sampling follow-up
plan (see "Out of milestones") rather than reviving an unwired flag.

### arch-specific (justified asymmetries; will need a CLAUDE.md note on landing)

| Flag                | Why arch only                                                  |
| ------------------- | -------------------------------------------------------------- |
| `--include-types`   | Type-only edges have a meaningful but lower weight than runtime edges. Default on; pass `--include-types=false` to drop them entirely. |

Re-export resolution is **always normalized** (barrel files are followed
through to the original definition before edges are recorded). No flag —
`record`/`both` modes had no real use case for the agent-facing "where to
read first" framing.

### Asymmetries inherited from comp / dup

| Flag                | Subcommand(s)        | Why arch doesn't have it                                  |
| ------------------- | -------------------- | --------------------------------------------------------- |
| `-m, --metrics`     | comp                 | `--metrics` selects which axes comp computes. arch always computes the full graph; per-axis selection isn't meaningful. |
| `--file <path>`     | comp                 | Single-file drill-down maps to per-function metrics, not graph nodes. arch's drill-down is per-component, addressed by the JSON output. |

### `--ref` and `--diff` interaction (asymmetry from dup)

In dup, `--ref` and `--diff` are mutually exclusive — they answer the same
question (what version are we analyzing?). In arch, `--ref` chooses which
commit to build the graph at, and `--diff` filters the displayed
candidates. They are orthogonal and **both can be passed** —
`arch --ref release/v2 --diff origin/main..HEAD` is a valid invocation
("rank against v2's graph; show only what this PR touches"). Mirrors comp's
`--diff` semantics, where comp lacks `--ref` so the question never came up.

### Subcommand-name collision check

`comp`, `dup`, `arch` — all distinct in shape, length, and starting
letter. `dismiss`, `list-dismissed`, `undismiss` (existing) start with
different letters. `architecture` and `complexity` both start with `c…` /
`a…` respectively, so tab-completion of `ts-hotspots a<TAB>` resolves to
`arch` unambiguously and `c<TAB>` resolves to `comp`.

### Dismissal ID prefix

`comp:<hex>` and `dup:<hex>` exist today. arch adopts `arch:<hex>`. The
existing `dismiss <id>` / `list-dismissed` / `undismiss` commands route
through `src/dismissal/store.ts` and need only a new prefix recognizer.

## Subcommand shape (final)

```
ts-hotspots architecture [path]
  alias: arch
  default: scan whole repo at the working tree
  output: markdown to stdout
```

### Flags (final)

```
-e, --exclude <glob>           extra path glob (repeatable; same wording as comp/dup)
    --limit <N|all>            cap candidates at top N (default 20; accepts 'all')
    --format <markdown|json>   report format (default markdown)
    --verbose                  emit the rich schema
    --diff <revrange>          display filter — show only candidates in changed
                               files. Same display-filter semantics as comp.
    --ref <ref>                build the graph at <ref> (default: working tree)
    --include-types[=false]    include type-only edges (default: on, downweighted)
```

`--churn-window`, `--churn-ref`, `--no-churn` — **deliberately omitted in
v1.** Adding them while ignoring their values would be a lie; including
them properly means folding churn into scoring, which the user has
deferred. Document this gap; revisit when churn integration lands.

## Smell candidates (final set)

After dropping classification-dependent axes, six candidate types survive:

| Smell type                       | Inputs                                          |
| -------------------------------- | ----------------------------------------------- |
| `architectural_hub`              | fan-in, fan-out, reverse closure size           |
| `high_fanout_component`          | fan-out                                         |
| `high_impact_component`          | fan-in, reverse closure size                    |
| `bridge_component`               | betweenness centrality                          |
| `unstable_dependency_candidate`  | instability, unstable-edge ratio                |
| `over_shared_component`          | fan-in, fan-out, suppress-flag presence         |

Removed from the draft: `feature_tight_coupling`, `layer_boundary_blur`.

`dependency_entropy`, the three cross-X ratios, the unified
`boundary_crossing_ratio`, `feature_pair_coupling`, and per-category
`dependency_density` are removed wherever they appeared as scoring inputs.

## Default composite weights

Percentile-weighted sums, golden-snapshot-tested:

```
architectural_hub:
  fan_in_pct           0.40
  fan_out_pct          0.30
  reverse_closure_pct  0.30

high_fanout_component:
  fan_out_pct          1.00

high_impact_component:
  fan_in_pct           0.50
  reverse_closure_pct  0.40
  pagerank_pct         0.10

bridge_component:
  betweenness_pct      1.00

unstable_dependency_candidate:
  unstable_edge_ratio_pct 0.60
  instability_delta_pct   0.40

over_shared_component:
  fan_in_pct           0.40
  fan_out_pct          0.30
  suppress_flag        0.30
```

## Edge weights

| Edge kind                       | Weight | Notes                                       |
| ------------------------------- | -----: | ------------------------------------------- |
| `class extends`                 |    2.0 | Strong structural commitment                |
| `class implements`              |    1.5 |                                             |
| Runtime value import / call     |    1.0 | Default                                     |
| Object construction (`new X()`) |    1.0 |                                             |
| Re-export                       |    1.0 |                                             |
| Type-only import                |    0.3 | Set to 0 via `--include-types=false`        |
| Interface/type reference        |    0.3 |                                             |
| Test edge                       |     —  | Excluded by default                         |
| Dynamic / string / DI           |    0.5 | Best-effort; flagged as `uncertain`         |

Both unweighted (edge count) and weighted variants are computed; the report
shows which one drove a candidate.

## Percentile + small-N fallback

```
N >= 100  : metric_pct >= p_threshold       (per-smell threshold)
N <  100  : metric_pct >= p_threshold AND z_score >= 1.5
```

Healthy small repos report "none". This matches the recall-over-precision
posture but avoids mechanical false positives at low N.

## Output

Same dual format as comp/dup.

### Markdown (default, stdout)

Sections: summary line; top-N candidate cards; per-smell counts;
suppression hits.

Each candidate card includes:

- `file:line` coordinate (the export's defining line)
- Export name and kind
- Primary smell, plus up to two secondary smells
- Each contributing metric: actual value, percentile, rank, threshold delta
- Dominant edge kinds (`runtime` vs `type-only` — replaces the dropped
  "dominant boundary axis")
- `dismissalId` (`arch:<hex>`)

### JSON

Machine-readable, schema-versioned. Same shape philosophy as
`dup --format json`.

## Stable IDs (v1 simple form)

Component ID:

```
<file_path>::<export_name>::<export_kind>
```

Candidate ID:

```
<smell_type>:<sha256(component_id)[0..10]>
```

Full alias-tracking (rename detection, content-hash matching, ID aliases
for moved files) is **deferred**. v1's IDs are stable under code edits but
not under file moves; that matches what comp/dup do today.

## Internal layout

```
src/architecture/
  resolve/    — module/path resolution; reads tsconfig paths; pure
  graph/      — build component dependency graph from resolved imports
  metrics/    — fan-in/out, reverse closure, betweenness, PageRank,
                instability, unstable-edge ratio
  ranking/    — percentile + z-score + small-N fallback
  scoring/    — composite per smell type; smell aggregation rule
  report/     — Markdown + JSON renderers
  cli/        — registerCommand, args, main, perfLog (mirrors dup)
```

## Reused infrastructure

- Parser: `src/parser/parseSource.ts`. No new parser path.
- Dismissal registry: `src/dismissal/`. `arch:<hex>` IDs route through the
  same `dismiss` / `list-dismissed` / `undismiss` commands.
- Git utilities: `src/util/git/{parseRevRange,findGitRoot,listChangedFilePaths}.ts`
  for `--diff` and `--ref`.
- Default exclude globs: `src/defaults.ts` (`DEFAULT_EXCLUDE_GLOBS` —
  test files, generated, vendor, snapshots, fixtures, migrations are
  already covered).
- CLI registrar pattern: `src/duplication/cli/registerCommand.ts` —
  arch's `addArchitectureCommand(parent, onParsed)` mirrors this exactly,
  including the help-text shape (`addHelpText("before", LONG_DESCRIPTION)`,
  `addHelpText("after", HELP_AFTER)`).
- Strip-only check: `tools/check-strip-only.ts` already imports
  `src/cli.ts`, so registering `arch` there transitively covers strip-only
  validation.

## Allowlist behavior

The draft's three modes map cleanly:

| Draft mode    | ts-hotspots equivalent                                     |
| ------------- | ---------------------------------------------------------- |
| `exclude`     | `--exclude` glob (drops files before parsing)              |
| `suppress`    | `dismiss` command (graph keeps the node, candidate hidden) |
| `downweight`  | New: per-glob edge weight multipliers in config            |

Only `downweight` is genuinely new. v1 ships it as an optional config
block; absent config = no downweight.

## Deferred (explicitly out of v1)

- All classification (feature/layer/domain) and every metric/smell that
  needs it. **Removed permanently** per the user's directive — not
  deferred.
- Diff against a previous scan result file. v1's `--diff` is a git
  revrange, matching comp.
- Full alias-tracking stable IDs (rename/move detection across runs).
- Monorepo / workspace-aware analysis. v1 treats the repo as a single TS
  project.
- Churn integration (`--churn-window`/`--churn-ref`/`--no-churn` flags
  and churn-weighted scoring). The collector exists at
  `src/collectors/churn/`; folding it in is a follow-up.
- Approximate betweenness with sampling. v1 uses exact computation;
  measure first, add sampling when a real repo blows past the budget.
- Per-edge `uncertain` flag for dynamic imports / DI. Detection itself is
  v1; the confidence-aware scoring path is deferred.

## Open questions

None — all resolved during requirements review:

- Re-export resolution: always normalize, no flag.
- `--include-types`: on by default (weight 0.3), `--include-types=false`
  to drop entirely.
- `--churn-*` flags: omitted in v1; churn integration tracked in Deferred.

## Implementation plan (milestone-level)

The pipeline is built bottom-up: graph first, then metrics, then ranking,
then output, then CLI surface. Each milestone leaves the codebase in a
shippable state — strip-only check passes, tests pass, no half-wired
modules. Determinism is verified at every milestone that produces output
(golden-snapshot tested).

### M1 — Skeleton: resolve + graph

> Status: Completed (2026-05-01)

Goal: from a repo path, produce an in-memory component dependency graph.
No metrics, no output, no CLI yet.

- `src/architecture/resolve/`: tsconfig `paths` reader, relative/absolute
  resolver, barrel-normalization (always on, per requirements).
- `src/architecture/graph/`: walk parsed sources via
  `src/parser/parseSource.ts`, extract exports (named, default,
  re-exports, classes/functions/consts/types) and imports, build
  `Component` nodes and weighted edges per the edge-weights table.
- Dynamic / string / DI imports detected and tagged `uncertain` at the
  edge level (scoring use deferred).
- Unit tests: per resolver case, per export kind, per edge kind. No
  golden snapshots yet (no public output).

Exit: `buildGraph(repoPath, opts)` returns a deterministic
`{ nodes, edges }` value. Strip-only check still passes.

### M2 — Structural metrics

> Status: Completed (2026-05-01)

Goal: compute every per-node metric except betweenness.

- `src/architecture/metrics/`: fan-in, fan-out (weighted + unweighted
  variants both), reverse closure size, PageRank, instability,
  unstable-edge flag.
- Each metric is a pure function over the graph; no I/O.
- Unit tests with hand-built graph fixtures, asserting exact numbers.

Exit: `computeMetrics(graph)` returns a per-node metric record.

### M3 — Betweenness

> Status: Completed (2026-05-01)

Split out because betweenness is the algorithmically heaviest metric and
the most likely to need future sampling. Isolating it makes the
performance budget visible.

- Exact Brandes algorithm. No sampling (deferred).
- Unit tests: small graphs with known betweenness values.

Exit: betweenness slots into the metric record from M2 without changing
its shape.

### M4 — Ranking + scoring

> Status: Completed (2026-05-01)

Goal: turn metrics into ranked smell candidates.

- `src/architecture/ranking/`: percentile + z-score + small-N fallback
  (`N >= 100` vs `N < 100`).
- `src/architecture/scoring/`: composite weights per smell type (six
  smells), aggregation rule for primary + up-to-two-secondary smells per
  candidate.
- Unit tests for ranking math (cutoffs, ties, small-N path) and for
  composite calculations (per smell, with hand-built metric vectors).

Exit: `rank(metricRecord)` returns an ordered candidate list with
component IDs, primary smell, secondary smells, and contributing metric
breakdown.

### M5 — Reporters + dismissal integration

> Status: Completed (2026-05-01)

Goal: machine-readable and human-readable output, with dismissal IDs.

- `src/architecture/report/`: Markdown renderer (summary + candidate
  cards + per-smell counts + suppression hits), JSON renderer (versioned
  schema mirroring `dup --format json`).
- Stable component IDs (`<file>::<name>::<kind>`) and candidate IDs
  (`arch:<sha256[0..10]>`); register `arch:` prefix in
  `src/dismissal/store.ts`.
- Suppression hits surfaced in the Markdown summary (count + IDs).
- Golden-snapshot tests: small fixture repo → frozen Markdown + JSON.

Exit: `report(candidates, format)` produces deterministic output;
`dismiss arch:<hex>` round-trips through existing commands.

### M6 — CLI surface

> Status: Completed (2026-05-01)

Goal: wire everything to `ts-hotspots architecture` / alias `arch`.

- `src/architecture/cli/registerCommand.ts`: `addArchitectureCommand`
  mirroring `addDuplicationCommand` exactly (help-text shape, registrar
  pattern).
- Mount on root program in `src/cli.ts`.
- Add `architecture`/`arch` to `normalizePhaseTimingsArgv` allow-list.
- Add `arch` to strip-only transitive coverage (automatic via cli.ts
  import — verify in `tools/check-strip-only.ts`).
- Flags wired:
  - `[path]`, `-e, --exclude`, `--limit`, `--format`, `--verbose` —
    shared shape with comp/dup, no new behavior.
  - `--ref` — graph built at the given commit (mirrors dup's `--ref`).
  - `--diff` — display filter, mirroring comp (orthogonal to `--ref`;
    both can be passed).
  - `--include-types[=false]`.
- Integration tests: end-to-end CLI invocations against a fixture repo,
  asserting against the same golden snapshots from M5.

Exit: `pnpm start architecture <path>` produces the M5 output via the
public CLI surface. CLAUDE.md updated to document the justified
asymmetries (`--include-types`, churn omission).

### M7 — Allowlist downweight + real-repo tuning

> Status: Completed (2026-05-01)

Goal: optional per-glob edge weight multipliers, plus calibration
against a non-trivial real codebase.

- Optional config block (location TBD during M7; likely
  `.ts-hotspots.json` or similar — decide when implementing).
- Run `arch` against a real repo, sanity-check candidate ranking,
  adjust default composite weights if a smell type is consistently
  swamping or starving.
- Update golden snapshots if weights change.

Exit: v1 ships. Follow-ups (churn integration, alias-tracking IDs,
betweenness sampling, monorepo support, uncertain-edge scoring) move to
their own plans.

### Out of milestones

- Documentation: README updates land alongside M6 (CLI surface visible)
  and M7 (final tuning), not as a separate milestone.
- Performance budget: no dedicated milestone. The arch pipeline ships
  without `--phase-timings` instrumentation — runtime is fast enough on
  real repos that the diagnostic was not worth the surface area. If a
  future repo blows past budget, betweenness sampling becomes its own
  follow-up plan, and any required instrumentation lands alongside it
  rather than as a no-op flag.
