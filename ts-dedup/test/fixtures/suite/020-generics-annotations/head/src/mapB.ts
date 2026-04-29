export function transformHead<A, B>(arr: A[], cb: (a: A) => B): B | undefined {
  if (arr.length === 0) return undefined;
  const head = arr[0] as A;
  return cb(head);
}
