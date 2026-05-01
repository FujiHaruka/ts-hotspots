# Size-aware ranking for `arch` candidates

## Context

`ts-hotspots arch` currently false-positives heavily. Many top-N hotspots
are tiny components — one-line `export const`s, 3-line type guards, 5-line
helper functions — that landed in the candidate pool because their
fan-in / fan-out percentiles were high. Percentile rank is computed over
the full population of exports, so when the median export has fan-in 0
or 1, a 5-line utility with fan-in 3 is already at the 90th percentile.
The math is correct; the interpretation is the problem.

Architecturally, a small popular helper is not a refactor target. The
agent-facing contract is "where should I read first?" and a 5-line
utility takes 30 seconds to understand — pointing the agent there wastes
a slot. The signal we want is **components whose architectural role
*and* internal substance both warrant attention**: hubs that are big,
fan-out monsters that are big, bridges that are big. Size isn't a
direct smell axis, but it's a strong gate against the noise-floor of
"popular tiny utilities".

The pure-type exclusion in `src/architecture/scoring/typeOnlyNodes.ts`
already addresses one slice of this (type-only contracts as candidates).
The remainder — runtime components that are simply too small to be
load-bearing — needs a separate fix.

Why size and not, say, complexity-per-LOC: comp already owns
per-function complexity, and arch's unit is the *exported component*,
not the function. The cheapest size signal that doesn't require a
parser-level metric pass is the line span of the export's declaration
node — already reachable from `LocalExport.declarationNode`.

## Approach

Two cooperating mechanisms, both gated through `score()`:

1. **Hard size floor (filter).** Drop components with `lineCount <
   SIZE_FLOOR_LINES` (default `10`) from the candidate pool. They keep
   contributing to per-axis percentile distributions — the `score()`
   function's existing `excludedNodeIds` mechanism already handles this
   "exclude from output but not from population" semantic, so we reuse
   it. Net effect: an `export const FOO = 1` can never be a candidate,
   regardless of how many places reference it.

2. **Size axis (additive percentile tiebreak).** Add `size_pct` as a
   new percentile axis — same machinery as `fan_in_pct` etc. — and add
   it to the four size-relevant smells with weights ~0.15, rebalancing
   the existing weights so each smell still sums to 1.0. Bridge and
   unstable-dependency are deliberately left untouched: a tiny shared
   utility being a bridge is a real signal (its size is what makes the
   bridge accidental), and instability is structural regardless of LOC.

Why both rather than one or the other:

- Floor alone is a binary cliff — a 9-line component fails, 10-line
  passes, with no smooth pressure on the ambiguous middle. Tuning the
  cutoff becomes the only knob.
- Axis alone can't reject extreme cases. A 5-line component with
  fan-in at the 99th percentile and fan-out at the 99th percentile
  would still clear the 0.85 composite gate even with a 0.15-weighted
  size axis at percentile 0.0 (composite = 0.85 × 0.99 + 0.15 × 0 ≈
  0.84). The math doesn't quite filter; it only re-orders.

The combination hands one knob to "obvious noise" (floor) and another
to "smooth pressure" (axis). Each does what it's good at.

`size` is `endLine - startLine + 1` of the declaration node — raw
source lines including blanks and comments. Cheaper signals (non-blank
lines, AST node count) are not worth their complexity here; the goal is
"is this big enough to matter", not "exactly how complex is it".

The composite gate (`composite ≥ 0.85`) and small-N z-score floor stay
unchanged. The hard floor + additive axis are layered in front,
preserving the existing ranking framework's invariants (composite ∈
`[0,1]`, deterministic ordering, recall-over-precision posture).

## Per-file breakdown

1. **Track size on `Component`** — `src/architecture/graph/types.ts`,
   `src/architecture/graph/extractExports.ts`,
   `src/architecture/graph/buildGraph.ts`
   - Add `endLine: number` to `Component` (1-based, inclusive).
   - In `extractExports.ts`, capture `endLine` for each `LocalExport`
     using the same `getLineAndCharacterOfPosition` call already used
     for `line`, but on `node.getEnd()` instead of `node.getStart()`.
   - In `buildGraph.ts`, propagate `endLine` from `LocalExport` into
     `Component`.
   - The serializer in `src/architecture/report/` does *not* need to
     surface `endLine` in the report schema — size is an internal
     ranking input. (Optional follow-up: expose `lineCount` in the
     verbose JSON for debuggability.)

2. **New axis `size_pct`** — `src/architecture/ranking/types.ts`,
   `src/architecture/scoring/score.ts`
   - Add `"size_pct"` to the `AxisId` union with `AXIS_KIND.size_pct =
     "percentile"`.
   - Extend `PERCENTILE_AXES` in `score.ts` to include `size_pct`.
   - Extend `readAxisValue` to compute `lineCount = endLine - startLine
     + 1`. The function currently takes a `NodeMetrics` only; it needs
     either a parallel lookup or an extension to receive the
     `Component` shape. Cheapest: pre-compute `lineCount` per node id
     into a `Map<string, number>` outside the hot loop and pass it
     through `ScoreOptions.lineCounts: ReadonlyMap<string, number>`.
     This keeps `score()` pure over its declared inputs (no `Graph`
     dependency leaking in) and matches the `excludedNodeIds` pattern
     already there.

