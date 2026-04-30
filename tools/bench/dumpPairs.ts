import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { parseArgs } from "node:util";
import { runDetector } from "../../src/duplication/cli/runDetector.ts";
import { defaultConfig } from "../../src/duplication/config/index.ts";
import { groupsToPairs } from "./groupsToPairs.ts";

/**
 * Dump default-config pair list (path + lines + scores) to JSON. Used to
 * snapshot detector output before / after a code change so a follow-up
 * script can diff the two snapshots without depending on git stash dancing.
 */

interface Args {
  base: string;
  head: string;
  repo: string;
  out: string;
}

function parseCli(argv: readonly string[]): Args {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      base: { type: "string" },
      head: { type: "string", default: "HEAD" },
      repo: { type: "string" },
      out: { type: "string" },
    },
    strict: true,
  });
  if (values.base === undefined || values.out === undefined) {
    process.stderr.write("dumpPairs: --base and --out are required\n");
    process.exit(2);
  }
  return {
    base: values.base,
    head: values.head,
    repo: values.repo ?? process.cwd(),
    out: values.out,
  };
}

async function main(): Promise<number> {
  const args = parseCli(process.argv);
  const report = await runDetector({
    repoPath: args.repo,
    baseRef: args.base,
    headRef: args.head,
    threeDot: false,
    config: defaultConfig,
  });
  const pairs = groupsToPairs(report.groups).map((c) => ({
    key: `${c.left.filePath}:${String(c.left.startLine)}::${c.right.filePath}:${String(c.right.startLine)}`,
    left: c.left,
    right: c.right,
    scores: c.scores,
    evidence: c.evidence,
  }));
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, `${JSON.stringify(pairs, null, 2)}\n`, "utf-8");
  process.stderr.write(`wrote ${args.out} (${String(pairs.length)} pairs)\n`);
  return 0;
}

const isMain = import.meta.url === `file://${process.argv[1] ?? ""}`;
if (isMain) {
  main().then(
    (code) => {
      process.exit(code);
    },
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(`dumpPairs: ${msg}\n`);
      process.exit(1);
    },
  );
}
