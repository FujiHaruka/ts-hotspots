#!/usr/bin/env node
import { run } from "./cli.ts";
import {
  exitAfterFlush,
  exitQuietlyOnClosedPipe,
} from "./cli/exitAfterFlush.ts";

exitQuietlyOnClosedPipe(process.stdout);
await exitAfterFlush(await run(process.argv, process.stdout, process.stderr));
