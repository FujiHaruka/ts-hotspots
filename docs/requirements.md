# ts-hotspots — Requirements

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
- **Zero-config usable**: Meaningful output with zero arguments. Finds `tsconfig.json` from the current directory and returns candidates using default top-N and default axis filters.

## 3. Architecture

A 4-layer pipeline. Each layer is separated by a swappable boundary.

```
[1] Loader     : feed tsconfig in, build a ts-morph Project (TypeChecker enabled)
    ↓
[2] Collectors : walk the AST to collect per-declaration / per-file raw metrics
    ↓
[3] Aggregator : produce per-axis rankings at function / file granularity and compute candidates
    ↓
[4] Reporter   : emit a Markdown prompt wrap (default) or raw JSON
```

Implementation notes:

- **A single ts-morph Project is the source of truth.** No per-file independent parses.
- **Enable the TypeChecker.** We need information that syntax alone cannot give us (e.g. implicit `any`), so we prioritize accuracy over performance.
- **Collectors are plugin-shaped.** Adding a new metric takes "one more collector + one more axis ID registration."
- **Solution-style monorepo support**: transitively follow `references` from the root `tsconfig.json` and load every referenced project into a single Project. Cross-package analysis happens on one TypeChecker.

## 4. Ranking Unit

The primary unit is a **declaration** — functions / methods / arrow functions / TSX components / etc.

Rationale for functions:
- Complexity-family metrics are inherently function-scoped. Aggregating to files produces false positives on files like API route modules, which hold many small independent functions.
- `file:line` maps directly to a `Read` offset, so function granularity steers the agent more precisely.

File-level indicators (fan-in / fan-out / export count, etc.) are not provided in v1. We judged that a file axis — as an independent command or as context for function hotspots — is not worth the cost (`callerCount` already provides sufficient leverage).

TSX function components are measured as ordinary functions. Class components get no special treatment in v1. Class-level method and field counts are captured minimally (classic OO metrics like WMC / DIT / LCOM are out of scope for v1).

## 5. Axis System

Each axis is internally classified as either **quality** or **leverage**. This classification drives hotspot-candidate selection logic but is not exposed in the output schema.

- **quality**: expresses "tangledness" inside the function body, type soundness, or side-effect density. Material for deciding whether to refactor.
- **leverage**: the dimension that amplifies refactor ROI (blast radius / edit frequency). Only meaningful once a quality problem exists.

### 5.1 Function axes (`FunctionAxisId`, 19 axes) — note: no file axes in v1

**Quality (17 axes)**

| Axis ID | Meaning |
|---|---|
| `cognitiveComplexity` | Sonar-spec Cognitive Complexity |
| `cyclomaticComplexity` | Classic Cyclomatic Complexity |
| `maxNestingDepth` | Max nesting depth inside the function |
| `sloc` | Source Lines of Code for the function |
| `statementCount` | Statement count |
| `parameterCount` | Parameter count |
| `returnCount` | Number of `return` statements |
| `anyCount` | Explicit `any` + TypeChecker-detected implicit `any` occurrences |
| `anyTaintedExpressionCount` | Number of expressions tainted by `any` propagation |
| `typeAssertionCount` | `as` assertions (excluding `as const`) |
| `unsafeCastCount` | Dangerous `as` casts among the above (e.g. downcasts) |
| `nonNullAssertionCount` | `!` non-null assertion count |
| `tsSuppressionsFamily` | Sum of `@ts-ignore` + `@ts-expect-error` + `@ts-nocheck` |
| `calleeCount` | Direct `CallExpression` count inside the function body (delegation density; does not recurse into nested functions) |
| `tryCatchCount` | `try/catch` density (an error-handling axis that tends to get buried inside CC) |
| `awaitCount` | `await` expression count (async complexity axis) |
| `mutationSiteCount` | Syntactic mutation count — assignments / compound assignments / `++` / `--` / `delete` (mutation via array methods is excluded) |

**Leverage (2 axes)**

| Axis ID | Meaning |
|---|---|
| `callerCount` | Number of call-sites reaching this function via TypeChecker `findReferences` (references that merely pass the function as a value are excluded). Consumers outside the package boundary cannot be detected. |
| `commitCount` | git churn. Commit count on the file this function belongs to (`git log --first-parent -m --name-status -M`). Renames are detected via `-M`, and commits against the pre-rename path are summed in. The function inherits the file value. |

## 6. Hotspot Candidate Selection

