export function compute(price: number, tax: number): number {
  if (price < 0) {
    return 0;
  }
  return price + price * tax;
}
