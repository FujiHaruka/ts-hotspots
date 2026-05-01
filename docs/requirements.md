# ts-hotspots — Requirements

ts-hotspots is a CLI with two complementary features:

- **Complexity** (`ts-hotspots complexity [path]`, alias `comp`): per-function metrics ranked into a small set of refactor-candidate coordinates. Specified in Part A below.
- **Duplication** (`ts-hotspots duplication`, alias `dup`): Type-3 duplication candidates, in PR mode (changed code vs. the rest of the tree) or whole-repo mode. Specified in Part B; the implementation-level algorithms live under `docs/dedup/`.

Both features share a single guiding principle: **return coordinates and evidence, not verdicts.** The downstream coding agent or reviewer decides what to do.

---

## Part A. Complexity feature

## 1. Vision

A CLI tool that statically analyzes a TypeScript project with ts-morph and emits **coordinates and evidence** pointing out "where in the codebase the refactor-candidate hotspots live" — output shaped for handoff to coding agents (Claude Code, etc.).

Agents normally have no way to get a bird's-eye view of a large repository; they can only accumulate `grep` / `read` calls. As a result, they gravitate toward "conspicuous files" or "recently touched files" and miss the real hotspots. ts-hotspots shrinks that search space by orders of magnitude and commits to handing the agent a starting point that says "read from here — the hotspots concentrate here."

```
[ts-hotspots]  →  coordinates + metrics  →  [Agent decides autonomously]  →  refactor plan
```

The tool does not generate refactor proposals. It does not render ESLint-style pass/fail verdicts. It returns only facts and coordinates.

## 2. Design Principles

- **Agent-first output**: The default is a Markdown prompt wrap (short instruction text + fenced JSON). The primary shape is one you can pipe directly, e.g. `| claude --permission-mode plan`. `--json` emits raw JSON.
- **Raw-first, no synthesized score**: No single composite score. Each raw metric is an independent axis used for ranking; no cross-axis weighting.
- **Facts, not opinions**: No natural-language `reasons` generation. Axis name + raw value + rank is considered sufficient material for the agent to reason with.
- **Decisive coordinates**: The ranking unit is the function (declaration). `file:line` / `file:start-end` maps directly to `Read` tool offsets.
- **Deterministic**: Same input, same output. Robust to idempotent re-execution by the agent. Determinism on all axes — including git churn — is guaranteed by `HEAD` + window + repo state.
- **Measure, don't lint**: v1 only measures and ranks. No threshold verdicts. No rule-violation notifications.
- **Zero-config usable**: Meaningful output with zero arguments. Enumerates tracked TypeScript sources via `git ls-files` and returns candidates using default top-N and default axis filters. No `tsconfig.json` required.

## 3. Architecture

A 4-layer pipeline. Each layer is separated by a swappable boundary.

```
[1] Loader     : list git-tracked .ts/.tsx sources, seed a ts-morph Project
    ↓
[2] Collectors : walk the AST to collect per-declaration / per-file raw metrics
    ↓
[3] Aggregator : produce per-axis rankings at function / file granularity and compute candidates
    ↓
[4] Reporter   : emit a Markdown prompt wrap (default) or raw JSON
```

Implementation notes:

- **A single ts-morph Project is the source of truth.** No per-file independent parses.
- **No TypeChecker, no tsconfig.** Every collector is syntax-only or git-only; ts-morph wraps the AST without resolving symbols. Sources are enumerated through `git ls-files`, so monorepos and tsconfig-less repos work without extra configuration.
- **Collectors are plugin-shaped.** Adding a new metric takes "one more collector + one more axis ID registration."

## 4. Ranking Unit

The primary unit is a **declaration** — functions / methods / arrow functions / TSX components / etc.

Rationale for functions:
- Complexity-family metrics are inherently function-scoped. Aggregating to files produces false positives on files like API route modules, which hold many small independent functions.
- `file:line` maps directly to a `Read` offset, so function granularity steers the agent more precisely.

TSX function components are measured as ordinary functions. Class components get no special treatment in v1. Class-level method and field counts are captured minimally (classic OO metrics like WMC / DIT / LCOM are out of scope for v1).

File-level indicators (fan-in / fan-out / export count, etc.) are not provided in v1. The function unit aligns with the agent's `Read` granularity and keeps v1 scope minimal.

## 5. Axis System

