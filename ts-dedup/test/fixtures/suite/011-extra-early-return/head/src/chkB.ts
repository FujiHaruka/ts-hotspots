export function check(list: string[]): number {
  if (list.length === 0) return 0;
  const lower = list.map((s) => s.toLowerCase());
  const uniq = Array.from(new Set(lower));
  return uniq.length;
}
