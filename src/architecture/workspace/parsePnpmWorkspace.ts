/**
 * Minimal `pnpm-workspace.yaml` parser.
 *
 * Only extracts the `packages:` block — list items written as
 * `  - "packages/*"` or `  - packages/*`. Quotes (single / double),
 * inline `# comment` tails, and blank lines between items are tolerated.
 * Anything else (top-level keys other than `packages:`, nested mappings,
 * flow-style sequences `[ ... ]`) is ignored — we are not a YAML parser
 * and the field we care about is single-purpose.
 *
 * Returns the patterns verbatim. Glob expansion happens later
 * (`expandPackageGlobs`).
 */

export function parsePnpmWorkspaceYaml(text: string): string[] {
  const lines = text.split(/\r?\n/);
  const result: string[] = [];
  let inPackages = false;

  for (const rawLine of lines) {
    // Strip trailing CR (handled by the regex split above) but keep
    // leading whitespace — indentation matters for list items.
    const line = rawLine;

    if (/^packages\s*:\s*(?:#.*)?$/.test(line)) {
      inPackages = true;
      continue;
    }

    if (!inPackages) continue;

    const trimmed = line.trim();
    // Skip blank / comment-only lines without leaving the block.
    if (trimmed === "" || trimmed.startsWith("#")) continue;

    // List item under `packages:`. Indentation must be > 0 (not at column 0).
    const itemMatch = /^(\s+)-\s*(.*)$/.exec(line);
    if (itemMatch === null) {
      // A non-list, non-blank line at column 0 ends the block.
      // (Sub-keys at deeper indentation we don't recognise anyway.)
      if (!line.startsWith(" ") && !line.startsWith("\t")) {
        inPackages = false;
      }
      continue;
    }

    let value = (itemMatch[2] ?? "").trim();
    if (value === "") continue;

    // Quoted values: find the matching closing quote and drop everything
    // after it (incl. trailing inline comments). Unquoted values: a
    // trailing ` #` introduces a comment per YAML semantics.
    if (value.startsWith(`"`) || value.startsWith(`'`)) {
      const quote = value.charAt(0);
      const endIdx = value.indexOf(quote, 1);
      value = endIdx === -1 ? value.slice(1) : value.slice(1, endIdx);
    } else {
      const hashIdx = value.indexOf(" #");
      if (hashIdx !== -1) value = value.slice(0, hashIdx).trim();
    }

    if (value !== "") result.push(value);
  }

  return result;
}
