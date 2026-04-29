export function computeTotal(price: number, qty: number): number {
  if (price <= 0 || qty <= 0) {
    return 0;
  }
  return price * qty;
}
