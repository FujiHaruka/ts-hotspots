export function reportA(rows: Array<{ name: string; qty: number }>): string {
  const lines: string[] = ["Name,Qty"];
  for (const r of rows) {
    if (r.name.length === 0) continue;
    if (r.qty <= 0) continue;
    const name = r.name.trim();
    const qty = Math.max(0, Math.floor(r.qty));
    lines.push(`${name},${String(qty)}`);
  }
  return lines.join("\n");
}
