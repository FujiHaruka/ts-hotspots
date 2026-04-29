export function shortB(input: string[]): string[] {
  const trimmed = input.map((s) => s.trim());
  const filtered = trimmed.filter((s) => s.length > 0);
  const lower = filtered.map((s) => s.toLowerCase());
  const sorted = [...lower].sort();
  return sorted;
}
