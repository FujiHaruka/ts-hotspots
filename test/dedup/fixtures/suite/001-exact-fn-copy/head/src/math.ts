export function add(a: number, b: number): number {
  if (Number.isNaN(a) || Number.isNaN(b)) {
    throw new Error("nan");
  }
  const sum = a + b;
  return sum;
}
