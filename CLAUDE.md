# CLAUDE.md

## Overview

ts-hotspots is a CLI that statically analyzes a TypeScript project and hands coding agents like Claude Code a "where should I read first?" — it does not propose refactors, only coordinates (`file:line`) and metric facts.

It exposes three parallel features as subcommands of one binary. All three parse sources via `ts.createSourceFile` directly (no `ts.Program`, no TypeChecker); the shared parser lives at `src/parser/parseSource.ts`.

- **Complexity** (`ts-hotspots complexity`, alias `comp`): per-function metrics ranked into refactor-candidate coordinates. The primary ranking unit is the function (including methods, arrow functions, and TSX components); file-level rankings are returned alongside.
- **Duplication** (`ts-hotspots duplication`, alias `dup`): Type-3 duplication candidates. Defaults to whole-repo scan at HEAD; pass `--diff <revrange>` to compare changed fragments on the head side against the rest of the codebase on the base side. Shells out to git for diff/source listing. Source lives under `src/duplication/`.
- **Architecture** (`ts-hotspots architecture`, alias `arch`): exported-component dependency-graph hotspots. Builds a parser-only component graph, computes structural metrics (fan-in/out, reverse closure, PageRank, Brandes betweenness, instability), then ranks components against six smell types via percentile-weighted composites with a small-N z-score fallback. Source lives under `src/architecture/`.

See `docs/requirements.md` for the full spec (Part A = complexity, Part B = duplication) and `docs/plans/architecture-subcommand.md` for the architecture design. Duplication algorithm internals live under `docs/dedup/algorithms/` and mirror the pipeline stages in `src/duplication/`.

## Duplication maintenance notes

- **Module layout mirrors the pipeline.** `src/duplication/{diff,indexer,features,index_,search,scoring,report,cli}/` map to the 7-stage pipeline. The trailing underscore in `index_/` is intentional — Node's loader treats `index.ts` specially when adjacent to `index/`, and the underscore avoids the collision.
- **Determinism is a hard invariant.** Same input ⇒ bit-identical output, including ordering of groups, members, and evidence keys. If you add a new feature kind, sort it through every aggregation seam.
- **Strip-only TS execution.** The repo runs under Node 24+ with type stripping (`pnpm start`). `tools/check-strip-only.ts` imports `src/cli.ts`, which transitively pulls in every duplication module, so strip-only violations (`enum`, `namespace`, parameter properties) surface as a single check. Runs in `pre-commit`.
- **`perfLog` must stay zero-cost when disabled.** The pipeline only allocates timing events / hot-path measurements when `--phase-timings` is set; do not add unconditional `performance.now()` calls.
- **Recall over precision.** Search is a union over feature kinds; final reporting is OR-gated. When in doubt about a tradeoff, bias toward false positives — the downstream agent decides.

## CLI flag conventions

- **Keep `comp`, `dup`, and `arch` flag surfaces in sync.** When adding, removing, or renaming a flag on any subcommand, look at the others and decide explicitly: mirror it, document a justified asymmetry, or align the spelling. All three are wired through `commander`: `comp` is registered inline in `src/cli.ts`, `dup` lives in `src/duplication/cli/registerCommand.ts` (`addDuplicationCommand`), and `arch` lives in `src/architecture/cli/registerCommand.ts` (`addArchitectureCommand`); all three are mounted on the same root program. Option configurations are written separately, so drift is silent — the discipline lives in review, not in types. Justified structural asymmetries today:
  - `--diff` semantics — `comp` and `arch` both treat it as a display filter (rankings still computed against the full ref); `dup` instead defines the comparison's base/head sides at build time.
  - `--ref` — `dup` and `arch` build the analysis at a specific commit; `comp` reads the working tree.
  - `--metrics` / `--file` — `comp`-only. Single-file drill-down doesn't map to a pairwise metric (`dup`) or a graph node (`arch`).
  - `--phase-timings` — `dup` and `arch` only (pipeline diagnostic).
  - `--include-tests` — `arch`-only. Test edges distort fan-in/fan-out far more than they distort per-function complexity or per-fragment duplication.
  - `--no-include-types` — `arch`-only. Type-only edges have a meaningful but lower weight than runtime edges; arch surfaces a toggle so users can drop them entirely.
  - `--churn-window` / `--churn-ref` / `--no-churn` — `comp` and `dup` only. `arch` deliberately omits churn integration in v1; folding it in is a follow-up plan tracked under "Deferred" in `docs/plans/architecture-subcommand.md`.

  Anything else should match.

## Development workflow

- **Commits and pushes are autonomous.** Decide when to commit and push on each turn without waiting for the user to ask. The user will not give commit instructions. Commit autonomously even for changes that did not originate in the current session (e.g. uncommitted edits already on disk).
- **Do not report commits or pushes.** The user is not interested in commit/push activity. Skip mentioning them in turn summaries or status updates.
- **Keep commit messages short.** One concise line, no body unless absolutely necessary.
- **Write tests alongside code.** Whenever you add or change behavior, add or update tests for it and run them in the same turn to verify the code you just wrote. Do not defer verification. Default to `pnpm test:related` (Vitest `--changed`, runs only tests reachable from uncommitted changes via the static import graph) — this is safe here because every "e2e" test invokes the CLI in-process via direct imports, so Vitest's dependency tracking covers them. Fall back to the full `pnpm test` when (a) the change touches Vitest config, the shared parser (`src/parser/parseSource.ts`), or other roots whose blast radius is hard to bound, or (b) the user explicitly asks for the full suite.
- **Do not run `pnpm format` manually before committing.** The pre-commit hook runs `biome check --write` and `oxlint --fix` via lint-staged, so formatting is applied automatically on commit. Running it explicitly is redundant.

## User-facing docs (README etc.)

When updating user-facing docs, the task is "write the doc as it should read today", not "document the change". Apply these rules:

- **Write for a first-time reader.** They have no idea what changed, and don't care. Describe current behavior, not deltas.
- **No internal jargon.** Milestone names (M7, M8, ...), ticket IDs, and "breaking change" banners do not belong in user docs — they belong in commit messages and `docs/plans/`.
- **Prefer rewriting over appending.** If a section no longer fits, restructure it. Adding a new section for every change is how docs bloat.
- **Keep scale proportional.** If you add N lines, consider whether N lines elsewhere should shrink. Don't let a small behavior change double the doc.
- **Self-check before finishing.** Re-read the final doc cold, as someone who never saw the diff. If anything reads as "here's what's new", rewrite it.
