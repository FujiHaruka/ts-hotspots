# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

ts-dedup detects Type-3 duplication in TypeScript code: as a PR check (head side of a revision range vs. base side) or as a whole-repo audit. It is not a precise clone detector — it surfaces refactoring candidates with high recall and leaves the final judgment to downstream coding agents / reviewers. Target languages are `.ts` / `.tsx`.

See [docs/requirements.md](docs/requirements.md) for the spec and [docs/algorithms.md](docs/algorithms.md) (split into `docs/algorithms/01-…` through `08-…`) for the algorithmic details.

## Architecture

The detector is a one-way pipeline. Each stage is its own top-level dir under `src/`, wired together by `src/cli/runDetector.ts` (PR mode) and `src/cli/runWholeRepoDetector.ts` (whole-repo mode):

`diff` → `indexer` → `features` → `index_` → `search` → `scoring` → `report`

Things worth knowing before reading the code:

- The dir is `src/index_/` (trailing underscore) to avoid colliding with `index.ts` barrels — it holds the inverted index and the LSH/MinHash candidate generator.
- Base-side files are read from the git object store pinned to `baseSha`, not the worktree, so runs are bit-identical for an unchanged commit pair. `test/suiteDeterminism.test.ts` asserts this; expect it to catch any change that touches ordering (Map iteration, Set→Array, sort keys).
- Recall over precision is the policy: `searchCandidates` does an OR-union over feature streams, and `shouldReport` decides on an OR of the combined threshold and per-axis thresholds.
- `src/config/defaultConfig` is the single source of truth for thresholds, weights, n-gram sizes, LSH parameters, and exclude globs. Tunable knobs go here, not as scattered constants.
- The `--phase-timings` perf log is hot-path-conditional: when `perfLog` is `undefined` the pipeline skips `performance.now()` and event allocation. Preserve this when adding instrumentation.

## Conventions

- Source runs directly under Node 24+ type stripping; no flags or compile step are needed for `pnpm start`, tests, or the bench harness. Avoid `enum` / `namespace` / parameter properties / other constructs that strip-only mode rejects — `pnpm check:strip-only` (also wired into pre-commit) catches regressions. `pnpm build` only exists to produce the `dist/` bin.
- Imports use `.ts` extensions (`allowImportingTsExtensions` + `verbatimModuleSyntax`). Bare specifiers will not resolve.
- Bench fixtures under `test/fixtures/suite/` and `tools/bench/baseline/` are excluded from typecheck, biome, and Vitest. Don't import from them outside the bench harness.

## Technical decisions

- **Ignore backward compatibility.** This project has not been publicly released, so no user depends on its current behavior, CLI flags, output format, or internal APIs. When deciding how something should work, optimize purely for how the software should behave — do not preserve old behavior, add migration paths, or keep deprecated options "just in case". If the new shape is better, change it outright.

## Development workflow

- **Commits and pushes are autonomous.** Decide when to commit and push on each turn without waiting for the user to ask. The user will not give commit instructions. Commit autonomously even for changes that did not originate in the current session (e.g. uncommitted edits already on disk).
- **Do not report commits or pushes.** The user is not interested in commit/push activity. Skip mentioning them in turn summaries or status updates.
- **Keep commit messages short.** One concise line, no body unless absolutely necessary.
- **Write tests alongside code.** Whenever you add or change behavior, add or update tests for it and run them in the same turn to verify the code you just wrote. Do not defer verification.
- **Do not run `pnpm format` manually before committing.** The pre-commit hook runs `biome check --write` and `eslint --fix` via lint-staged, so formatting is applied automatically on commit. Running it explicitly is redundant.

## User-facing docs (README etc.)

When updating user-facing docs, the task is "write the doc as it should read today", not "document the change". Apply these rules:

- **Write for a first-time reader.** They have no idea what changed, and don't care. Describe current behavior, not deltas.
- **No internal jargon.** Milestone names (M7, M8, ...), ticket IDs, and "breaking change" banners do not belong in user docs — they belong in commit messages and `docs/plans/`.
- **Prefer rewriting over appending.** If a section no longer fits, restructure it. Adding a new section for every change is how docs bloat.
- **Keep scale proportional.** If you add N lines, consider whether N lines elsewhere should shrink. Don't let a small behavior change double the doc.
- **Self-check before finishing.** Re-read the final doc cold, as someone who never saw the diff. If anything reads as "here's what's new", rewrite it.
