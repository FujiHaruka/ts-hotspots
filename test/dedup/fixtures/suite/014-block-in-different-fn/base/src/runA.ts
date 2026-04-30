export function runA(items: number[]): number[] {
  const out: number[] = [];
  if (items.length > 0) {
    for (const it of items) {
      if (it > 0) out.push(it * 2);
    }
  }
  return out;
}
