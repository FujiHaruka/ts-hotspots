export function add(x: number, y: number): number {
  if (x < 0 || y < 0) {
    throw new Error("negative");
  }
  return x + y;
}
