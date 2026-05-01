# Refactor `runFunctions` (src/cli.ts:612-810)

## Context

`runFunctions` is the handler for `ts-hotspots complexity`. It currently spans
199 SLOC with cognitive complexity 40 and 44 callees. Three things drive the
size:

1. A pre-stream validation block wrapped in its own `try/catch` (635–659),
   needed because once we emit the markdown preamble we cannot fall back to
   the pre-error preamble. The comment on 631–634 documents this constraint.
2. Three terminal output paths inside the main `try`: `--file` early return
   (671–686), `--verbose` report (755–779), default report (782–792). Each
   builds a `FunctionReport` with overlapping but slightly different field
   sets.
3. A repeated "append optional fields" tail on the verbose and default
   branches (`if (dismissed) ...; if (prScope) ...; if (prNotice) ...`).

The pipeline in the middle (rank → filter axes → compute meta/co-occurrence →
candidates → dismissal → PR scope → slice) is straight-line and reads fine.
The complexity is concentrated in **input validation** and **output
assembly**, not in the analysis itself.

## Approach

Extract two seam-aligned helpers and one tiny mutator, leaving the analysis
pipeline inline. The goal is to shrink `runFunctions` to a readable
top-to-bottom narrative without spreading state across many new files.

- **`validateFunctionCliInputs(positional, options)`** — pure synchronous
  helper returning `{ rootDir, functionAxes }`, throwing `InvalidArgsError`
  on bad input. Lifts lines 635–649 into a function the caller wraps in the
  existing pre-stream `try/catch`. The caller keeps the preamble-timing
  comment so the constraint stays visible at the streaming boundary.
- **`buildFunctionReport(...)`** — produces the `FunctionReport` for both
  default and verbose modes. Takes `{ projectInfo, hotspots, displayedRankings,
  functionAxisMeta, displayedCoOccurrence, functions, verbose }` and decides
  slim-vs-full project + which optional fields to populate. Replaces both
  the verbose block (757–779) and the default block (782–792). The
  verbose-only `functions` filter (using `collectFunctionRefKeys`) moves
  inside.
- **`applyOptionalReportFields(report, { dismissed, prScope, prNotice })`**
  — small mutator that conditionally sets `report.dismissed`, `report.pr`,
  `report.notice`. Used by both `buildFunctionReport` and the `--file`
  early-return path (which currently sets none of these, but the helper
  is a no-op there).

`--file` mode (671–686) stays inline. It is 16 lines, doesn't share the
ranking pipeline, and extracting it would obscure the early return.

The error-handling `catch` block (793–808) stays as is — it is already a
single sink for the streaming-aware error rendering.

After the refactor, `runFunctions` reads as: validate → preamble → prepare →
file-mode early return → run pipeline → resolve PR scope → build report →
write. Cognitive complexity drops because the two output branches collapse
into one helper call and the optional-field accumulation disappears from the
caller.

## Per-file changes

### `src/cli.ts`

1. Add `validateFunctionCliInputs(positional, options)` near the existing
   helpers (around line 415). Returns `{ rootDir: string; functionAxes:
   FunctionAxisId[] | undefined }`. Throws `InvalidArgsError` for the four
   conditions currently inside the pre-stream try.

2. Add `buildFunctionReport({ projectInfo, hotspots, rankings, axisMeta,
   coOccurrence, functions, verbose })` returning `FunctionReport`. Inlines
   the `slimProject` choice and the `collectFunctionRefKeys` filter for the
   verbose path.

3. Add `applyOptionalReportFields(report, { dismissed, prScope, prNotice })`
   — three `if`-guards, mutates in place.

4. In `runFunctions`:
   - Replace lines 635–649 with `const { rootDir: _, functionAxes: parsedAxes
     } = validateFunctionCliInputs(positional, options); functionAxes =
     parsedAxes;` (kept inside the pre-stream try; rootDir is recomputed
     inside `prepare`, so we just discard it here — or have `prepare` accept
     a pre-resolved rootDir if cleaner).
   - Replace lines 755–792 with a single `buildFunctionReport(...)` call
     followed by `applyOptionalReportFields(...)` and the existing `writeOk`
     / `writeStatsLine` / `return 0` tail.

### Tests

`runFunctions` is exercised by `src/cli.test.ts` (and possibly integration
tests). The refactor is behavior-preserving — same JSON/markdown output for
the same inputs — so the existing suite should pass unchanged. Run:

```
pnpm test
```

If any snapshot drifts, that is a real behavioral regression and needs
investigation, not a snapshot update.

## Out of scope

- Touching `runDetector` (next on the hotspot list, but separate function with
  its own pipeline shape). If this refactor lands cleanly, the same shape
  may apply there as a follow-up.
- Removing the dual try/catch. The pre-stream try is load-bearing for
  preamble timing and the comment on 631–634 documents why.
- Changing the report schema or any user-facing output.
