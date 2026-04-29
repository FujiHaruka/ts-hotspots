export function mapFirst<T, U>(xs: T[], fn: (t: T) => U): U | undefined {
  if (xs.length === 0) return undefined;
  const first = xs[0] as T;
  return fn(first);
}
