/**
 * Narrow a value to `NonNullable<T>` by throwing if it is `null` /
 * `undefined`. Used in places where `noUncheckedIndexedAccess` widens an
 * obviously-in-bounds access, or where a `Map.get` is logically guaranteed
 * to hit. Prefer this over `!` (banned) and `as T` (also banned).
 */
export function nonNull<T>(value: T | null | undefined, message?: string): T {
  if (value === null || value === undefined) {
    throw new Error(message ?? "expected non-null value");
  }
  return value;
}
