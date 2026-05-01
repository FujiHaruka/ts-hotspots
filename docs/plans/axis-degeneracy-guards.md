# Axis-degeneracy guards for the candidate gate

> Status: Shipped (2026-05-01)
> Scope: complexity (`comp`) only. No changes to `dup`.
>
> Implementation note: M1+M2+M3 shipped. The Acceptance bullet predicting that `listBaseSources` / `collectDiff` would drop conflicts with the Approach section's own statement that the 5% threshold "lets awaitCount at 31/613=5.1% just barely through". The implementation follows the Approach: awaitCount passes the sparsity guard at 31/615=5.04%, so awaitCount-only rescues stay; tryCatchCount at 20/615=3.25% is gated out. `commitCount` is stripped from every candidate's `metrics` block as predicted.

## Context

Dogfooding `comp` against this repo (130 files / 613 functions / 18 candidates) surfaced three axis-meta-driven false-positive patterns. The candidate-gate logic in `src/aggregator/rank.ts` does not currently account for them:

1. **Sparse-axis rescue noise.** `awaitCount` has nonZero=31/613 (~5%) and a top-N cutoff at value=3. The rescue gate (`topNSpread > 0 ∧ uniqueTopNValues > 1`) passes, so I/O-glue functions like `listBaseSources` (await=3) and `collectDiff` (await=3) get rescued with effectively zero discriminative power. Same risk applies to `tryCatchCount` (nonZero=20).
2. **Degenerate axes leaking into co-occurrence.** `commitCount` on this run has `topNSpread=0`, `uniqueTopNValues=1` — every top-N entry ties at 15. The rescue path already guards against this. The **co-occurrence path does not**: `commitCount` is added to `entry.axes` by `computeFunctionCoOccurrence` whenever the ref appears in any top-N (it does, since 10+ functions tie at 15), and counts toward the `axisHitCount ≥ 3` gate. It then surfaces in the candidate's `metrics` block. Result: `buildCli` is gated in partly because of a meaningless `commitCount: 15` hit, and an agent reading the metrics block reads `commitCount: 15` as evidence of churn pressure when it is in fact a tie value shared by every function in the file.
3. **Accumulator-loop mutation saturation.** `globToRegExp` has `mutationSiteCount=13` from a `let out = "..."; while (...) { out += ... }` builder. The metric is structurally inflated by an idiomatic accumulator and is not signal. No metric-side fix; this is a documentation gap.

(1) and (2) both stem from "axis distribution inhomogeneity is observable in `axisMeta` but not used uniformly when gating." (3) is documentation only.

## Approach

Introduce a single `isDegenerateAxis(meta)` predicate and a population-ratio guard, then apply them at every gate seam:

- **Define degeneracy once.** `isDegenerateAxis(meta) = meta.topNSpread <= 0 || meta.uniqueTopNValues <= 1`. This is the existing rescue-gate condition lifted into a named helper. Applies to any axis (quality or leverage).
- **Add a population guard for rescue.** A new constant `HOTSPOT_RESCUE_MIN_NON_ZERO_RATIO = 0.05` — quality axes with non-zero in <5% of functions are treated as too sparse to support a single-axis rescue. The threshold is conservative (it lets `awaitCount` at 31/613=5.1% just barely through and excludes `tryCatchCount` at 20/613=3.3%); locking it tighter is a follow-up only if dogfooding shows still-noisy output.
- **Apply degeneracy / sparsity at every gate seam, not just rescue.** Today only `accumulateHits` rescue-loop checks `topNSpread`/`uniqueTopNValues`. Co-occurrence loop and the `metrics` populator both ignore axisMeta. The fix is to filter `entry.axes` against `isDegenerateAxis(axisMeta[axis])` in the co-occurrence path, recompute `axisHitCount` from the filtered set, and skip the entry if the filtered count drops below 3 or no quality axis survives. The `metrics` populator in `rankCandidates` skips degenerate axes when copying values.
- **Update the spec.** §6.1 of `docs/requirements.md` currently allows degenerate axes to count toward the co-occurrence gate. The change requires an explicit spec edit so the new behavior is the documented contract.
- **Document accumulator-loop saturation as a known structural FP** in `docs/dogfooding-prompt.md`. No code change.

The changes are layered so each milestone is independently shippable and testable. M1 (helpers + co-occurrence path) is the load-bearing one; M2 (rescue population guard) is a small additional condition; M3 (docs) is text-only.

## Per-file changes

### M1 — Degeneracy filter on the co-occurrence path

Goal: a degenerate axis cannot inflate `axisHitCount` and cannot appear in the displayed `metrics`.

#### `src/aggregator/rank.ts`

1. Add a small helper near `isQualityAxis`:
   ```ts
   const isDegenerateAxis = (meta: AxisMeta): boolean =>
     meta.topNSpread <= 0 || meta.uniqueTopNValues <= 1;
   ```

2. In `accumulateHits`, change the co-occurrence loop:
   - Before: iterate `entry.axes`, gated by `entry.axisHitCount >= 3` and `entry.axes.some(isQualityAxis)`.
   - After: compute `liveAxes = entry.axes.filter(a => !isDegenerateAxis(axisMeta[a]))` once. Skip the entry if `liveAxes.length < HOTSPOT_CO_OCCURRENCE_MIN_AXES` or no quality axis remains in `liveAxes`. Then `for (const axis of liveAxes) addHit(entry.ref, axis)`.
   - The rescue loop already checks the same predicate inline; replace the inline check with `if (isDegenerateAxis(axisMeta[axis])) continue;` for symmetry.