Each axis is internally classified as either **quality** or **leverage**. This classification drives hotspot-candidate selection logic but is not exposed in the output schema.

- **quality**: expresses "tangledness" inside the function body or side-effect density. Material for deciding whether to refactor.
- **leverage**: the dimension that amplifies refactor ROI (blast radius / edit frequency). Only meaningful once a quality problem exists.

### 5.1 Function axes (`FunctionAxisId`, 9 axes) — note: no file axes in v1

**Quality (8 axes)**

| Axis ID | Meaning |
|---|---|
| `cognitiveComplexity` | Sonar-spec Cognitive Complexity |
| `maxNestingDepth` | Max nesting depth inside the function |
| `sloc` | Source Lines of Code for the function |
| `parameterCount` | Parameter count |
| `calleeCount` | Direct `CallExpression` count inside the function body (delegation density; does not recurse into nested functions) |
| `tryCatchCount` | `try/catch` density (an error-handling axis that tends to get buried inside CC) |
| `awaitCount` | `await` expression count (async complexity axis) |
| `mutationSiteCount` | Syntactic mutation count — assignments / compound assignments / `++` / `--` / `delete` (mutation via array methods is excluded) |

**Leverage (1 axis)**

| Axis ID | Meaning |
|---|---|
| `commitCount` | git churn. Commit count on the file this function belongs to (`git log --first-parent -m --name-status -M`). Renames are detected via `-M`, and commits against the pre-rename path are summed in. The function inherits the file value. |

## 6. Hotspot Candidate Selection

The default output for function axes is a **slim structure containing only hotspot candidates**. The candidate set and its ordering are determined as follows.

### 6.1 Candidate gate

Function F becomes a candidate if (OR):

- **Co-occurrence gate**: the set of **non-degenerate** axes F hit has size ≥ 3 **and** contains ≥ 1 quality axis. An axis is degenerate when `topNSpread = 0 ∨ uniqueTopNValues = 1`. The same predicate gates rescue.
- **Quality-only discriminative rescue**: F is in the top-3 of some **quality axis**, the axis is not degenerate, and the axis is not too sparse — its `nonZeroCount` covers at least 5% of measured functions. The threshold is fixed (no flag in v1).

The displayed `metrics` block also drops degenerate axes: a function gated in by co-occurrence has its degenerate hit axes filtered out before raw values are copied, so an agent reading `metrics` never sees a tie value masquerading as evidence.

Leverage axes alone do not produce candidates. They do not participate in the co-occurrence count unless at least one quality axis is also present. Rescue applies to quality axes only. This prevents load-bearing functions that merely have "many callers" or "high churn" from bubbling up.

### 6.2 Ordering

The candidate set is sorted in descending order by the following keys:

1. `totalHits` = quality axis hits + leverage axis hits
2. `qualityHits` (a safeguard so that candidates padded only by leverage axes do not outrank pure quality candidates)
3. String comparison of `location` → `name` → `kind` (deterministic tie-break)

As a result, two intuitions hold simultaneously: "for the same quality footprint, actively-used functions rank higher" and "for the same caller / churn, functions with more quality hits rank higher."

## 7. CLI

### 7.1 Invocation

```
ts-hotspots complexity [path]    # function-axis report (FunctionReport); `comp` is a short alias
```

- `path` is a directory inside a git working tree; it defaults to the current directory. Sources are enumerated via `git ls-files` (`.ts`, `.tsx`, `.mts`, `.cts`); untracked files are skipped. When `path` is not inside a git repo, the run fails with `NOT_A_GIT_REPO`.
- Passing an unknown axis ID to `--metrics` produces an `INVALID_METRIC` error.

### 7.2 Flags

| Flag | Meaning | Default |
|---|---|---|
| `--top <N>` | Top-N entries per axis | 5 |
| `--exclude <glob...>` | Exclude target files | `**/*.{test,spec}.{ts,tsx,mts,cts}` |
| `--metrics <list>` | Restrict output to these axis IDs (comma-separated) | unset = all axes |
| `--file <path>` | Single-file drill-down mode: return every function in that file across all metrics. Ranking and candidate computation are skipped. | — |
| `--verbose` | On top of the default slim output, restore `functionRankings` / `functionAxisMeta` / `functionCoOccurrence` / `functions[]` | off |
| `--churn-window <N>` | How many recent commits git churn walks | 200 |
| `--churn-ref <ref>` | Starting ref for churn measurement | `HEAD` |
| `--no-churn` | Disable git churn collection entirely | — |
| `--json` | Skip the Markdown prompt wrap and emit raw JSON | off (= Markdown) |

