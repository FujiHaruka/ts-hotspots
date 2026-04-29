# token n-gram build/compare micro-bench

Results from `pnpm bench:ngram`. Each block records median ms over the
configured runs for build (n-gram construction) and pairs (Jaccard-style
`Set` probes) phases. The four variants are co-located in
`tools/bench/microNgramBuild.ts` so each block compares the same
techniques against itself; "phase-N" labels just track when the block
was captured relative to the source migration in
`docs/plans/token-ngram-build-speedup.md`.

| variant | shape                                              |
|---------|----------------------------------------------------|
| V0      | long token forms (`LPAREN`, `IF`, ...) + `slice+join` + space separator |
| V1      | long token forms + manual concat + space separator |
| V2      | short token forms (`(`, `If`, ...) + manual concat + NUL separator |
| V3      | V2 keys folded through `Symbol.for`                 |

Read across rows in a single block: V2's build column shows the saving
the production switch buys; V3 shows that `Symbol.for` registry cost
(at this F/T scale) outweighs the pair-Set probe speed-up it earns. The
production code now matches V2.

## phase-0 baseline (no source change) — 2026-04-26T13:00:42.948Z

params: F=200, T=400, sizes=[3,4,5,6], pairs=6000, runs=5 (median)

| variant                                | build ms | pairs ms | total ms | vs V0 |
|----------------------------------------|---------:|---------:|---------:|------:|
| V0  long / slice+join / string         |     47.5 |    251.3 |    297.7 |    0% |
| V1  long / manual concat / string      |     47.3 |    259.5 |    316.5 |    6% |
| V2  short / manual concat / string     |     31.8 |    268.4 |    292.8 |   -2% |
| V3  short / manual concat / symbol     |    109.1 |    215.9 |    323.5 |    9% |

## phase-1 after (manual concat in src) — 2026-04-26T13:02:39.852Z

params: F=200, T=400, sizes=[3,4,5,6], pairs=6000, runs=5 (median)

| variant                                | build ms | pairs ms | total ms | vs V0 |
|----------------------------------------|---------:|---------:|---------:|------:|
| V0  long / slice+join / string         |     45.9 |    252.5 |    298.7 |    0% |
| V1  long / manual concat / string      |     48.5 |    278.6 |    327.0 |    9% |
| V2  short / manual concat / string     |     31.0 |    279.3 |    310.4 |    4% |
| V3  short / manual concat / symbol     |    110.9 |    220.9 |    332.8 |   11% |

## phase-2 after (short tokens + NUL separator in src) — 2026-04-26T13:08:35.810Z

params: F=200, T=400, sizes=[3,4,5,6], pairs=6000, runs=5 (median)

| variant                                | build ms | pairs ms | total ms | vs V0 |
|----------------------------------------|---------:|---------:|---------:|------:|
| V0  long / slice+join / string         |     44.1 |    245.1 |    289.1 |    0% |
| V1  long / manual concat / string      |     42.7 |    253.4 |    296.1 |    2% |
| V2  short / manual concat / string     |     32.6 |    255.7 |    288.3 |   -0% |
| V3  short / manual concat / symbol     |     99.3 |    210.2 |    309.1 |    7% |

