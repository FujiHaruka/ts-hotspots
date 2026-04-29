# ts-dedup tokenNgramSizes sweep

fixtures: 25

## summary

| sizes        | recall@10 | recall@50 | recall@all | neg viol. | wall   |
|--------------|----------:|----------:|-----------:|----------:|-------:|
| [2,3]        |      0.95 |      0.95 |       0.95 |         4 |  7.22s |
| [3,4,5]      |      0.95 |      0.95 |       0.95 |         3 |  7.47s |
| [3,4,5,6]    |      0.95 |      0.95 |       0.95 |         3 |  7.26s |
| [4,5,6]      |      0.95 |      0.95 |       0.95 |         3 |  7.18s |
| [4,5,6,7]    |      0.95 |      0.95 |       0.95 |         3 |  6.87s |
| [5,6,7,8]    |      0.95 |      0.95 |       0.95 |         3 |  6.67s |
| [3..8]       |      0.95 |      0.95 |       0.95 |         3 |  6.54s |

## regressions vs [3,4,5,6] baseline

### [2,3]
- recall drops: —
- precision drops: 024-neg-different-async-styles

### [3,4,5]
- recall drops: —
- precision drops: —

### [3,4,5,6]
- recall drops: —
- precision drops: —

### [4,5,6]
- recall drops: —
- precision drops: —

### [4,5,6,7]
- recall drops: —
- precision drops: —

### [5,6,7,8]
- recall drops: —
- precision drops: —

### [3..8]
- recall drops: —
- precision drops: —

