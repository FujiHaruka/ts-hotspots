# ts-dedup bench harness

Runs the detector against every scenario in `test/dedup/fixtures/suite/` and
reports recall / precision / ablation numbers.

## Usage

```sh
# Full run (4 variants: baseline + 3 feature ablations).
pnpm bench

# Single fixture (prefix match).
pnpm bench -- --only 003-renamed-args

# Skip ablation runs (speed).
pnpm bench -- --no-ablation

# Config override (shallow-merged onto defaults).
pnpm bench -- --config tools/bench/configs/heavy-token.json

# Determinism check: run each scenario twice and diff reports.
pnpm bench -- --check-determinism
```

Outputs land in `--out-dir` (default `tools/bench/baseline/`):

- `summary.md` — human-readable, PR-pasteable.
- `summary.json` — full per-scenario metrics for diffing.

## How match judgment works

A report candidate matches a GT positive when:

1. both `filePath`s equal the GT exactly, and
2. the line-range Jaccard is ≥ 0.5 on both sides (GT ranges may be omitted,
   in which case the overlap is treated as 1.0).

A report candidate counts against a GT negative when both `filePath`s match
the negative entry (any line range).

## Metrics

- `recall@10` / `recall@50` / `recall@all`: matched GT positives over total
  GT positives, micro-averaged across the suite.
- `negativeViolations`: sum of report candidates that hit a negative pair.
- `minScoreFailures`: positives that matched but fell below their declared
  `minScore`.
- `wallMs`: detector wall time per scenario.
- `per-tag recall`: `recall@all` grouped by the GT `tags`.

## Ablation

Four runs per invocation:

- `baseline` — `features.enabled = { token: true, statement: true, call: true }`
- `token-off` / `statement-off` / `call-off` — one feature stream disabled.

Re-use the same index build when only scoring changes is *not* supported —
the detector is re-run from scratch each variant, which keeps the harness
simple at the cost of some time.
