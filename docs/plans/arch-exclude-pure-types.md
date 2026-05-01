# Exclude pure-type components from `arch` candidates

## Context

`ts-hotspots arch` currently surfaces pure-type interfaces (e.g. `CloneCandidateReport` at `src/duplication/domain/report.ts:92`) as refactoring candidates. The output schema already exposes `edgeMix.runtimeShare`, and the `runtimeShare: 0` on these hits self-identifies them as type-only — yet they still climb into the top-5.

Two reasons this happens despite `EDGE_WEIGHTS["type"] = 0.3`:

1. The downweight is applied per-edge in the adjacency layer, so percentile axes (`fan_in_pct`, `pagerank_pct`, `betweenness_pct`, `instability_delta_pct`) shrink — but not to zero. With small N and many ties, even shrunk percentiles can still hit `1.0`.
2. `unstable_edge_flag` is a **binary** axis. Edge-weight downweighting has zero effect on it. A pure-type interface with one type-edge to a more-unstable type still gets `unstable_edge_flag = 1`, which dominates the `unstable_dependency_candidate` smell (weight 0.6).

`arch`'s contract is "give an agent file:line coordinates to read first, then refactor". A pure-type component is a contract, not a refactor target — pointing the agent at it wastes a slot. Drop them from the ranked output.

## Approach

Add a **scoring-time gate** that excludes any component that is

- declared with `exportKind ∈ {"type", "interface"}`, AND
- has zero runtime edges across both directions (i.e. all incident edges are `kind: "type"`).

The dependency graph itself stays untouched: `Component` nodes remain, type edges remain, `EDGE_WEIGHTS["type"] = 0.3` continues to apply. This means **other components' fan-out, PageRank, betweenness, and reverse closure still see type-only nodes as routing points** — only the candidate ranking drops them. Removing them from the graph would falsify metrics on runtime components that legitimately depend on a type hub.

Why both conditions, not either alone:

- `exportKind` alone over-fires: a `class` whose every consumer happens to use it only as a type today is still a runtime-load-bearing class.
- `runtimeShare === 0` alone under-fires (technically it's already implied by `exportKind ∈ {type,interface}` for most cases) but would also drop unused enums and functions that nobody calls — which are different smells (dead code) we shouldn't mask here.

The gate runs before the threshold check inside `score()`, expressed as an opt-in `excludedNodeIds: ReadonlySet<string>` on `ScoreOptions`. The set is computed in `runPipeline` from the graph, so `score()` stays pure over its declared inputs (no `Graph` dependency leaks into scoring).

## Per-file breakdown

1. **New helper** — `src/architecture/scoring/typeOnlyNodes.ts`
   - Export `collectTypeOnlyNodeIds(graph: Graph): ReadonlySet<string>`.
   - Walk `graph.nodes`; for each node where `exportKind ∈ {"type","interface"}`, scan its incident edges (in + out) and include the id only if every incident edge has `kind === "type"`.
   - Linear in `|nodes| + |edges|`. Build a once-per-call `Map<nodeId, hasRuntimeIncident>` to keep it O(N+E) rather than O(N·E).
   - Pure function; no I/O.

2. **`score()` gate** — `src/architecture/scoring/score.ts`
   - Add `excludedNodeIds?: ReadonlySet<string>` to `ScoreOptions`.
   - In the per-node loop, `continue` immediately when `excludedNodeIds?.has(id) === true`. Place the check at the very top of the loop body so excluded nodes do no work and can never produce a `SmellHit`.
   - Important: keep excluded nodes in the `lookups` population. The percentile distribution must still reflect all nodes' raw values — otherwise excluding a high-value type interface would shift everyone else's percentile up. We exclude *from being a candidate*, not *from the population*.

3. **Wire into the pipeline** — `src/architecture/cli/main.ts`
   - In `runPipeline`, after `buildGraph` and before `score(metrics)`, call `collectTypeOnlyNodeIds(graph)` and pass as `score(metrics, { excludedNodeIds: ... })`.
   - No CLI flag — this is unconditional behavior. (If we ever need to turn it off, a flag can be added later; v1 has no use case for surfacing type-only nodes.)

4. **Tests**
   - `src/architecture/scoring/typeOnlyNodes.test.ts` (new): unit tests covering
     - pure interface with only type edges → included
     - interface with one runtime edge (e.g. a class consuming it via `new` — wait, that's still a type edge; use `value` or `extends`) → excluded
     - type alias with only type edges → included
     - class with only type edges → excluded (`exportKind` gate)
     - enum with only type edges → excluded (`exportKind` gate — enums are runtime objects)
     - default export → excluded (`exportKind: "default"` is the synthetic kind for default exports; treat as runtime)
     - empty graph → empty set
   - `src/architecture/scoring/score.test.ts` (extend): add a case where two nodes would otherwise both qualify, but one is in `excludedNodeIds`. Assert the excluded node is absent from the result and the surviving node's percentile is unchanged from the no-exclude baseline.
   - `src/architecture/cli/main.test.ts` (if a fixture-level test exists): no change needed — the existing fixtures are dominated by runtime components.

## Out of scope

- **`unstable_edge_flag` rework.** Even after this change, `unstable_edge_flag` remains binary and saturates across runtime components too. That's a separate precision issue tracked in a future session.
- **Smell-by-smell gating.** A pure-type interface with very high fan-in is arguably a real `high_impact_component` ("everyone depends on this contract"). v1 drops it uniformly to keep the gate simple; revisit if users report missed signals.
- **Dropping types from the graph.** Explicitly rejected — it would damage runtime components' transitive metrics.
- **CLI flag to opt out.** Not added unless a use case appears.
