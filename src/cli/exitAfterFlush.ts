function flush(stream: NodeJS.WriteStream): Promise<void> {
  return new Promise((resolve) => {
    if (stream.destroyed || !stream.writable) {
      resolve();
      return;
    }
    stream.write("", () => {
      resolve();
    });
  });
}

export function exitQuietlyOnClosedPipe(stream: NodeJS.WriteStream): void {
  stream.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EPIPE") process.exit(0);
    throw err;
  });
}

export async function exitAfterFlush(code: number): Promise<never> {
  await Promise.all([flush(process.stdout), flush(process.stderr)]);
  process.exit(code);
}
