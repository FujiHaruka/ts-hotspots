# ts-dedup

Finds duplicate code in a TypeScript codebase — verbatim copies, renamed
clones, and near-duplicates where the structure matches but a few
statements differ. The cases where a reviewer would ask "isn't this the
same as X?".

Two modes:

- **PR mode** — compare the head side of a git revision range against the
  rest of the codebase on the base side. Designed for code review.
- **Whole-repo mode** — scan every fragment at one ref and report
  duplicate pairs across the whole tree. Designed for one-off audits and
  refactor planning.

The output is a ranked list of candidate pairs with per-axis scores and
concrete evidence. ts-dedup is tuned for high recall: it flags anything
plausible and lets a reviewer (human or AI) make the final call.

Only `.ts` and `.tsx` files are analysed.

## Install

ts-dedup is not yet published to npm. Clone and build from source:

```sh
git clone https://github.com/FujiHaruka/ts-dedup
cd ts-dedup
pnpm install
pnpm build
```

The CLI entry point is `./dist/index.js`. Use `pnpm link --global` to put a
`ts-dedup` command on your `PATH`, or invoke it directly with
`node ./dist/index.js`.

## Usage

Run inside a git repository. Pick a mode:

```sh
# PR mode
ts-dedup <revrange> [options]

# Whole-repo mode
ts-dedup --whole-repo [--ref <ref>] [options]
```

In PR mode, `<revrange>` is a git-style revision range:

- `A...B` — diff from `merge-base(A, B)` to `B`. Matches the "Files changed"
  view on GitHub and is the recommended form for PR review.
- `A..B` — raw two-dot diff of `A` against `B`.
- `A...` / `A..` — head side defaults to `HEAD`.
- `...B` / `..B` — base side defaults to `HEAD`.

In whole-repo mode, every fragment at the chosen ref is compared against
every other. Symmetric duplicates are emitted once. `--ref` defaults to
`HEAD`.

Options (all valid in both modes unless noted):

- `--repo <path>` — repository path. Defaults to the current directory.
- `--format markdown|json` — report format. Defaults to `markdown`.
- `--exclude <glob>` — extra path glob to skip. Repeatable. Added on top
  of built-in defaults: `node_modules`, `dist`, generated files, lock
  files, snapshot files, and test files (`**/*.test.ts`,
  `**/*.spec.tsx`, `**/__tests__/**`, ...). Globs understand `**`, `*`,
  and `?`.
- `--ref <ref>` — whole-repo mode only; commit/branch/tag to scan.
  Defaults to `HEAD`.
- `--phase-timings` — print per-phase wall time (diff, listBase,
  baseIndex, headSearch, report) to stderr after the run. Useful for
  spotting which stage dominates on a given input.
- `--limit <N|all>` — cap the candidates list at the top N by combined
  score. Defaults to `20` so the output stays scannable; pass `all` to
  keep every candidate. The stderr summary line shows
  `displayed=N of M` when the cap actually trims the list.
- `--no-code` — drop the fragment source from each candidate. By default
  the report embeds the changed and existing code so a downstream reader
  can act without re-opening files; pass this flag when only locations
  and scores are wanted.

The report goes to stdout; a short summary line goes to stderr so it
survives redirection. The exit code is `0` whether or not candidates are
found; `1` is reserved for argument errors or git failures.

Examples:

```sh
# PR check: what did this branch add on top of origin/main?
ts-dedup origin/main... > report.md

# JSON for programmatic consumers.
ts-dedup origin/main...HEAD --format json > report.json

# Run against a repo elsewhere on disk.
ts-dedup main..feature --repo ./my-repo

# Skip an additional directory on top of the defaults.
ts-dedup origin/main... --exclude 'src/legacy/**' --exclude '**/*.gen.ts'

# Audit duplicates across the whole repo at HEAD.
ts-dedup --whole-repo --format json > duplicates.json

# Audit a specific release tag, ignoring legacy code.
ts-dedup --whole-repo --ref release/v2 --exclude 'src/legacy/**'
```

## Output

Each candidate pairs two fragments under `left` and `right`, together with
four similarity scores and the evidence that produced them. In PR mode
`left` is the fragment changed by the PR and `right` is the matching
fragment in the existing codebase; the Markdown report tags them
`changed:` / `existing:`. In whole-repo mode the sides are interchangeable
— pairs are emitted in a canonical order (lex-smaller fragment id first),
the Markdown report uses neutral `a:` / `b:` labels, and `pr.baseSha` /
`pr.headSha` both carry the scanned ref's sha.

The report header carries an `summary` block describing the analysed
scope and pipeline counts: file count, line count, fragment count broken
down by kind (function / block / window), and how many `.ts` / `.tsx`
files were dropped by the exclude rules. PR-mode reports also include a
`changed` scope alongside `base`; whole-repo reports omit `changed`.

```jsonc
{
  "pr": { "baseSha": "…", "headSha": "…" },
  "summary": {
    "mode": "pr",                    // or "whole-repo"
    "scope": {
      "base":    { "files": 64, "lines": 5012, "fragments": 1183, "fragmentsByKind": { "function": 198, "block": 348, "window": 637 }, "excludedFiles": 113 },
      "changed": { "files": 12, "lines":  843, "fragments":  142, "fragmentsByKind": { "function":  38, "block":  41, "window":  63 }, "excludedFiles":   0 }
    },
    "pipeline": { "candidatePairs": 3812, "reportedPairs": 124 }
  },
  "candidates": [
    {
      "left":  { "filePath": "src/util.ts", "startLine": 1, "endLine": 20, "kind": "function", "code": "…" },
      "right": { "filePath": "src/math.ts", "startLine": 1, "endLine": 20, "kind": "function", "code": "…" },
      "scores": {
        "combined": 0.78,
        "tokenOverlap": 0.82,
        "statementKindSimilarity": 0.90,
        "callOverlap": 0.60,
        "sizeCompatibility": 0.75
      },
      "evidence": {
        "sharedCalls": ["CALL:…"],
        "sharedProperties": ["PROP:…"],
        "matchedStatementKinds": ["IfStatement|ReturnStatement"],
        "matchedTokenNgramsSample": ["ID DOT ID", "IF ID DOT ID"]
      },
      "recommendationHint": {
        "confidence": "high",
        "likelyRefactoring": "extract-function",
        "riskFlags": []
      }
    }
  ]
}
```

`combined` is a weighted sum of the three feature axes (`tokenOverlap`,
`statementKindSimilarity`, `callOverlap`) plus a size compatibility term.
A pair is reported when the combined score **or** any of the three axis
scores clears its threshold — high recall is the goal, and the evidence
fields let a reviewer dismiss false positives quickly.

The Markdown format renders the same data in a reviewable layout.

Output is deterministic: the same repository state produces byte-identical
reports, ranked by combined score with stable tie-breaking.

## License

MIT
