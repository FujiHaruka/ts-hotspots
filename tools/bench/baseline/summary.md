# ts-dedup bench report

config: defaults
fixtures: 25 (positives: 20, negatives: 5)
wall: 6.89s

## summary

| run            | recall@10 | recall@50 | recall@all | neg viol. | wall   |
|----------------|----------:|----------:|-----------:|----------:|-------:|
| baseline       |      0.90 |      0.90 |       0.90 |         0 |  6.89s |
| token-off      |      0.70 |      0.70 |       0.70 |         1 |  6.68s |
| statement-off  |      0.90 |      0.90 |       0.90 |         1 |  6.62s |
| call-off       |      0.90 |      0.90 |       0.90 |         0 |  6.70s |

## per-tag recall (baseline)

| tag        | matched / total | recall |
|------------|----------------:|-------:|
| async      |           1 / 1 |   1.00 |
| block      |           2 / 2 |   1.00 |
| cross-file |           2 / 2 |   1.00 |
| cross-granularity |           2 / 2 |   1.00 |
| function   |         14 / 16 |   0.88 |
| generics   |           1 / 1 |   1.00 |
| literal    |           1 / 1 |   1.00 |
| method     |           1 / 1 |   1.00 |
| refactoring |           1 / 1 |   1.00 |
| rename     |           3 / 3 |   1.00 |
| same-file  |           0 / 1 |   0.00 |
| template-literal |           1 / 1 |   1.00 |
| tsx        |           1 / 2 |   0.50 |
| type-1     |           3 / 3 |   1.00 |
| type-2     |           7 / 9 |   0.78 |
| type-3     |           8 / 8 |   1.00 |
| window     |           2 / 2 |   1.00 |

## failures (baseline)

- 015-same-file-near-twins: missed: src/helpers.ts ↔ src/helpers.ts
- 018-tsx-render-helper: missed: src/renderItems.tsx ↔ src/renderList.tsx
