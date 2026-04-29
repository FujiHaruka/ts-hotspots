# 021-neg-shared-domain

Both functions start with `if (!obj.id)` and operate on a user-like record,
but their bodies diverge completely. Precision regression canary.
