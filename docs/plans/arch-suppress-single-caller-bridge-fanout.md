# Suppress single-caller nodes from `bridge` and `fanout` smells

## Context

After A (continuous unstable-edge ratio) and B (delta noise floor), the dominant remaining false-positive cluster on this repository is CLI orchestrators / subsystem entry points being flagged as `bridge_component` or `high_fanout_component`. From the latest top 20:

| location                                      | smell    | fanOut | fanIn |
| --------------------------------------------- | -------- | ------ | ----- |
| `src/duplication/cli/main.ts:259 runPipeline` | bridge   | 15     | 1     |
| `src/duplication/cli/runDetector.ts:92`       | fanout   | 48     | 1     |
| `src/duplication/cli/runWholeRepoDetector.ts` | fanout   | 44     | 1     |
| `src/architecture/cli/main.ts:259 runPipeline`| bridge   | 18     | 1     |
| `src/architecture/graph/buildGraph.ts:48`     | fanout   | 16     | 1     |
| `src/cli.ts:942`                              | fanout   | 7      | 0     |
| `src/duplication/diff/pipeline.ts:26`         | bridge   | 5      | 1     |
| `src/architecture/metrics/computeMetrics.ts`  | bridge   | 8      | 1     |
| `tools/bench/formatMarkdown.ts:49`            | fanout   | 5      | 1     |

These all share `fanIn ≤ 1`: either nothing depends on them (top-level entry, `fanIn=0`) or a single upstream pipeline owns them (`fanIn=1`). Structurally:

- A `bridge_component` separates the graph into pieces when removed. With `fanIn ≤ 1`, removal only disconnects one upstream from a subtree — that's a function call, not a bridge.
- A `high_fanout_component` is "many things depend on this and it depends on too much, so changes here have wide blast radius". With `fanIn ≤ 1`, the blast radius from the fan-out side is owned by exactly one upstream caller — i.e. there is no architectural pressure, just a sequencing fact.

`arch`'s contract is "show coordinates worth restructuring". A single-caller pipeline entry is not a restructuring target; it is the shape the pipeline is supposed to have. Suppress these smells on `fanIn ≤ 1`.

## Approach

Add a smell-level structural gate inside the per-node scoring loop in `score()`: when evaluating a node for `bridge_component` or `high_fanout_component`, short-circuit (`continue`) if `node.fanInUnweighted <= 1`. The gate runs before the composite is computed, so the smell hit is never produced — same shape as a sub-threshold composite.

Other smells are not gated:

- `architectural_hub`, `high_impact_component`, `over_shared_component` already weight `fan_in_pct` heavily, so a fanIn ≤ 1 node naturally fails their threshold. The gate would be redundant.
- `unstable_dependency_candidate` is fanIn-agnostic by design — a node with no incoming dependencies can still depend on more-unstable downstream code, and that is exactly the SDP violation the smell tracks.

Why `fanInUnweighted` rather than `fanInWeighted`: the gate is about "how many distinct upstreams own this node", which is a count question. `fanInWeighted` mixes in edge-kind weights and would make the threshold edge-kind-dependent, which is the wrong shape for a structural invariant.

Why `≤ 1` rather than `< 1` (i.e. only fanIn=0): the false positives are dominated by single-caller pipeline entries (`fanIn=1`), not by zero-caller exports. Excluding only fanIn=0 misses the bulk of the cluster.

## Per-file breakdown

1. **`src/architecture/scoring/score.ts`**
   - At the top of the per-smell loop in `score()`, after looking up `smellWeights`, add the gate:
     ```ts
     if (
       (smell === "bridge_component" || smell === "high_fanout_component") &&
       node.fanInUnweighted <= 1
     ) {
       continue;
     }
     ```
   - Place before the inner axis loop so excluded smells do no work.

2. **`src/architecture/scoring/score.test.ts`**
   - Add: a node with `fanInUnweighted=1, fanOutWeighted=100, betweenness=1` does **not** fire `bridge_component` or `high_fanout_component`.
   - Add: a node with `fanInUnweighted=2, fanOutWeighted=100` does fire `high_fanout_component` (boundary check).
   - Add: a node with `fanInUnweighted=0, unstableEdgeRatio=1, instabilityDelta=0.5` still fires `unstable_dependency_candidate` (the gate is smell-scoped, not node-scoped).
   - Update existing fixtures in tests where a node currently expects to fire `high_fanout_component` — set `fanInUnweighted: 2` so the gate does not interfere with the test's intent. Affected tests (by `describe` heading):
     - `score — small-N gate` — the "hub" node fixture
     - `score — composite` — hub fixture
     - `score — flag axes` (`suppress_flag` test) — A fixture (over_shared smell, but uses fan_out)
     - `score — secondary smells` — hub fixture
     - `score — excludedNodeIds` — A and B fixtures
     - `score — determinism` — outlier fixtures
     - `score — size_pct axis` — Big/Small/A fixtures
     - `score — zero-guard on percentile axes` — A fixture (the "all signals positive" case)

## Verification

- `pnpm test:related` — 102 tests pass (4 existing fixtures updated to declare `fanInUnweighted` ≥ 2; 4 new tests for the gate behavior).
- Re-ran `pnpm start arch`:
  - Eleven CLI orchestrators / single-caller pipeline entries dropped out of the top 20: `runPipeline` (dup + arch), `runDetector`, `runWholeRepoDetector`, `cli.ts`, `buildGraph`, `computeMetrics`, the inner `score`, `pipeline`, `formatMarkdown`, `scoreCandidate.ts:178`.
  - New entries surface real load-bearing components: `src/parser/parseSource.ts:17` (the shared TS parser used by all three subcommands — explicitly documented as the project's central reuse point in `CLAUDE.md`) ranks 19th as `high_impact_component` (fanIn=10, fanOut=0); `src/util/git/runner.ts:17` 20th (fanIn=6, fanOut=0); `src/dismissal/store.ts:44` (fanIn=3) as a `bridge_component`.
  - Top-20 distribution shifted from `{bridge: 9, fanout: 8, unstable: 3}` to `{bridge: 11, fanout: 3, unstable: 3, impact: 3}`. The smell mix now reflects multi-caller structural pressure rather than CLI plumbing.

## Out of scope

- **Higher fanIn thresholds (≤ 2, ≤ 3).** Could be revisited if multi-caller pipeline entries surface as false positives, but no current evidence.
- **Gating `architectural_hub` / `high_impact_component`.** Their existing fan_in weight already filters fanIn ≤ 1 by virtue of the percentile threshold. Adding an explicit gate would be redundant.
- **Generalizing the gate as configurable per-smell axis minima.** YAGNI — one rule, two smells, no current second use case.
