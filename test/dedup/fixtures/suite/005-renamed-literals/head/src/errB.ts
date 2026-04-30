export function validate(v: number): number {
  if (v < 100) {
    throw new Error("too small");
  }
  return v * 5;
}
