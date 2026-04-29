export function build(a: number, b: number): string {
  const bStr = String(b);
  const aStr = String(a);
  const pair = `${aStr}-${bStr}`;
  return pair;
}
