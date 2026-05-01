# Absolute noise floor on `instability_delta_pct`

## Context

After replacing the binary `unstable_edge_flag` with the continuous `unstable_edge_ratio_pct` and adding the per-axis raw-zero short-circuit, four `unstable_dependency_candidate` hits remain on this repository. Their `instabilityDelta` values are `[0.238, 0.111, 0.083, 0.024]`. The bottom two are borderline / noise:

- `0.024` (`src/duplication/diff/pipeline.ts:26`) — a 2.4-percentage-point gap between source and target instability is below the resolution at which "violates SDP" carries any structural signal. Its percentile (`0.990`) only inflates that high because the population of non-zero deltas is sparse.
- `0.083` (`src/duplication/features/extractFeatures.ts:26`) — borderline. An 8.3-pp gap is small but argueably real.

The percentile-of-zero pathology was fixed in the previous iteration; what remains is a **percentile-of-tiny-positive** pathology. The percentile lookup correctly distinguishes a `0.024` from the zeros below, but a percentile of `0.99` based on the 0.024 over zeros below it is not a meaningful "this node is exceptionally unstable" signal — it just reflects "this node is *one of the few* that has any non-zero delta".

## Approach

Add a **per-axis raw noise floor** that the score function consults before invoking the percentile lookup. When `raw <= floor[axis]`, the axis contributes `0` (same shape as the existing raw-zero short-circuit). The default floor is `0`, so all other axes preserve current behavior.

Set `instability_delta_pct → 0.05`: a node whose worst SDP-violating outgoing edge differs by less than 5 percentage points in instability is treated as having no signal on this axis. This kills the smallest-delta tail without affecting genuine violations (the literature treats SDP violations as binary at the edge level; the 5-pp floor is only a "noise vs. signal" cutoff for ranking purposes).

The floor lives in `ranking/types.ts` as a record next to `AXIS_KIND` so it's visible alongside the axis catalogue. The score loop reads it and short-circuits — same shape as the existing `raw === 0` guard, generalized to `raw <= floor`.

## Per-file breakdown

1. **`src/architecture/ranking/types.ts`**
   - Export `AXIS_NOISE_FLOOR: Readonly<Record<AxisId, number>>` defaulting all axes to `0`. Set `instability_delta_pct: 0.05`. Add a brief docstring on the record explaining "raw values at or below this floor are treated as no signal".

2. **`src/architecture/scoring/score.ts`**
   - Replace the `if (raw === 0)` short-circuit with `if (raw <= floor)` where `floor = AXIS_NOISE_FLOOR[axis]`. The semantics for axes with `floor = 0` are unchanged (raw `0` still triggers).
   - Import `AXIS_NOISE_FLOOR` from `../ranking/types.ts`.

3. **`src/architecture/scoring/score.test.ts`**
   - Add: a node with `unstableEdgeRatio = 1` (top of population) and `instabilityDelta = 0.03` (below floor) does **not** fire `unstable_dependency_candidate`. With ratio at percentile `1.0` and delta zeroed by the floor, composite is `0.6 * 1 + 0.4 * 0 = 0.6`, below the `0.85` threshold.
   - Add: a node with `instabilityDelta = 0.05` exactly is treated as no signal (boundary check on `<=`).
   - Add: a node with `instabilityDelta = 0.06` (just above floor) still contributes its percentile.

## Verification

- `pnpm test:related` — 102 tests pass.
- Re-ran `pnpm start arch`:
  - `unstable_dependency_candidate` primary hits: `4` → `3`. The dropped hit is `src/duplication/diff/pipeline.ts:26` (delta `0.024`, the noise case).
  - Surviving hits: `countingCollector.ts:6` (ratio 0.333, delta 0.238), `countingCollector.ts:26` (ratio 0.500, delta 0.111), `extractFeatures.ts:26` (ratio 0.222, delta 0.083). All have delta well above the floor.
  - The dropped `pipeline.ts` candidate did not disappear from the report — it now ranks 15th as `bridge_component` (composite 0.976), which is a more accurate categorization given its `fanOut=5, fanIn=1` shape.
  - Top-20 distribution shifted from `{bridge: 7, fanout: 9, unstable: 4}` to `{bridge: 9, fanout: 8, unstable: 3}`.

## Out of scope

- **Floor on other axes.** Most axes (`fan_in_pct`, `fan_out_pct`, ...) have meaningful semantics at small positive values — a 1-edge fan-in is a real if small signal, not noise. Only `instability_delta_pct` measures a "magnitude of violation" where small positives are below the resolution of the underlying instability metric (which is itself a ratio with quantization noise on small graphs).
- **Tuning the `0.05` constant.** Picked from inspecting this repository's distribution. Could be revisited when running on larger codebases, but no current reason to expose it as a config knob.
- **CLI orchestrator suppression.** Still the dominant remaining false-positive cluster, tracked separately.
