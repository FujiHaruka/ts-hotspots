export function check(list: string[]): number {
  const lower = list.map((s) => s.toLowerCase());
  const uniq = Array.from(new Set(lower));
  return uniq.length;
}
