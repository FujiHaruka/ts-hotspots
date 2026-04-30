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
  // the candidate list and drown out real refactor opportunities.
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/__tests__/**",
];
