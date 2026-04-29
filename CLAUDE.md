# CLAUDE.md

## Overview

ts-hotspots is a CLI that statically analyzes a TypeScript project via ts-morph and returns hotspots (likely refactor candidates) as JSON. Its job is to hand coding agents like Claude Code a rough "where should I read first?" — it does not propose refactors itself, only coordinates (`file:line`) and metric facts.

The primary ranking unit is the function (including methods, arrow functions, and TSX components); file-level rankings are returned alongside. See `docs/requirements.md` for detailed requirements.

## Development workflow

- **Commits and pushes are autonomous.** Decide when to commit and push on each turn without waiting for the user to ask. The user will not give commit instructions. Commit autonomously even for changes that did not originate in the current session (e.g. uncommitted edits already on disk).
- **Do not report commits or pushes.** The user is not interested in commit/push activity. Skip mentioning them in turn summaries or status updates.
- **Keep commit messages short.** One concise line, no body unless absolutely necessary.
- **Write tests alongside code.** Whenever you add or change behavior, add or update tests for it and run them in the same turn to verify the code you just wrote. Do not defer verification.
- **Do not run `pnpm format` manually before committing.** The pre-commit hook runs `biome check --write` and `oxlint --fix` via lint-staged, so formatting is applied automatically on commit. Running it explicitly is redundant.

## User-facing docs (README etc.)

When updating user-facing docs, the task is "write the doc as it should read today", not "document the change". Apply these rules:

- **Write for a first-time reader.** They have no idea what changed, and don't care. Describe current behavior, not deltas.
- **No internal jargon.** Milestone names (M7, M8, ...), ticket IDs, and "breaking change" banners do not belong in user docs — they belong in commit messages and `docs/plans/`.
- **Prefer rewriting over appending.** If a section no longer fits, restructure it. Adding a new section for every change is how docs bloat.
- **Keep scale proportional.** If you add N lines, consider whether N lines elsewhere should shrink. Don't let a small behavior change double the doc.
- **Self-check before finishing.** Re-read the final doc cold, as someone who never saw the diff. If anything reads as "here's what's new", rewrite it.
