export function process(x: number): number {
  if (x < 0) throw new Error("neg");
  const doubled = x * 2;
  const squared = doubled * doubled;
  return squared;
}
