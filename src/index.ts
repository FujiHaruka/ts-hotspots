#!/usr/bin/env node
import { run } from "./cli.ts";

process.exit(await run(process.argv, process.stdout, process.stderr));
