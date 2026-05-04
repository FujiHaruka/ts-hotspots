/**
 * Format a `(file, startLine, endLine)` triple as a `file:start-end` (or
 * `file:line` for single-line ranges) coordinate string. The shape
 * matches `comp`'s function `location` so the two reports surface
 * coordinates the same way.
 */
export function buildLocation(
  filePath: string,
  startLine: number,
  endLine: number,
): string {
  if (startLine === endLine) return `${filePath}:${String(startLine)}`;
  return `${filePath}:${String(startLine)}-${String(endLine)}`;
}

interface ParsedLocation {
  filePath: string;
  startLine: number;
  endLine: number;
}

/**
 * Inverse of `buildLocation`. Splits a `"file:start-end"` (or
 * `"file:line"`) coordinate back into its parts. The split is on the
 * **last** `:` so file paths containing colons (rare, but possible on
 * some platforms) survive the round trip.
 */
export function parseLocation(location: string): ParsedLocation {
  const colonIdx = location.lastIndexOf(":");
  if (colonIdx < 0) {
    throw new Error(`malformed location string: ${location}`);
  }
  const filePath = location.slice(0, colonIdx);
  const range = location.slice(colonIdx + 1);
  const dashIdx = range.indexOf("-");
  if (dashIdx < 0) {
    const single = Number.parseInt(range, 10);
    return { filePath, startLine: single, endLine: single };
  }
  const startLine = Number.parseInt(range.slice(0, dashIdx), 10);
  const endLine = Number.parseInt(range.slice(dashIdx + 1), 10);
  return { filePath, startLine, endLine };
}
