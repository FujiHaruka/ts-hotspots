export function build(a: number, b: number): string {
  const aStr = String(a);
  const bStr = String(b);
  const pair = `${aStr}-${bStr}`;
  return pair;
}
