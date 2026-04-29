export function reportB(items: Array<{ name: string; qty: number }>): number {
  let total = 0;
  for (const r of items) {
    if (r.name.length === 0) continue;
    if (r.qty <= 0) continue;
    const name = r.name.trim();
    const qty = Math.max(0, Math.floor(r.qty));
    total += qty * name.length;
  }
  return total;
}
