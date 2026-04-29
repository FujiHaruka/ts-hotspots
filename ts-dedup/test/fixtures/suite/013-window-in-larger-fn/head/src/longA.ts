export function longA(input: string[]): string {
  const trimmed = input.map((s) => s.trim());
  const filtered = trimmed.filter((s) => s.length > 0);
  const lower = filtered.map((s) => s.toLowerCase());
  const sorted = [...lower].sort();
  const first = sorted[0] ?? "";
  const last = sorted[sorted.length - 1] ?? "";
  return `${first}-${last}`;
}
