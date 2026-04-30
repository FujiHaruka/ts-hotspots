/**
 * Strip the feature-kind prefix (`token:` / `statement:` / `call:`) from a
 * feature key and return a human-readable payload.
 *
 * For `token:` keys the internal NUL separator is converted to a space so
 * downstream readers (coding agents / humans) see `i . i` instead of the
 * raw `i\x00.\x00i` form. The bare payloads keep the implementation
 * coupling out of the report — readers see `CALL:findById` rather than
 * `call:CALL:findById`.
 */
export function stripPrefix(key: string): string {
  if (key.startsWith("token:")) {
    return key.slice("token:".length).replaceAll("\x00", " ");
  }
  if (key.startsWith("statement:")) {
    return key.slice("statement:".length);
  }
  if (key.startsWith("call:")) {
    return key.slice("call:".length);
  }
  return key;
}
