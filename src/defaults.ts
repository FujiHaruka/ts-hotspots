/**
 * Glob patterns excluded from analysis by default in `comp`, `dup`, and `arch`.
 * User-supplied `--exclude` globs are appended to this list, never replace it.
 *
 * Test/story/e2e files are bundled in here: structurally similar describe/it
 * blocks dominate complexity rankings and duplication candidate lists, and
 * test edges inflate per-component fan-in for arch.
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
