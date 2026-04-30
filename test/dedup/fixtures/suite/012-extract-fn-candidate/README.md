# 012-extract-fn-candidate

Two outer functions with different purposes share a 6-line inner filter/clean block.
This is the canonical "extract a helper" refactoring candidate — the kind of hit we want
ts-dedup to surface even when the enclosing function differs.
