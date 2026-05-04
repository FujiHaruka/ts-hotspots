# ts-dedup fixture suite

25 scenarios (20 positive + 5 negative) exercised by `pnpm bench`. Each
subdirectory contains:

- `base/` — the snapshot of the codebase before the change.
- `head/` — the snapshot after the change.
- `expected.json` — ground truth (positives / negatives).
- `README.md` — one-line intent.

The harness materialises `base/` as commit 1 and `head/` as commit 2 in a temp
repo, then runs `runDetector` with `baseRef=commit1`, `headRef=commit2`.

## Scenarios

| ID | name | tags |
|----|------|------|
| 001 | exact-fn-copy | type-1, function, cross-file |
| 002 | exact-block-copy | type-1, block, cross-file |
| 003 | renamed-args | type-2, function, rename |
| 004 | renamed-locals | type-2, function, rename |
| 005 | renamed-literals | type-2, function, literal |
| 006 | renamed-fn-and-args | type-2, function, rename |
| 007 | method-vs-function | type-2, function, method |
| 008 | extra-log-stmt | type-3, function |
| 009 | removed-validation-stmt | type-3, function |
| 010 | reordered-independent | type-3, function |
| 011 | extra-early-return | type-3, function |
| 012 | extract-fn-candidate | type-3, window, refactoring |
| 013 | window-in-larger-fn | type-3, window, cross-granularity |
| 014 | block-in-different-fn | type-3, block, cross-granularity |
| 015 | same-file-near-twins | type-2, function, same-file |
| 016 | async-await-call-pattern | type-2, function, async |
| 017 | tsx-component-copy | type-1, function, tsx |
| 018 | tsx-render-helper | type-2, function, tsx |
| 019 | template-literal-heavy | type-3, function, template-literal |
| 020 | generics-annotations | type-2, function, generics |
| 021 | neg-shared-domain | negative, function |
| 022 | neg-boilerplate-only | negative, function |
| 023 | neg-tiny-fragments | negative, function, small |
| 024 | neg-different-async-styles | negative, function, async |
| 025 | neg-trivial-getters | negative, function, small |
