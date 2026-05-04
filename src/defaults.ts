/**
 * Test/story/e2e glob patterns. Excluded by default across all
 * subcommands; arch's `--include-tests` flag drops this set from the
 * effective exclude list so test edges flow into the dependency graph.
 *
 * Why factored out: structurally similar describe/it blocks dominate
 * complexity rankings and duplication candidate lists, and inflate
 * per-component fan-in for arch — so excluding them by default is the
 * sane policy. But arch needs the option to include them when the
 * agent is investigating a test surface specifically.
 */
const TEST_LIKE_EXCLUDE_GLOBS: readonly string[] = [
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/__tests__/**",
  "**/*.stories.ts",
  "**/*.stories.tsx",
  "**/*.cy.ts",
  "**/*.cy.tsx",
  "**/cypress/**",
  "**/playwright/**",
];

/**
 * Glob patterns excluded from analysis by default in `comp`, `dup`, and `arch`.
 * User-supplied `--exclude` globs are appended to this list, never replace it.
 */
export const DEFAULT_EXCLUDE_GLOBS: readonly string[] = [
  "node_modules/**",
  "dist/**",
  "build/**",
  "out/**",
  "coverage/**",
  "**/*.generated.ts",
  "**/*.generated.tsx",
  "**/__generated__/**",
  "**/vendor/**",
  "**/*.lock",
  "pnpm-lock.yaml",
  "package-lock.json",
  "yarn.lock",
  "**/__snapshots__/**",
  "**/*.snap",
  "**/migrations/**",
  "**/fixtures/**",
  ...TEST_LIKE_EXCLUDE_GLOBS,
];

/** Defaults minus the test-like globs — used by `arch --include-tests`. */
export const DEFAULT_EXCLUDE_GLOBS_NO_TESTS: readonly string[] =
  DEFAULT_EXCLUDE_GLOBS.filter((g) => !TEST_LIKE_EXCLUDE_GLOBS.includes(g));
