/**
 * Glob patterns excluded from analysis by default in both `comp` and `dup`.
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
  // Test files: structurally similar describe/it blocks otherwise dominate
  // the candidate list and drown out real refactor opportunities. The same
  // distortion applies to Storybook stories and end-to-end suites — they
  // import production code broadly and skew per-component fan-in.
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
