# ts-dedup scale probe

repo: /home/user/ts-dedup
range: `7c3c7bf..HEAD` (two-dot)
runs: 3 (median of per-phase ms below)

## current numbers

Input size:

- base files: 94
- base fragments: 1682
- changed files: 39
- changed fragments: 804
- candidate pairs: 42723
- reported pairs: 3544

Phase breakdown (median):

| phase       | median ms | share |
|-------------|----------:|------:|
| diff        |     318.9 |   7% |
| listBase    |     537.9 |  11% |
| baseIndex   |     818.4 |  17% |
| headSearch  |    3039.1 |  64% |
| report      |      14.9 |   0% |
| **total**   |    4729.1 | 100% |

## history

| revision                              | base files | changed frags | candidate pairs | total ms | headSearch ms | headSearch share |
|---------------------------------------|-----------:|--------------:|----------------:|---------:|--------------:|-----------------:|
| pre-optimization (commit `c2848f3`)   |         94 |           668 |          37,123 |   8728.5 |        7584.2 |              87% |
| post-optimization (commit `HEAD`)     |         94 |           804 |          42,723 |   4729.1 |        3039.1 |              64% |

The two probes were taken on slightly different working trees — the
post-optimization run sees more changed fragments because additional
scoring helpers were added in the optimization commits. To isolate the
optimization effect, normalise to per-pair cost:

- Pre-optimization:  7584.2 ms / 37,123 pairs = **0.204 ms / pair**
- Post-optimization: 3039.1 ms / 42,723 pairs = **0.071 ms / pair**

A **2.9× speedup on the hot inner loop**, with headSearch share dropping
from 87% to 64%.

## what changed in the optimization

Two small refactors in `scoreCandidateDetailed`'s call path:

1. **Pre-built feature `Set`s**: `runDetector` now constructs a
   `FragmentFeatureSets` (Set views of token / statement / call streams)
   once per fragment — once per base fragment at index time, once per
   changed fragment before the candidate inner loop — instead of the
   re-scorer rebuilding them on every candidate pair. Implemented in
   `src/scoring/featureSets.ts` and `src/cli/runDetector.ts`.
2. **Fused Jaccard + intersection**: the new
   `jaccardWithIntersection(a, b)` helper walks the smaller set once and
   returns both the Jaccard ratio (for combined scoring) and the
   ascending-sorted intersection (for evidence). The previous code path
   ran `setJaccard` and `sortedIntersection` separately for each of the
   three axes, doing two Set walks per axis per pair. New hot-path entry
   point: `scoreCandidateDetailedFromSets` in
   `src/scoring/scoreCandidate.ts`.

The convenience overload `scoreCandidateDetailed(features...)` is kept for
non-pipeline callers and tests. Output is bit-identical between the two —
covered by an equivalence test in `scoreCandidate.test.ts` plus the
existing fixture-suite determinism tripwire.

## status

Decision gate from `docs/plans/m8-performance.md` was 50%. headSearch
landed at 64%, still above the gate but with a 2.9× per-pair speedup
and a 46% drop in total wall time. Stopping here:

- The remaining cost in headSearch is the Jaccard / intersection work
  itself plus `combinedScore` arithmetic. Further reductions need
  algorithmic changes (early-exit when `shouldReport` cannot possibly
  pass, tighter `maxCandidatesPerFragment`, or pre-filtering on a single
  cheap axis) which add complexity for a smaller, less obvious payoff.
- This is a follow-up candidate but not blocking M8 closure. The probe
  itself stays in `pnpm bench:scale` so future work can be re-measured
  against the numbers above.
