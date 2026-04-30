export function runB(items: number[]): number {
  let count = 0;
  if (items.length > 0) {
    for (const it of items) {
      if (it > 0) count += 1;
    }
  }
  return count;
}
