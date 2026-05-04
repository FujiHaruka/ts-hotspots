# `ts-hotspots cochange` subcommand — requirements

Status: draft (requirements only — no implementation plan yet).
Goal: add a fourth subcommand that surfaces **logical coupling** —
pairs of files that change together in git history but are not (or
only weakly) connected by static dependency edges.

## Context

ts-hotspots already gives an agent three coordinate streams:

- `comp` — per-function complexity, ranked per metric.
- `dup` — Type-3 duplication candidate fragments.
- `arch` — exported-component dependency-graph hotspots.

All three are static-analysis lenses. They cannot see two files that
are joined by convention rather than by an `import` — the kind of
coupling that shows up only when you watch the repo evolve over time.
That blind spot is what `cochange` fills.

The signal is well-established under several names ("logical
coupling", "change coupling", "co-changes"). It is, in the framing of
this tool, *exactly* the "where to read first?" question: **if I am
about to edit file A, which other files have a track record of
needing edits in the same commit?**

This deliberately does **not** overlap with linter territory. Linters
have no concept of git history, and the metric is inherently
quantitative (frequency, conditional probability) — a binary
"file pair is/isn't coupled" rule has no useful threshold.

## Approach

Add a subcommand `cochange`. The unit of analysis is the **file
pair** `(A, B)`, ordered canonically by path so each pair appears
once. For each pair we report co-occurrence counts and conditional
probabilities derived from `git log --first-parent -m --name-status -M`
within a sliding window of recent commits — the same git invocation
shape `comp`/`dup` already use for churn, so rename-following is free.

The deliverable is a ranked list of file-pair candidates with
file-level coordinates and metric facts. No verdict, no proposed
refactor — same agent-facing role as the other three subcommands.

The implementation reuses the existing parser-only / git-only stance
(no AST parse is needed at all here — it is a pure history walk),
follows `dup`'s module-layout discipline, must clear the strip-only
TS check, and must produce bit-identical output for the same input.
No `--phase-timings` and no `perfLog` discipline: cochange is a
single-pass git walk with no pipeline stages worth instrumenting
(the `--phase-timings` surface stays dup-only, matching the
existing asymmetry note in CLAUDE.md). The CLI integrates via the
same registrar pattern as `addArchitectureCommand`, with a new
`coch:<hex>` prefix in the dismissal registry.

## Naming: why `cochange`

Existing subcommands follow *noun describing the phenomenon being
analyzed*: `complexity`, `duplication`, `architecture`. Continuing that
pattern:

| Candidate            | Notes                                                |
| -------------------- | ---------------------------------------------------- |
| `cochange` / `coch`  | Standard term in the literature ("change coupling" / "co-changes"); short alias is unambiguous beyond two characters. **Chosen.** |
| `coupling` / `coup`  | "coup" is loaded; "coupling" alone could read as the static coupling that `arch` already covers. |
| `coevolution` / `coev` | Accurate but academic; same `co…` prefix collision as `cochange`. |
| `evolution` / `evol` | Avoids the prefix collision but reads broader than what the command does (it does not analyze refactor patterns or release cadence). |
| `history` / `hist`   | Describes the data source, not the phenomenon. |

**Acknowledged friction.** `cochange` and `complexity` share their
first two letters (`co…` vs `co…`). Tab-completion of
`ts-hotspots c<TAB>` resolves to a 2-way ambiguity (comp / cochange)
and `ts-hotspots co<TAB>` resolves uniquely to `cochange`. This is
worse than the `dep`/`dup` collision that `arch` was named to avoid
(one letter vs two), but every alternative either changed the
semantic frame (`evolution`, `history`) or invited worse confusion
(`coup`, `coupling` overlapping with `arch`). The four-letter alias
`coch` resolves uniquely from the third character on.

If review prefers a clean prefix, **`evolution` / `evol`** is the
fallback recommendation; it loses precision of meaning but keeps the
help-output unambiguous.

## Consistency review against `comp` / `dup` / `arch`

### Shared by all subcommands

| Concern                | comp                          | dup                           | arch                          | cochange (proposed)            |
| ---------------------- | ----------------------------- | ----------------------------- | ----------------------------- | ------------------------------ |
| Positional             | `[path]`                      | `[path]`                      | `[path]`                      | `[path]`                       |
| Output destination     | stdout                        | stdout                        | stdout                        | stdout                         |
| `-e, --exclude <glob>` | repeatable, additive          | repeatable, additive          | repeatable, additive          | repeatable, additive           |
| `--limit <N\|all>`     | default 20, accepts `all`     | default 20, accepts `all`     | default 20, accepts `all`     | default 20, accepts `all`      |
| `--format <markdown\|json>` | default markdown         | default markdown              | default markdown              | default markdown               |
| `--verbose`            | rich schema                   | rich schema                   | rich schema                   | rich schema                    |
| `--diff <revrange>`    | display filter (post-rank)    | base/head sides (build-time)  | display filter (post-rank)    | display filter (post-rank) — matches comp/arch |

### `cochange`-specific (justified asymmetries; CLAUDE.md note required)

| Flag                       | Why cochange only |
| -------------------------- | ----------------- |
| `--window <N>`             | A window concept exists in `comp`/`dup` as `--churn-window`, but there it scopes only the **churn axis** — one input among many. In cochange the window IS the entire input. Reusing `--churn-window` would falsely imply churn is a side axis here. Following the precedent set by `arch --ref` (which is **not** spelled `--churn-ref` because the ref isn't a churn axis there either), cochange uses unprefixed `--window`. Default 200, matching the `--churn-window` default. **This is the first time the project has an unprefixed `--window`; CLAUDE.md needs a note when this lands.** |
| `--ref <ref>`              | Endpoint of the history window. Default `HEAD`. Spelling matches `arch --ref` (also unprefixed for the same reason). Role is identical to `--churn-ref` in `comp`/`dup` but the un-prefixed spelling reflects that the entire command is the time-windowed walk. |
| `--min-support <N>`        | Floor on the raw co-change count. Defaults to `3` to drop one-off coincidences that produce N² noise. Filters before ranking. No equivalent in other subcommands; needed because cochange is the only command with a quadratic-in-input search space. |
| `--max-files-per-commit <N>` | Ignore commits touching more than N files. Defaults to `50`. A single 200-file commit produces C(200,2) = 19,900 pair updates, almost all coincidental (mass renames, formatter passes, dependency bumps). This guard is critical for both signal quality and runtime; the threshold mirrors the rule of thumb in the change-coupling literature. |

### Asymmetries inherited from comp / dup / arch

| Flag                        | Subcommand(s)        | Why cochange doesn't have it                                  |
| --------------------------- | -------------------- | ------------------------------------------------------------- |
| `-m, --metrics`             | comp                 | Selects which axes to compute. cochange's metrics are all co-derived from the same git walk; per-axis selection has no execution-cost saving and would just hide rows from the report. |
| `--file <path>`             | comp                 | **Same flag name, different drill-down axis.** comp's `--file X` lists every function inside file X (vertical drill-down: file → its functions). cochange's `--file X` lists every cochange partner of X (horizontal drill-down: file → other files coupled to it). Reusing the name is justified because in both cases the user has fixed attention on file X and wants "everything relevant about X" — the orthogonality of "inside vs. partnered with" is a subordinate detail. Spelled out in "Single-anchor mode" below so agents understand the schema shift. |
| `--churn-window` / `--churn-ref` / `--no-churn` | comp, dup | cochange does not compute churn as a side axis; the analogous concept is `--window`/`--ref` above. Including the `--churn-*` spellings would falsely imply a separate churn axis. There is no `--no-cochange` analog either: disabling the command's only signal is meaningless. |
| `--include-types`           | arch                 | cochange does not parse imports. There is no edge typing to toggle. |

### Subcommand-name collision check

`comp`, `dup`, `arch`, `cochange` (alias `coch`). Tab-completion of
`a<TAB>` → `arch`, `d<TAB>` → `dup`, `co<TAB>` → `cochange`,
`coch<TAB>` → `cochange`, `comp<TAB>` → `comp`. The only ambiguity
zone is `c<TAB>`; documented above and accepted.

### Dismissal ID prefix

The existing prefixes (`comp:`, `dup:`, `arch:`) all match the
subcommand alias rather than the long name. cochange follows the
same rule: **`coch:<hex>`** (alias-aligned), not `cochange:<hex>`.

The ID is computed as `sha256(pathA + "\n" + pathB)` where
`(pathA, pathB)` is the canonical-ordered pair (lexicographic on
POSIX path). `src/dismissal/hash.ts` currently recognizes
`comp: | dup: | arch:` in its `normalizeDismissalId` allowlist; it
needs `coch:` added there alongside a new
`computeCochangePairDismissalId` helper paralleling
`computeArchComponentDismissalId`.

## Subcommand shape (final)

```
ts-hotspots cochange [path]
  alias: coch
  default: scan whole repo at HEAD over the last 200 commits
  output: markdown to stdout
```

### Flags (final)

```
-e, --exclude <glob>           extra path glob (repeatable; same wording as comp/dup/arch)
    --limit <N|all>            cap pair candidates at top N (default 20; accepts 'all')
    --format <markdown|json>   report format (default markdown)
    --verbose                  emit the rich schema
    --diff <revrange>          display filter — show only pairs that include
                               at least one file changed in the revrange.
                               Same display-filter semantics as comp/arch.
    --ref <ref>                endpoint of the history window (default HEAD)
    --window <N>               number of commits in the window (default 200)
    --min-support <N>          drop pairs with raw co-change count below N (default 3)
    --max-files-per-commit <N> ignore commits that touch more than N files (default 50)
    --file <path>              single-anchor mode: rank co-change partners of <path> only
```

## Unit of analysis

The reporting unit is a **pair** of repo-root-relative POSIX paths,
canonically ordered (lexicographic). Each pair appears at most once
in the output. The pair is materialized in the schema using dup's
existing `anchor?` + `members[]` shape (see "Output: hotspots"
below) so downstream agents read every subcommand through the same
type.

File-level only (no `:line` precision). Per-function or per-symbol
cochange would require `git log -L`, which the project explicitly
ruled out for `comp` (§10 of `docs/requirements.md`) on the same
grounds: execution cost and fragile boundary tracking. The same
verdict applies here. The schema reuses `HotspotRef = { location, kind }`
from comp/dup; for cochange `location` is the file path with no line
range and `kind` is the literal string `"file"`.

The default file-set is the same as the other subcommands: tracked
`.ts` / `.tsx` / `.mts` / `.cts` files via `git ls-files`, minus
`--exclude`. **Pairs are restricted to within that file-set.** A TS
file that always changes alongside `package.json` is interesting, but
v1 keeps the project-scope invariant of ts-hotspots — TS-to-TS pairs
only. Cross-extension cochange is tracked under "Out of scope".

Renames are followed via the same `parseChurnLog` rename-following
walk used by the churn collector (`src/collectors/churn/commit-count.ts`).
A pair is keyed by **post-rename canonical paths**, so historical
co-changes against a file's pre-rename path are credited correctly.

## Metrics

For every pair `(A, B)` that survives `--min-support`, the report
emits:

| Metric ID         | Meaning |
| ----------------- | ------- |
| `support`         | Number of commits in the window where both A and B were touched. |
| `confidenceAtoB`  | `support / changesOf(A)` — `P(B changed | A changed)`. |
| `confidenceBtoA`  | `support / changesOf(B)` — `P(A changed | B changed)`. |
| `confidenceMax`   | `max(confidenceAtoB, confidenceBtoA)` — the directional reading the agent is most likely to act on. |
| `lift`            | `(support * windowCommits) / (changesOf(A) * changesOf(B))` — `>1` means co-occurrence above chance. |

All five are raw values. Per the project's "raw-first, no synthesized
score" design principle (§2 of `docs/requirements.md`), there is no
weighted composite. The agent ranks on whichever axis matters for its
decision.

## Ranking and candidate gate

A pair is a candidate if **all of**:

- `support >= --min-support` (default 3), and
- `lift > 1.0` (above-chance co-occurrence — drops pairs whose co-change is purely a side-effect of both files being touched a lot in unrelated commits), and
- `confidenceMax >= 0.30` (at least a 30% chance that touching one implies touching the other — the floor that distinguishes "noise" from "actually coupled").

Both thresholds are hardcoded in v1, mirroring `comp`'s gate-tuning
posture (§6.1: "The threshold is fixed (no flag in v1)").

Ordering of the candidate set, descending:

1. `support * confidenceMax` (the integer × probability product
   biases toward pairs that are both frequent and tight)
2. `lift` (tie-break: prefer above-chance pairs)
3. lexicographic `pathA` then `pathB` (deterministic final tie-break)

No leverage axis (no churn amplifier here — cochange already IS the
churn axis applied pairwise).

## Single-anchor mode (`--file <path>`)

When `--file <path>` is passed:

- Only pairs containing `<path>` are returned.
- Each surviving pair sets `anchor = { ref: { location: <path>, kind: "file" } }`
  and `members = [{ ref: { location: <partner>, kind: "file" } }]`
  (length 1). Without `--file`, `anchor` is omitted and `members`
  carries the full lex-ordered pair (length 2). `size` is `2` in
  both cases — see the schema table under "Output: hotspots".
- Sort key changes: pairs are ordered by `confidence(<path> → partner)`
  descending — the "if you touch X, also read…" reading. The
  unfiltered sort key (`support * confidenceMax`) is wrong here
  because the anchor's direction is fixed.
- `--min-support` and the gating thresholds still apply.
- Agent flow: "Claude has been asked to edit X. Run
  `ts-hotspots cochange --file X` to find adjacent files."

## Output: hotspots

The envelope mirrors `comp`/`dup`/`arch`: `tool`, `project`,
`hotspots[]`, plus optional `diff`, `dismissed`. Diff mode keeps the
`diff` block (`baseSha` / `headSha` / `threeDot` / `changedFiles`,
identical to `comp`'s); whole-repo mode omits it.

The pipeline / scope counters live on the stderr stats line, not in
the JSON. Success reports omit `status`; only the error envelope
keeps it (`status: "error"`).

`project` carries `windowCommits` (the actual number of commits the
walk consumed — may be less than `--window` on shallow clones or
short histories) and `analyzedFileCount`. `--verbose` adds
`commitsTouchedByPair` and `pairCandidateCountBeforeGate`.

Each `hotspots[]` entry carries (shape mirrors `SlimDupHotspot` in
`src/duplication/report/serializeReport.ts`):

- `kind: "cochange"` — discriminator for agents that consume multiple subcommands.
- `size: 2` — total files in the pair, computed `(anchor ? 1 : 0) + members.length`, identical formula to dup.
- `score` — `{ axis: "supportConfidence", value: number }` — the same composite the ranking sort key uses (`support × confidenceMax`), surfaced verbatim so JSON ordering and `score.value` ordering agree. The component metrics live in the `metrics` block (`metrics.support`, `metrics.confidenceMax`); `lift` is alongside them for agents that want to re-rank.
- `anchor?: { ref: HotspotRef }` — present only in single-anchor mode (`--file <X>`); omitted in whole-repo and `--diff` modes (cochange's `--diff` is a display filter, **not** an anchor-defining mode like dup's). When present, `anchor.ref.location === <X>`.
- `members: { ref: HotspotRef }[]` — the other file(s) in the pair. Length 2 when `anchor` is omitted (whole-repo / `--diff`), length 1 when `anchor` is set (`--file` mode). `HotspotRef = { location, kind: "file" }`; `location` is the repo-root-relative POSIX path with no line range.
- `metrics` — the five raw values listed above.
- `evidence` — `{ recentCommits: string[] }` — short SHAs (7-char) of up to the 5 most recent commits that touched both files. Display-only cap at the serializer boundary; the walker keeps the full list and `--verbose` exposes it as `allCoChangeCommits`. Lets the agent run `git show <sha>` to confirm the coupling pattern without re-deriving it.
- `dismissalId` — `coch:<hex>` (see "Dismissal ID prefix" above).

Mode-by-mode shape (parallel to dup's whole-repo-vs-diff schema variation):

| Mode                       | `anchor`              | `members.length` | `size` |
| -------------------------- | --------------------- | ---------------- | ------ |
| whole-repo (default)       | omitted               | 2                | 2      |
| `--diff <revrange>`        | omitted (display filter only) | 2        | 2      |
| `--file <path>`            | `{ ref: <path> }`     | 1                | 2      |

`--verbose` re-attaches:

- `summary` — window stats (`requestedWindow`, `actualWindow`, `commitsSkippedAsLargeChange`, `pairsBeforeGate`, `pairsAfterGate`).
- `metrics.changesOfA` / `metrics.changesOfB` — denominators for the conditional-probability calculations (slim default omits these because the ratios are already in `confidenceAtoB` / `confidenceBtoA`).
- `evidence.allCoChangeCommits` — full SHA list (not truncated).
- `evidence.coChangeWindow` — the first/last SHA in the actual window walked, so the agent can re-derive the metric.

The exit code is `0` even when zero hotspots are found — detection is
the tool's responsibility, decision-making is downstream. This matches
`comp`/`dup`/`arch`.

## Algorithm sketch (for requirements review only)

1. Resolve `--ref` and the file-set (`git ls-files` filtered by
   default + `--exclude` globs).
2. Walk `git log --first-parent -m --name-status -M -n <window> <ref>`,
   reusing `parseChurnLog`'s rename-tracking machinery so that
   pre-rename co-changes are credited to the post-rename canonical
   path. Skip commits touching more than `--max-files-per-commit`
   files (counted *after* mapping to canonical paths and intersecting
   with the file-set).
3. For each surviving commit `C`, let `F_C` = the canonical paths of
   the touched-and-tracked files. Emit each unordered pair from
   `F_C` into a `Map<pairKey, { support: number; recent: string[] }>`,
   appending the short SHA to `recent` (full list — the slim 5-SHA
   display cap is applied later at the serializer boundary).
4. Compute per-file `changesOf(X)` from the same walk (same map, free
   side-product).
5. For each pair, compute `confidenceAtoB`, `confidenceBtoA`, `lift`
   from `support`, `changesOf(A)`, `changesOf(B)`, `actualWindow`.
6. Apply gate (§"Ranking and candidate gate"), sort, truncate to
   `--limit`, render.

The whole pipeline is git-only; no parser invocation. No
`worker_threads`. Memory is bounded by the unique-pair count, which
the `--max-files-per-commit` cap keeps linear-ish in window size.

## Non-functional requirements

- **Determinism**: same repo state + same `--ref` + same `--window` ⇒
  bit-identical output, including ordering of pairs and `recentCommits`
  SHA lists. Same posture as `comp`/`dup`/`arch`.
- **Graceful skip**: non-git, missing git binary, shallow clone with
  insufficient window — emit a single warning to stderr, return an
  empty `hotspots[]` (not an error). The stdout JSON stays intact.
  Same shape as `comp`'s churn graceful-skip in §9.
- **CI environments**: GitHub Actions' default `fetch-depth: 1`
  produces a single-commit window, which trivially yields zero pairs.
  Document this; the user opts into `fetch-depth: 0` if they want the
  signal.
- **Token economy**: default `--limit 20` keeps output small enough
  for an agent's attention budget. The `evidence.recentCommits` cap
  of 5 is a conscious choice over "all commits" for the same reason.
- **Performance**: target sub-second on a 10k-file repo with the
  default 200-commit window. The walk is single-pass and the map
  updates are O(pairs-per-commit). No AST parsing.
- **No incremental cache**: every run is a full walk, matching the
  rest of the tool.

## Out of scope for v1

- **Cross-extension cochange** (TS file paired with `package.json`,
  `*.yaml`, `*.md`). v1 stays within the project's TS-only
  invariant. Adding it later is mechanical (drop the file-set filter
  in step 1).
- **Per-function / per-symbol cochange.** Requires `git log -L`;
  ruled out for the same reasons `comp` ruled it out (§10 of
  `docs/requirements.md`).
- **Group / cluster output** ("these N files all change together").
  v1 reports pairs only. Agents can derive groups from the pair
  graph if they want; flattening to pairs keeps the output schema
  parallel with the other subcommands.
- **Author coupling** (which authors tend to co-edit). Different
  signal, different agent use case, different risks (PII).
- **Time-decayed weighting** (recent co-changes weigh more). v1 uses
  a flat window. Decay is a v2 axis, behind a flag, after the simple
  version is shipped.
- **Cochange across submodules.** Same posture as `comp`'s churn (§10).
- **Rename detection beyond `git log -M` defaults.** No similarity
  threshold tuning, no `-C` (copy detection — too noisy for cochange).
- **A `--churn-amplifier` analog for the score.** cochange already
  IS a churn-derived signal; double-counting it would be incoherent.
- **MCP server packaging.** Same answer as the other subcommands.

## Decisions resolved during requirements review

The following defaults were tentative in earlier drafts; review has
locked them in. Recorded here so a future revisit has the rationale
in one place rather than spread across commit messages.

- **Naming**: `cochange` / alias `coch`. The `c<TAB>` ambiguity with
  `comp` was acknowledged and accepted; resolves uniquely from
  `co<TAB>` onward, and "cochange" matches the standard term in the
  change-coupling literature.
- **`--max-files-per-commit` default**: `50`. Matches the literature
  rule of thumb. On this repo's empirical distribution
  (51 commits sampled: p50=3, p90=19, p99=47, max=284) it excludes
  the clear sweep outlier (284, a tsconfig drop) while keeping
  legitimate medium PRs. The 47-file ts-morph drop sits just under
  the threshold; the `support >= 3` floor + `lift > 1.0` gate
  bound the residual confidence-inflation risk.
- **`--min-support` default**: `3`, fixed (not scaled with `--window`).
  Predictability matters more here than adaptive tuning; the
  downstream `lift > 1.0` and `confidenceMax >= 0.30` gates already
  filter chance co-occurrence on large windows. Users opt into a
  tighter floor with explicit `--min-support`.
- **`confidenceMax >= 0.30` floor**: kept. Adds a directional
  guardrail orthogonal to the lift gate ("the actionable read
  exceeds 1-in-3"). Worth dogfooding before locking in v2.
- **Pair score axis**: `supportConfidence` (= `support × confidenceMax`,
  the same composite the sort key uses). Earlier drafts emitted
  `confidenceMax` here for its `[0, 1]` bound, but that left JSON
  ordering and `score.value` ordering disagreeing — JSON readers saw
  a row with `score 0.857` above one with `score 1.0`. Surfacing the
  sort key directly fixes the honesty bug; the `[0, 1]`-bounded
  reading is still available as `metrics.confidenceMax`.
- **`--include-non-ts`**: deferred to v2. v1 stays TS-only with no
  flag. Adding it later is a mechanical change (drop the file-set
  filter in step 1 of the algorithm sketch). Default exclude globs
  already cover lock files / generated / snapshots, so when the
  flag does land, the noisiest source of false coupling is already
  handled by the existing exclude infrastructure.

## Reused infrastructure

- Git utilities: `src/util/git/{parseRevRange,findGitRoot,
  listChangedFilePaths,runner}.ts` for `--diff`, `--ref`, and the
  history walk.
- Rename-following walk: `parseChurnLog` in
  `src/collectors/churn/commit-count.ts` — the rename-tracking core
  is directly reusable; cochange needs a parallel function that
  records *pairs* per commit instead of per-file counts, but the
  rename machinery is identical and should be extracted to a shared
  helper rather than copied.
- Default exclude globs: `src/defaults.ts` (`DEFAULT_EXCLUDE_GLOBS`).
- CLI registrar pattern: `src/architecture/cli/registerCommand.ts`
  (`addArchitectureCommand`) — cochange's
  `addCochangeCommand(parent, onParsed)` mirrors this exactly.
- Dismissal registry: `src/dismissal/`. `coch:<hex>` IDs route
  through the same `dismiss` / `list-dismissed` / `undismiss` commands;
  `normalizeDismissalId` in `src/dismissal/hash.ts` needs `coch:`
  added to its prefix allowlist.
- Strip-only check: `tools/check-strip-only.ts` already imports
  `src/cli.ts`, so registering `cochange` there transitively covers
  validation.

## Implementation plan (milestone-level)

Built bottom-up: data layer → metrics → gate → output → CLI →
advanced flag modes → docs. Each milestone leaves the codebase in a
shippable state — strip-only check passes, tests pass, no half-wired
modules. Determinism is verified at every milestone that produces
output (golden-snapshot tested), matching the discipline used for
`dup` and `arch`.

### M1 — Refactor: extract rename-tracking walker

> Status: Not started

Goal: lift the rename-following machinery out of `parseChurnLog`
(`src/collectors/churn/commit-count.ts`) into a shared module so
both the existing per-file counter and the upcoming pair walker
build on one rename-tracking implementation.

- New module `src/util/git/walkChurnLog.ts` (or similar) that
  accepts a per-commit visitor callback and handles the rename-aware
  walk over `git log --first-parent -m --name-status -M -n <window> <ref>`.
- `parseChurnLog` becomes a thin adapter that registers a "bump
  per file" visitor against the shared walker. No public API change.
- `comp` and `dup` golden snapshots stay bit-identical — this is a
  pure refactor.

Exit: shared walker exists and is exercised by `parseChurnLog`'s
existing test suite without regression. New unit tests cover the
visitor contract directly. Strip-only check passes.

### M2 — Pair walker + raw metrics

> Status: Not started

Goal: a deterministic git-walk that produces the raw co-change map
and per-file change counts. No gate, no output, no CLI.

- New module `src/cochange/walk/walkCochange.ts` that uses the M1
  shared walker and emits a `Map<canonicalPath, number>` (per-file
  changes) plus a `Map<pairKey, { support: number; recent: string[] }>`
  (pair counts + full SHA list; the 5-SHA slim-display cap lives in
  the serializer).
- `--max-files-per-commit` skip applied (count canonical-and-tracked
  files only; configured threshold injected as an option, hardcoded
  to 50 by callers in this milestone).
- New module `src/cochange/metrics/computeMetrics.ts` that derives
  `confidenceAtoB` / `confidenceBtoA` / `confidenceMax` / `lift`
  from the walker's two maps.
- Unit tests with synthetic git fixtures (in-process by feeding
  hand-crafted log strings, not by spinning up real git repos).

Exit: `walkCochange(opts) → { perFileChanges, pairs, actualWindow,
commitsSkippedAsLargeChange }` is deterministic. `computeMetrics`
turns it into per-pair raw values. Strip-only check passes.

### M3 — Gate + ranking

> Status: Not started

Goal: apply the candidate gate and produce the sorted candidate
list. Still no I/O, no schema, no CLI.

- `src/cochange/ranking/applyGate.ts`: drops pairs failing
  `support >= minSupport`, `lift > 1.0`, `confidenceMax >= 0.30`.
  All three thresholds injected as options; hardcoded defaults in
  one place per the spec.
- `src/cochange/ranking/sort.ts`: orders by
  `support × confidenceMax` desc, then `lift` desc, then lex on
  `(pathA, pathB)`. `--limit` truncation belongs here.
- Unit tests cover threshold edge cases and tie-break determinism.

Exit: `selectCandidates(walkResult, opts)` returns a deterministic
sorted candidate list. Strip-only check passes.

### M4 — Output schema + serializers

> Status: Not started

Goal: turn the candidate list into the public report shape and emit
both Markdown and JSON.

- `src/cochange/report/schema.ts`: type definitions mirroring
  `SlimDupHotspot` (anchor + members + size + score + metrics +
  evidence + dismissalId), plus the verbose extension.
- `src/cochange/report/dismissalId.ts`:
  `computeCochangePairDismissalId(pathA, pathB) → "coch:<hex>"`.
  Update `src/dismissal/hash.ts` `normalizeDismissalId` to recognize
  the `coch:` prefix alongside the existing three.
- `src/cochange/report/serializeJson.ts` and
  `src/cochange/report/serializeMarkdown.ts`: produce the slim-by-
  default + `--verbose` re-attaches contract from the spec. Markdown
  follows the card-per-hotspot shape used by comp/dup/arch.
- Golden-snapshot tests for both formats covering: empty result,
  single pair, multiple pairs, dismissal-filtered case, verbose
  variant.

Exit: given a candidate list, both formats round-trip deterministic
output. Dismissal recognition works for `coch:` IDs. Strip-only
check passes.

### M5 — CLI registration + dismissal integration (whole-repo only)

> Status: Not started

Goal: end-to-end working command for the default whole-repo mode.
No `--diff`, no `--file` yet — those land in M6/M7.

- `src/cochange/cli/registerCommand.ts`: `addCochangeCommand(parent,
  onParsed)` mirrors `addArchitectureCommand`. Wires
  `-e, --exclude`, `--limit`, `--format`, `--verbose`, `--ref`,
  `--window`, `--min-support`, `--max-files-per-commit`. Help text
  follows the `addHelpText("before", LONG_DESCRIPTION)` /
  `addHelpText("after", HELP_AFTER)` shape.
- `src/cochange/cli/main.ts`: orchestrates the pipeline (loader →
  walker → metrics → gate → dismissal filter → serializer). The
  loader uses `git ls-files` filtered by `DEFAULT_EXCLUDE_GLOBS` +
  user `--exclude`.
- Wire the new subcommand in `src/cli.ts` alongside
  `addArchitectureCommand`.
- Graceful-skip path: non-git, missing git binary, shallow clone —
  emit a single stderr warning and return an empty `hotspots[]`,
  matching `comp`'s churn graceful-skip shape.
- Integration test: invoke the CLI in-process against a fixture
  repo, assert the JSON output.

Exit: `ts-hotspots cochange [path]` works end-to-end with default
options. `ts-hotspots dismiss coch:<hex>` correctly carries
forward across runs. Strip-only check passes.

### M6 — `--diff <revrange>` display filter

> Status: Not started

Goal: add the post-rank display filter — show only pairs where at
least one file appears in the changed-file set.

- Reuse `parseRevRange` and `listChangedFilePaths` from
  `src/util/git/`.
- Filter applied after gate + sort, before `--limit` truncation
  (matching `comp --diff`'s display-filter semantics).
- Emit the `diff` envelope block (`baseSha` / `headSha` /
  `threeDot` / `changedFiles`) — same shape as comp's.
- Integration test against a fixture repo with two refs.

Exit: `ts-hotspots cochange --diff origin/main...` ranks the full
window and filters the report. Strip-only check passes.

### M7 — `--file <path>` single-anchor mode

> Status: Not started

Goal: switch the schema and sort key when the user pins an anchor file.

- Filter the candidate list to pairs containing `<path>`.
- Re-sort by `confidence(<path> → partner)` desc (NOT by
  `support × confidenceMax`).
- Schema shift: set `anchor = { ref: { location: <path>, kind: "file" } }`
  and reduce `members` to length 1.
- Validation: error if `<path>` is not in the analyzed file-set.
- Integration test covering the schema-shift case.

Exit: `ts-hotspots cochange --file src/foo.ts` returns the
single-anchor schema with the correct sort. Strip-only check passes.

### M8 — Documentation + asymmetry notes

> Status: Not started

Not test-bearing; pure docs and help-text work to land alongside
the feature.

- Update `CLAUDE.md`'s "CLI flag conventions" section with the
  cochange-specific asymmetries: unprefixed `--window`/`--ref`
  (precedent: `arch --ref`), `--file` semantic difference vs comp,
  `--min-support` / `--max-files-per-commit` cochange-only flags,
  `--phase-timings` staying dup-only.
- Update `README.md` user-facing docs to describe cochange under
  the same heading pattern as comp/dup/arch (write for a first-time
  reader, not as a changelog — per CLAUDE.md's user-facing-docs
  rules).
- Add cochange examples to the root help text in `src/cli.ts`.
- Add `ts-hotspots cochange` invocation to the dogfooding prompt
  if it lives there.

Exit: a first-time reader of README can run `ts-hotspots cochange`
and understand the output without consulting the requirements doc.
