export function cbLoad(id: string, cb: (err: Error | null, data: string) => void): void {
  setTimeout(() => {
    cb(null, `data-${id}`);
  }, 10);
}