3. **Hard size floor** — `src/architecture/scoring/score.ts`,
   `src/architecture/cli/main.ts`
   - Add `sizeFloorLines?: number` to `ScoreOptions` (default `10`).
   - In `runPipeline`, compute the small-component set:
     ```
     const tooSmall = new Set<string>();
     for (const node of graph.nodes) {
       if ((node.endLine - node.line + 1) < sizeFloor) tooSmall.add(node.id);
     }
     ```
     Union it with `collectTypeOnlyNodeIds(graph)` and pass the merged
     set as `excludedNodeIds`. The exclusion goes through the same gate
     that already drops type-only nodes — same population-preserving
     semantics, no new code path.
   - Document the default in CLAUDE.md (justified asymmetry: comp and
     dup don't have a size floor because their units already imply
     non-trivial size — comp scores a function body, dup scores a
     fragment of ≥ minTokens tokens).

4. **Rebalanced default weights** — `src/architecture/scoring/weights.ts`
   ```
   architectural_hub:
     fan_in_pct           0.35   (was 0.40)
     fan_out_pct          0.25   (was 0.30)
     reverse_closure_pct  0.25   (was 0.30)
     size_pct             0.15   (new)

   high_fanout_component:
     fan_out_pct          0.80   (was 1.00)
     size_pct             0.20   (new)

   high_impact_component:
     fan_in_pct           0.40   (was 0.50)
     reverse_closure_pct  0.35   (was 0.40)
     pagerank_pct         0.10   (unchanged)
     size_pct             0.15   (new)

   over_shared_component:
     fan_in_pct           0.35   (was 0.40)
     fan_out_pct          0.25   (was 0.30)
     suppress_flag        0.25   (was 0.30)
     size_pct             0.15   (new)

   bridge_component:                  unchanged
   unstable_dependency_candidate:     unchanged
   ```
   Each table still sums to 1.0 → composite stays in `[0,1]`, gate
   semantics unchanged. The 0.15–0.20 weight is small enough not to
   override genuine coupling signals, large enough to break ties
   between equally-coupled components in favor of the bigger one.

5. **CLI surface (deferred unless tuning fails).** No new flag in v1.
   `--size-floor <N>` could be added later if the default needs
   per-repo tuning, but mirroring the `--include-types` precedent
   (started flagless, added when needed), we ship with a fixed default
   and revisit only if real-repo runs disagree.

6. **Tests**
   - `src/architecture/scoring/score.test.ts` (extend):
     - A node below `sizeFloorLines` with otherwise top-percentile
       fan-in/out → not in candidates.
     - A node at the floor with the same metrics → in candidates,
       composite includes the `size_pct` contribution.
     - Two equal-coupling nodes with different sizes → bigger one
       ranked higher (tiebreak via `size_pct`).
     - Population preservation: excluding a high-size-pct node via the
       floor leaves the surviving nodes' percentiles unchanged.
   - `src/architecture/graph/extractExports.test.ts` (extend): assert
     `endLine` is captured for each export kind (function, class,
     const, default-export-of-expression, type, interface, enum).
   - `src/architecture/cli/main.test.ts` (golden snapshots): refresh
     after the weight rebalance. Document the snapshot churn in the
     commit message.

## Tradeoffs and rejected alternatives

- **Multiplicative damper (`composite × sizeFactor`).** Considered:
  apply a `[0.6, 1.0]` damper based on raw LOC. Rejected because the
  existing 0.85 gate sits very close to the 1.0 ceiling — even a
  modest 0.7 damper effectively makes any sub-median component
  unreachable, which over-corrects. The hard floor + additive axis
  achieves the same goal with simpler tuning.

- **Replacing fan-in/out with size-normalized variants** (e.g.
  fan-out per 100 LOC). Rejected because it inverts the bias: huge
  components with high fan-out look fine on a per-LOC basis, even
  though they're textbook hubs. The current axes plus a size gate
  preserve the "absolute coupling matters" intuition while filtering
  the small-component noise floor.

- **Configurable floor as the only mechanism.** Single binary cutoff;
  doesn't help the ambiguous middle (15–30 line components that are
  legitimately on the edge). The axis component is what handles those.

- **Counting non-blank source lines instead of total span.** Cheaper
  signal than AST node count, but adds a per-component scan and an
  off-by-one bug surface. Raw line span is good enough for the
  "is this trivially small" question we're actually asking.

## Out of scope

- **`--size-floor` CLI flag.** Not added unless a real repo argues for
  it. The default `10` is a soft prediction; revisit if M7-style
  tuning shows it under- or over-fires.
- **Surface `lineCount` in the report schema.** Useful for
  debuggability but not load-bearing for the candidate decision; can
  be added later as a verbose-only field without affecting ranking.
- **Apply size to bridge / unstable_dependency_candidate smells.** A
  small bridge is still a structural problem; a small unstable node is
  still SDP-violating. Size is intentionally absent from these two.
- **Replace percentile axis with raw-LOC threshold.** The percentile
  form composes with the existing framework and is robust across repo
  sizes. A raw threshold would need a separate calibration story.
- **Churn integration.** Still deferred per the M7 plan; size is
  orthogonal to churn and lands independently.