A config file (`ts-hotspots.config.*`) is not shipped in v1. Candidate gates and top-N thresholds are hardcoded.

## 8. Output Contract

### 8.1 `FunctionReport` (default)

- Envelope: `tool`, `project`, `hotspots[]`, plus optional `dismissed`, `pr`, `notice`. The shape is parallel to `dup`'s output (same keys) so an agent can consume both subcommands identically. Success reports omit `status`; only the error envelope sets `status: "error"`, so a top-level `status` field doubles as the failure discriminator.
- `project` carries only `sourceFileCount` in slim mode. `functionCount` moves to `--verbose`; the stderr stats line repeats it in human form.
- `hotspots`: the primary signal. The candidate set produced in §6. Each candidate carries `kind: "complexity"` (discriminator parallel to `dup`'s `kind: "duplication"`), a `ref` (`location`, `name`, `kind`), a `score` (`{ axis, value }` — the metric where this candidate ranked highest), a `metrics` map containing **only the raw metrics corresponding to hit axes**, and a `dismissalId`.
- Additional fields are returned only with `--verbose`:
  - `functionRankings`: top-N across every axis
  - `functionAxisMeta`: per-axis `nonZeroCount` / `maxTieLength` / `topNSpread` / `uniqueTopNValues` (always computed internally for candidate selection, but loaded into the schema only under `--verbose`)
  - `functionCoOccurrence`: enumeration of functions that appear in the top-N of multiple axes
  - `functions[]`: raw metrics for every function that shows up in any ranking
  - `project.functionCount` (omitted from the slim envelope)

- Under `--file <path>`, ranking and candidate computation are both skipped; every function in the specified file is returned via `functions[]`.

### 8.2 Error output

Errors do not break the stdout JSON / Markdown structure: we return `status: "error"` + `code` + `message`. A separate human-oriented message goes to stderr. Example codes: `NOT_A_GIT_REPO` / `INVALID_ARGS` / `INVALID_METRIC` / `UNKNOWN_ERROR`.

## 9. Non-functional Requirements

- **Determinism**: same repo state + same `HEAD` + same window ⇒ same output. Churn values differing across branches of the same repo is a deliberate design consequence.
- **git churn folding assumption**: we adopt `--first-parent -m`. Merge-commit-based PRs and squash merges collapse to one count per PR. In repos using rebase-merge, individual commits land on first-parent, so PR-level folding is impossible and 1 PR becomes multiple counts.
- **Graceful skip**: non-git, shallow-clone-with-insufficient-window, and missing git binary all avoid crashing. We zero-fill the churn axis (`commitCount = 0`) and continue. Only a single-line warning is emitted to stderr. The stdout JSON stays intact.
- **CI environments**: the GitHub Actions default shallow clone (`fetch-depth: 1`) zeros out the churn axis and disables that amplifier. If you need it, use the equivalent of `fetch-depth: 0`.
- **Token economy**: the default output (candidates only) fits comfortably in an LLM context on typical projects. For big projects, lower `--top`.
- **Performance**: target on the order of minutes for a 10k-file codebase. The ts-morph Project is built exactly once and never materializes a TypeChecker — collectors are syntax-only or git-only.
- **No incremental analysis / cache**: every run is a full analysis.
- **Pin ts-morph**: pinned as a direct dependency to keep alignment with the TypeScript compiler version.

## 9.1 Dismissal Registry

Minimal state is retained to carry false-positive judgments forward into future runs.

- Every `HotspotCandidate` carries a `dismissalId` — the SHA-256 of the function body after comment stripping + whitespace normalization.
- `ts-hotspots dismiss <id> --reason "..."` appends an entry to `${XDG_CONFIG_HOME ?? ~/.config}/ts-hotspots/<projectKey>/dismissed.json`. `<projectKey>` is the first 16 hex chars of `sha256(absProjectPath)` so that multiple projects on the same machine do not collide. This file is not committed to the repo; it is treated as a per-machine, per-developer cache (not shared with the team — a local, individual carry-over of judgments). `projectPath` is recorded in the file so a human can identify which subdirectory under home maps to which project.
- The default analyze run reads the registry on every invocation and filters the candidate set after the candidate stage and before the reporter. As a side effect, entries whose corresponding function no longer exists (deleted or body-modified) are pruned (self-healing).
- `FunctionReport.dismissed` carries `{ active, filteredThisRun, prunedThisRun }`. It is omitted when the registry is empty.
- Subcommands: `dismiss`, `list-dismissed [--json]`, `undismiss <id>`.
- If the registry file is corrupted, we emit a warning to stderr and treat the registry as empty for that run. The file is not overwritten.

## 10. Out of Scope for v1

Intentionally excluded:

- Refactor / fix proposal generation (that is the agent's job)
- Rule-violation verdicts / lint-style pass-fail (ESLint's territory)
- Config files (weight tuning / threshold customization)
- Cyclic dependency detection
- Advanced OO metrics on classes (WMC / DIT / LCOM)
- Special treatment of TSX class components
- Code duplication detection (AST similarity)
- Per-function git churn (`git log -L` — the execution cost and the fragility of boundary tracking are not worth it)
- Change tracking inside submodules
- File axes (kept out of v1 to minimize scope; revisit only if function-level signals prove insufficient)
- MCP server packaging (CLI is sufficient)
- Web dashboard / time-series DB / result cache (except the dismissal registry; see §9.1)

---

## Part B. Duplication feature

## B.1 Vision

A duplication-candidate detector tuned for **recall over precision**. Type-3 clones — copy-pasted regions with light edits (renamed identifiers, reordered statements, slightly different argument shapes) — are the target. Output is meant for downstream judgment, not a strict pass/fail verdict.

Two modes, sharing the same back-end pipeline:

- **PR mode**: given a git revrange (`A...B` / `A..B`), surface duplications between the head-side changed code and the rest of the tree.
- **Whole-repo mode**: at one ref, surface every cluster of fragments that look like the same code.

## B.2 Pipeline

A 7-stage pipeline. PR / whole-repo only differ in how the front-end builds the input set; everything from feature extraction onward is shared.

```
[1] Diff Collector / Source Lister
    ↓
[2] Fragment Extractor    (functions, blocks, statement windows)
    ↓
[3] Feature Extractor     (3 axes: token n-gram / statement-kind n-gram / call-property fingerprint)
    ↓
[4] Inverted Index
    ↓
[5] Candidate Search      (union of feature axes — recall-first)
    ↓
[6] Similarity Scorer     (token / statement-kind / call / size, OR-gated)
    ↓
[7] Report Generator      (clone groups with shared evidence)
```

The index is built in memory per run; nothing is persisted. See `docs/dedup/algorithms/` for the full algorithm specification.

## B.3 Fragment Granularity

A duplication unit is a **fragment**, one of:

- function / method / arrow function
- control-structure block (`if` / `for` / `while` / `try` / `catch` / `switch`)
- a sliding window of consecutive statements (to catch partial overlap that does not align with a function or block boundary)

Each fragment carries the file path, line range, kind, and source text it was extracted from.

## B.4 Features

Three orthogonal feature kinds, extracted per fragment:

- **Normalized token n-gram** — TypeScript tokens after normalizing identifiers / strings / numbers / booleans, dropping comments, and (optionally) dropping type annotations. Catches structural similarity that survives renaming.
- **Statement-kind n-gram** — only the AST statement-kind sequence (`VariableStatement`, `IfStatement`, `ReturnStatement`, ...). Identifier-agnostic.
- **Call / property fingerprint** — call-expression names and property accesses kept as-is, not normalized. High-information signal that cuts across rename-resistant noise.

n-gram lengths and inclusion of each kind are configurable.

## B.5 Candidate Search and Scoring

Candidates are looked up via inverted indexes built per feature kind. Hits are merged across kinds with **set union**, not intersection — recall-first.

Each candidate pair is then re-scored on:

- token overlap
- statement-kind similarity
- call / property overlap
- size compatibility (length-aware penalty for very different fragment sizes)

A weighted combined score is produced. Final reporting is gated by an **OR** condition: a pair clears if the combined score crosses its threshold *or* any single axis crosses its axis-specific threshold. This keeps the false-negative rate low.

### B.5.1 Churn-amplified group ranking

After clone groups are formed, their order in the report is determined by `combined.max × churnAmplifier(groupChurnMax)` rather than `combined.max` alone. The amplifier mirrors `comp`'s leverage axis (`commitCount`):

```
churnAmplifier = 1 + alpha * min(groupChurnMax, cap) / cap
```

`groupChurnMax` is the maximum recent-commit count across the files the group spans (`git log --first-parent -m --name-status -M`, same window and rename handling as `comp`). With the defaults (`alpha = 0.5`, `cap = 20`) a fully saturated group earns a 1.5× boost, just enough to flip a moderately-similar hot group above a colder near-clone — without letting churn overwhelm similarity. Pair-level scores are not modified, so `--limit` still cuts on similarity strength; the amplifier only re-orders the surviving groups.

When churn collection is unavailable (non-git, shallow clone, missing git binary, `--no-churn`) the amplifier is exactly `1.0` for every group and the ranking falls back to the legacy `combined.max` order. Flags (`--churn-window`, `--churn-ref`, `--no-churn`) carry the same meaning as in `comp` (§7.2).

## B.6 Output: Hotspots

The reporting unit is a **hotspot**, one per clone group. When the same pattern appears in N places, the report contains one entry with N coordinates, not `N(N−1)/2` pairs.

The envelope mirrors `comp`'s: `tool`, `project` (`sourceFileCount`; `--verbose` adds `fragmentCount`), `hotspots[]`, plus optional `pr`, `dismissed`. PR mode keeps the `pr` block (`baseSha` / `headSha` / `threeDot` / `changedFiles`, identical to `comp`'s); whole-repo mode omits it. The pipeline / scope counters live on the stderr stats line, not in the JSON. Success reports omit `status`; only the error envelope keeps it (`status: "error"`).

Each `hotspots[]` entry carries:

- `kind: "duplication"` — discriminator for agents that consume both `comp` and `dup`.
- `size` — total fragments in the group: `(anchor ? 1 : 0) + members.length`.
- `score` — `{ axis: "combined", value }` — single representative similarity (median `combined` across pairs, in 0..1). Same shape as `comp`'s `score`.
- `anchor?` — the changed-side fragment in PR mode; absent in whole-repo mode where no side is privileged. Shape: `{ ref: { location, kind } }`.
- `members[]` — every other fragment in the group, ordered by descending pair score. Shape: `{ ref: { location, kind } }`.
- `evidence` — `calls[]` and `properties[]` shared by every member, prefix-stripped (`new X` / `await X` keep the constructor / await distinction visible without leaking internal `CALL:` / `NEW:` / `AWAIT_CALL:` / `PROP:` markers).
- `dismissalId` — `dup:<hex>`; auto-expires when the group's membership changes.

`--verbose` re-attaches the diagnostic detail dropped by the slim default:

- `summary` — mode, per-side scope stats (files / fragments / lines / `fragmentsByKind` / `excludedFiles`), and pipeline counters (`candidatePairs` / `reportedPairs`).
- `members[].scores` — per-pair `combined` plus the five sub-axes.
- `members[].code` — fragment source (omitted from the slim default to keep the report under an LLM's attention budget).
- `aggregateScores` — group-level `min` / `median` / `max` per axis. `combined` additionally carries `amplified` (the churn-amplified value used as the group's sort key — see B.5.1).
- `aggregateChurn` — `{ max, min, perFile }` over the files this group spans. Absent when churn collection was disabled or skipped.
- `evidenceFull` — `statementKinds` and `tokenNgramsSample` (the slim `evidence` block already covers `calls` / `properties`).
- `recommendationHint` — `extract-function` / `parameterize` / `manual-review`, plus a confidence level computed from the weakest pair.

The exit code is `0` even when zero hotspots are found — detection is the tool's responsibility, decision-making is downstream. Default output is Markdown (`--format markdown`); `--format json` emits the same data as JSON.

## B.7 Non-functional

- **Recall over precision**: union-on-search, OR-on-decision (B.5).
- **Determinism**: same repo state + same revrange / ref ⇒ bit-identical output, including ordering.
- **Performance**: every run is a full analysis; the index is rebuilt in memory. CI runtime is the sizing target. Whole-repo mode on very large trees may need `--exclude` tuning.
- **Evidence everywhere**: every reported group is backed by structured evidence. No score-only output.
- **No persistence, no daemon**: nothing is written between runs.

## B.8 Out of Scope for v1 (duplication)

- Program Dependence Graph (PDG) analysis.
- Type-checker–dependent semantic similarity.
- Embedding-model or LLM-based similarity.
- Persistent index databases.
- Full O(N²) pairwise comparison.
- Automatic refactoring application.
