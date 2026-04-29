export function normalize(items: string[]): string[] {
  const result: string[] = [];
  for (const entry of items) {
    const clean = entry.trim();
    if (clean.length === 0) continue;
    result.push(clean);
  }
  return result;
}
