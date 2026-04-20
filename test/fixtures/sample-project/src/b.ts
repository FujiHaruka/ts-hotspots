import type { C } from "./c.ts";

export const bValue: number = 42;

export function usesC(c: C): number {
  return c.n;
}
