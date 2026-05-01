/**
 * Lightweight glob → RegExp converter.
 *
 * Supported metacharacters:
 *   - `**` : zero or more path segments (may match across `/`)
 *   - `*`  : any sequence of characters within a single path segment (no `/`)
 *   - `?`  : exactly one character (no `/`)
 *   - anything else is matched literally (special regex chars are escaped)
 *
 * This is intentionally a tiny subset of minimatch. It's enough to express
 * the exclude globs we ship in `defaults.ts`.
 */
export function globToRegExp(glob: string): RegExp {
  let i = 0;
  let out = "^";
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      // Check for `**`
      if (glob[i + 1] === "*") {
        // Consume `**`, and an optional following `/`.
        i += 2;
        if (glob[i] === "/") {
          i += 1;
          // `**/` → zero-or-more segments followed by `/` OR nothing
          out += "(?:.*/)?";
        } else {
          // `**` at end or not followed by `/`
          out += ".*";
        }
      } else {
        // single `*` → any chars except `/`
        out += "[^/]*";
        i += 1;
      }
      continue;
    }
    if (c === "?") {
      out += "[^/]";
      i += 1;
      continue;
    }
    // Escape regex specials.
    if (c !== undefined && /[.+^${}()|[\]\\]/.test(c)) {
      out += `\\${c}`;
      i += 1;
      continue;
    }
    if (c !== undefined) {
      out += c;
    }
    i += 1;
  }
  out += "$";
  return new RegExp(out);
}

/**
 * Return true if `path` matches ANY of the given globs.
 *
 * Paths must use forward slashes. Patterns without an explicit `**` do not
 * implicitly cross path separators.
 */
export function matchesAnyGlob(
  path: string,
  globs: readonly string[],
): boolean {
  for (const g of globs) {
    if (globToRegExp(g).test(path)) {
      return true;
    }
  }
  return false;
}