3. In `rankCandidates`, when populating `metrics` from `orderedAxes`, skip degenerate axes:
   ```ts
   for (const axis of orderedAxes) {
     if (isDegenerateAxis(axisMeta[axis])) continue;
     for (const key of functionAxisMetricKeys[axis]) { ... }
   }
   ```
   This requires threading `axisMeta` into `rankCandidates` (currently it only receives `rankings`). Update `computeFunctionHotspotCandidates` to pass it through.

   Note on `pickPrimaryAxis`: `orderedAxes` already excludes degenerate axes after step 2 (because they aren't added to `acc.axes`). So no change needed in `pickPrimaryAxis`.

#### `src/aggregator/rank.test.ts`

Add tests covering:
- A function whose axes set is `{sloc, calleeCount, commitCount}` with `commitCount` degenerate — expected: not gated in (axisHitCount falls to 2).
- A function whose axes set is `{cognitiveComplexity, sloc, calleeCount, commitCount}` with `commitCount` degenerate — expected: gated in but `metrics` does not include `commitCount`.
- A function whose only hit is a degenerate quality axis — not rescued.
- Existing fixture-based snapshots: regenerate; expect `commitCount` to disappear from `metrics` blocks where it appeared as a degenerate tie.

#### `docs/requirements.md`

Edit §6.1 candidate gate:

- Co-occurrence gate: change "the set of axes F hit has size ≥ 3" to "the set of **non-degenerate** axes F hit has size ≥ 3", and add a footnote/inline definition: "Degenerate = `topNSpread = 0 ∨ uniqueTopNValues = 1` for that axis. Same predicate that already gates discriminative rescue."
- Add a one-line note that the same filter applies when populating the displayed `metrics` block.

### M2 — Population guard on the rescue net

Goal: rescue does not fire on an axis where the population is too sparse for the top-3 cutoff to discriminate.

#### `src/aggregator/rank.ts`

1. Add constant:
   ```ts
   const HOTSPOT_RESCUE_MIN_NON_ZERO_RATIO = 0.05;
   ```

2. Thread `totalFunctions` into `accumulateHits` (`computeFunctionHotspotCandidates` already has `entries.length`). In the rescue loop, after the degeneracy check:
   ```ts
   if (meta.nonZeroCount / totalFunctions < HOTSPOT_RESCUE_MIN_NON_ZERO_RATIO) continue;
   ```
   Skipping when `totalFunctions === 0` is moot — the loop has nothing to rank anyway.

3. Co-occurrence path is **not** subject to this guard. Co-occurrence already requires ≥3 axes to align; sparsity in any one axis is fine if the others are dense.

#### `src/aggregator/rank.test.ts`

Add tests:
- An axis with `nonZeroCount=2` out of 100 functions: top-3 entries are not rescued even if non-degenerate.
- An axis with `nonZeroCount=10` out of 100 functions: top-3 entries are rescued.

#### `docs/requirements.md`

Edit §6.1 rescue clause: append "and the axis is not too sparse — its non-zero count covers at least 5% of measured functions". Note that the threshold is fixed (no flag in v1).

### M3 — Document accumulator-loop saturation

Goal: future dogfooding triages can name this pattern without re-deriving it.

#### `docs/dogfooding-prompt.md`

In the "Validate `hotspots` against real code" section, in the structural-FP bullet, add an example: "accumulator-loop saturation — `let out = ""; while (...) { out += ... }` patterns inflate `mutationSiteCount` without indicating mutable state spread."

#### `docs/requirements.md`

Optional: a one-line note at §5.1 next to `mutationSiteCount`'s definition, e.g. "Note: idiomatic accumulator loops inflate this axis without indicating shared mutable state — known structural FP, triaged at the agent layer." Borderline editorializing; include only if the maintainer wants it in the spec.

## Acceptance

- M1 + M2: re-running `node src/index.ts comp .` against this repo should:
  - Drop `commitCount: 15` entries from every candidate's `metrics` block (currently appears on `buildCli`).
  - Drop `listBaseSources` and `collectDiff` from the candidate set (rescued only on `awaitCount` which is now sparsity-gated).
  - Keep all other 14–15 candidates intact.
- All existing tests pass after fixture regeneration. No behavior change on non-degenerate, non-sparse axes.

## Non-goals

- No new axes.
- No changes to `dup`.
- No CLI flag for the population threshold. Keep thresholds hardcoded per the v1 spec ("Candidate gates and top-N thresholds are hardcoded").
- No automatic detection of accumulator loops at the AST level. Triage stays at the agent layer.
- No change to `commitCount`'s collector or definition. The fix is at the gate, not the metric.

## Risks

- **Population threshold is project-dependent.** 0.05 is a guess from one repo. If a downstream user's project has 60+ functions with await per 1000 functions, the rescue still fires and may be useful; if it has 50, it fires and might be noise. Acceptable to ship a fixed threshold and revisit after a second dogfooding session against an external project.
- **Spec-change visibility.** Existing consumers who relied on the `metrics` block including `commitCount` (unlikely but possible) will see the field disappear when degenerate. The schema does not promise its presence; this is consistent with the slim envelope's "only hit axes" rule.