The default output for function axes is a **slim structure containing only hotspot candidates**. The candidate set and its ordering are determined as follows.

### 6.1 Candidate gate

Function F becomes a candidate if (OR):

- **Co-occurrence gate**: the set of axes F hit has size ≥ 3 **and** contains ≥ 1 quality axis.
- **Quality-only discriminative rescue**: F is in the top-3 of some **quality axis**, and that axis is not degenerate (`topNSpread > 0` **and** `uniqueTopNValues > 1`).

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
ts-hotspots [path]          # function-axis report (FunctionReport)
```

- `path` defaults to the current directory. When given, it is either a directory (we look up `tsconfig.json` inside it) or a direct `tsconfig.json` path.
- No subcommands. Passing an unknown axis ID to `--metrics` produces an `INVALID_METRIC` error.

### 7.2 Flags

| Flag | Meaning | Default |
|---|---|---|
| `--top <N>` | Top-N entries per axis | 5 |
| `--exclude <glob...>` | Exclude target files | `**/*.{test,spec}.{ts,tsx,mts,cts}` |
| `--metrics <list>` | Restrict output to these axis IDs (comma-separated) | unset = all axes |
| `--file <path>` | Single-file drill-down mode: return every function in that file across all metrics. Ranking and candidate computation are skipped. | — |
| `--full` | On top of the default slim output, restore `functionRankings` / `functionAxisMeta` / `functionCoOccurrence` / `functions[]` | off |
| `--churn-window <N>` | How many recent commits git churn walks | 200 |
| `--churn-ref <ref>` | Starting ref for churn measurement | `HEAD` |
| `--no-churn` | Disable git churn collection entirely | — |
| `--json` | Skip the Markdown prompt wrap and emit raw JSON | off (= Markdown) |

A config file (`ts-hotspots.config.*`) is not shipped in v1. Candidate gates and top-N thresholds are hardcoded.

## 8. Output Contract

### 8.1 `FunctionReport` (default)

- `functionHotspotCandidates`: the only primary signal. The candidate set produced in §6. Each candidate carries a `ref` (`location`, `name`, `kind`) and a `metrics` map containing **only the raw metrics corresponding to hit axes**.
- Additional fields are returned only with `--full`:
  - `functionRankings`: top-N across every axis
  - `functionAxisMeta`: per-axis `nonZeroCount` / `maxTieLength` / `topNSpread` / `uniqueTopNValues` (always computed internally for candidate selection, but loaded into the schema only under `--full`)
  - `functionCoOccurrence`: enumeration of functions that appear in the top-N of multiple axes
  - `functions[]`: raw metrics for every function that shows up in any ranking

- Under `--file <path>`, ranking and candidate computation are both skipped; every function in the specified file is returned via `functions[]`.

### 8.2 Error output

Errors do not break the stdout JSON / Markdown structure: we return `status: "error"` + `code` + `message`. A separate human-oriented message goes to stderr. Example codes: `TSCONFIG_NOT_FOUND` / `INVALID_METRIC` / `UNKNOWN_ERROR`.

## 9. Non-functional Requirements

- **Determinism**: same repo state + same `HEAD` + same window ⇒ same output. Churn values differing across branches of the same repo is a deliberate design consequence.
- **git churn folding assumption**: we adopt `--first-parent -m`. Merge-commit-based PRs and squash merges collapse to one count per PR. In repos using rebase-merge, individual commits land on first-parent, so PR-level folding is impossible and 1 PR becomes multiple counts.
- **Graceful skip**: non-git, shallow-clone-with-insufficient-window, and missing git binary all avoid crashing. We zero-fill the churn axis (`commitCount = 0`) and continue. Only a single-line warning is emitted to stderr. The stdout JSON stays intact.
- **CI environments**: the GitHub Actions default shallow clone (`fetch-depth: 1`) zeros out the churn axis and disables that amplifier. If you need it, use the equivalent of `fetch-depth: 0`.
- **Token economy**: the default output (candidates only) fits comfortably in an LLM context on typical projects. For big projects, lower `--top`.
- **Performance**: target on the order of minutes for a 10k-file codebase. The ts-morph Project is built exactly once. TypeChecker cost is accepted.
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
- File axes (`callerCount` leverage substitutes well enough that neither a separate command nor composition is worthwhile)
- MCP server packaging (CLI is sufficient)
- Web dashboard / time-series DB / result cache (except the dismissal registry; see §9.1)
