import { bValue } from "./b.ts";
import type { C } from "./c.ts";

export const x: number = 1;

export function simple(): number {
  return 1;
}

export function branchy(n: number): number {
  if (n > 0) return n;
  if (n < 0) return -n;
  return 0;
}

export function usesBC(c: C): number {
  return bValue + c.n;
}

export async function lazyD(): Promise<number> {
  const mod = await import("./d.ts");
  return mod.dValue;
}
