export function validate(v: number): number {
  if (v < 0) {
    throw new Error("negative");
  }
  return v * 2;
}
