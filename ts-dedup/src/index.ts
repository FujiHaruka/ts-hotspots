#!/usr/bin/env node
import { main } from "./cli/main.ts";

main(process.argv.slice(2)).then(
  (code) => {
    process.exit(code);
  },
  (err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`ts-dedup: ${msg}\n`);
    process.exit(1);
  },
);
