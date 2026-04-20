declare function withLog<T>(fn: T): T;
declare function pipe<T>(...fns: T[]): (arg: T) => T;

export const boundArrow = (n: number): number => n + 1;

export const POST = withLog(async (n: number): Promise<number> => {
  return n * 2;
});

export const PUT = pipe<(n: number) => number>()((n: number) => n - 1);

export function runCallbacks(): void {
  [1, 2, 3].forEach((n) => {
    void n;
  });
}
