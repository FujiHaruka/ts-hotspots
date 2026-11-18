#!/usr/bin/env node
import {
  exitAfterFlush,
  exitQuietlyOnClosedPipe,
} from "./cli/exitAfterFlush.ts";
import { run } from "./cli.ts";

exitQuietlyOnClosedPipe(process.stdout);
await exitAfterFlush(await run(process.argv, process.stdout, process.stderr));
