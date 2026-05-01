# Replace `unstable_edge_flag` with continuous `unstable_edge_ratio_pct`

## Context

The `unstable_dependency_candidate` smell is the dominant false-positive driver in `arch` output. On this repository (171 nodes), 5 of the top 20 hotspots are flagged primarily as `unstable_dependency_candidate`, all driven by `unstable_edge_flag = 1`.

Why it misfires:

1. `unstable_edge_flag` is binary — `unstableEdgeCount > 0 ? 1 : 0` (`score.ts:117`). Any node with even one outgoing SDP-violating edge gets the full axis value.
2. The smell's weight table assigns `0.6` to that flag, so the binary signal contributes a constant `0.6` to the composite. The companion axis `instability_delta_pct` (`0.4`) needs only a top-percentile value to push composite over the `0.85` threshold.
3. In a sparse population, the percentile of `instability_delta_pct` collapses: `buildJsonReport` has an absolute delta of `0.011` (1.1%) yet sits at percentile `0.988` because only seven nodes have any non-zero delta at all.

Net effect: tiny utilities (`countMatches`, 13 LOC, fan = 4/3) and pipeline orchestrators alike peg at composite `1.0` purely from "this node has at least one unstable outgoing edge".

`instability.ts` already computes a continuous companion: `unstableEdgeRatio = unstableEdgeCount / fanOut`. It is unused.

## Approach

Replace the binary `unstable_edge_flag` axis with a percentile-ranked `unstable_edge_ratio_pct` axis backed by `NodeMetrics.unstableEdgeRatio`. The smell's weight split (`0.6` / `0.4`) and overall shape are preserved — only the first axis changes from a 0/1 flag into a continuous percentile.

This converts the smell from "did any unstable edge exist?" (true for ~30% of nodes in a typical repo) into "what fraction of this node's outgoing edges violate SDP, ranked against the population?" (true tail signal). A node with 1/15 unstable edges scores far below a node with 8/9.

The `suppress_flag` axis remains a flag (it is a config-driven boolean by design); only `unstable_edge_flag` migrates. The flag handling code path in `score.ts` therefore stays alive — it just has one consumer instead of two.

## Per-file breakdown

1. **`src/architecture/ranking/types.ts`**
   - Rename `unstable_edge_flag` → `unstable_edge_ratio_pct` in `AxisId`.
   - Change its entry in `AXIS_KIND` from `"flag"` to `"percentile"`.

2. **`src/architecture/scoring/score.ts`**
   - In `readAxisValue`, replace the `unstable_edge_flag` case with `unstable_edge_ratio_pct` returning `node.unstableEdgeRatio`.
   - Add `"unstable_edge_ratio_pct"` to `PERCENTILE_AXES` so a per-axis percentile lookup is built.
   - The flag-handling branch in the scoring loop is unchanged — `suppress_flag` continues to use it.
   - **Zero-guard for percentile axes (added during implementation):** before invoking the percentile lookup, short-circuit `raw === 0` to contribute `0` and skip the lookup. The lookup uses last-occurrence rank for tied blocks (`percentile = lastRankOfTie / N`), which inflates the percentile of a 0 value when most of the population is also 0 — exactly the shape of `unstableEdgeRatio` and `instabilityDelta` distributions on a 503-component graph. Without this guard, removing the binary flag exposed eight phantom hits (`ratio=0, delta=0`, composite ≈ 0.985). The binary `unstable_edge_flag` had been incidentally masking this percentile-lookup pathology by gating on `count > 0`. The guard generalizes the fix across every percentile axis: a node with `fanIn=0` should not contribute to `architectural_hub`, etc.

3. **`src/architecture/scoring/weights.ts`**
   - Update `unstable_dependency_candidate` weights: rename the key from `unstable_edge_flag` to `unstable_edge_ratio_pct`. Keep `0.6` / `0.4` split.

4. **`src/architecture/scoring/score.test.ts`**
   - Rewrite the "unstable_edge_flag contributes raw 0/1" test as "unstable_edge_ratio_pct ranks by percentile". A node with `unstableEdgeCount=3, fanOut=3` (ratio 1.0) tops the population and clears the smell threshold; a node with `unstableEdgeCount=1, fanOut=10` (ratio 0.1) does not, given a population of zeros.
   - Touch any test referencing `unstable_edge_flag` by name to use the new axis id.

5. **`docs/plans/architecture-subcommand.md`**
   - Update the weight table line `unstable_edge_flag    0.60` → `unstable_edge_ratio_pct  0.60`. No prose changes elsewhere — the smell name and `0.4 instability_delta_pct` companion stay.

6. **`docs/plans/arch-exclude-pure-types.md`**
   - The "out of scope" footnote that defers the rework can stay as historical record (do not rewrite history); no edit required.

## Verification

- `pnpm test:related` covers `score.test.ts` and `instability.test.ts`.
- Re-run `pnpm start arch` against this repository. Expected outcome: `unstable_dependency_candidate` either drops out of the top hits entirely or remains only on nodes whose ratio + delta both place them in the genuine tail (likely 0–2 hits, down from 5).
- The CLI orchestrator false positives (`runDetector`, `runPipeline`, `buildJsonReport`) are not addressed by this change — those are driven by `bridge_component` / `high_fanout_component`. Treat them in a follow-up.

## Verified outcome

Re-ran `pnpm start arch` against this repository (171 source files, 503 components, 169 candidates):

- `unstable_dependency_candidate` primary hits: `5` → `4`. The four survivors all have non-zero ratio AND non-zero delta (so they are signal-bearing rather than ranking artefacts).
- Eight `ratio=0, delta=0` phantom hits introduced by the ratio swap were eliminated by the zero-guard.
- Top 20 distribution shifted from `{bridge: 6, fanout: 9, unstable: 5}` to `{bridge: 7, fanout: 9, unstable: 4}`. The remaining bridge / fanout false positives are CLI orchestrators (`runDetector`, `runPipeline`) — out of scope for this change.

## Out of scope

- **Absolute floor on `instability_delta_pct`.** The bottom two unstable hits still have very small absolute deltas (`0.083`, `0.024`). Tracked as a follow-up.
- **CLI orchestrator suppression.** `bridge_component` / `high_fanout_component` false positives on entry-point functions are a separate axis of work.
- **Removing the flag-handling branch entirely.** `suppress_flag` still consumes it.
