export function checkAccount(acc: { id: string; balance: number }): number {
  if (!acc.id) throw new Error("bad id");
  const fee = acc.balance * 0.01;
  const discount = fee > 10 ? fee - 5 : fee;
  return Math.round(discount);
}
