/**
 * Shared streaming-error plumbing for the dup / arch subcommand surfaces.
 *
 * Both subcommands run the same agent-first markdown protocol: flush a
 * head before the heavy work, then either emit the body on success or
 * close the JSON fence with an error envelope on failure. The writers,
 * the `--format` sniffer, and the git/spawn tail of `classifyError`
 * were originally copy-pasted between `src/duplication/cli/main.ts` and
 * `src/architecture/cli/main.ts`; this module is the single owner.
 *
 * Per-subcommand pieces that legitimately differ — each subcommand's
 * own `ArgParseError` class, arch's `ArchConfigError` branch — stay at
 * the call site and prepend their checks before delegating to
 * `classifyGenericError` for the shared tail.
 */

import type { ReportFormat } from "../cli-defaults.ts";
import {
  type ReportFeature,
  renderJson,
  renderMarkdownErrorBody,
  renderMarkdownPreError,
} from "../reporter/render.ts";

export interface CliWritable {
  write: (chunk: string) => unknown;
}

export interface CliIO {
  stdout: CliWritable;
  stderr: CliWritable;
  cwd: () => string;
}

export interface CliTool {
  name: "ts-hotspots";
  version: string;
}

interface ErrorEnvelope {
  status: "error";
  tool: CliTool;
  error: { code: string; message: string };
}

/**
 * Bind the per-subcommand context (feature label + tool envelope) once
 * and return the two streaming-error writers. Keeping them as closures
 * lets call sites stay at five args (io, format, code, message, detail)
 * instead of leaking the constants through every catch block.
 *
 * `pre` runs before any markdown head has been flushed: JSON mode emits
 * the error envelope to stdout, Markdown mode emits the agent-first
 * pre-error block (heading + message), since there is no JSON fence to
 * close yet.
 *
 * `post` runs after the Markdown head has been flushed. JSON mode never
 * streams a head, so JSON callers should keep using `pre`; the markdown
 * branch closes the open JSON fence with the error envelope as its body
 * so the document remains parseable end-to-end.
 */
export function buildErrorWriters(feature: ReportFeature, tool: CliTool) {
  const buildReport = (code: string, message: string): ErrorEnvelope => ({
    status: "error",
    tool,
    error: { code, message },
  });

  return {
    pre(
      io: CliIO,
      format: ReportFormat,
      code: string,
      message: string,
      humanDetail: string,
    ): void {
      io.stdout.write(
        format === "json"
          ? renderJson(buildReport(code, message))
          : renderMarkdownPreError(feature, message),
      );
      io.stderr.write(`ts-hotspots ${feature}: ${humanDetail}\n`);
    },
    post(
      io: CliIO,
      format: ReportFormat,
      code: string,
      message: string,
      humanDetail: string,
    ): void {
      io.stdout.write(
        format === "json"
          ? renderJson(buildReport(code, message))
          : renderMarkdownErrorBody(buildReport(code, message)),
      );
      io.stderr.write(`ts-hotspots ${feature}: ${humanDetail}\n`);
    },
  };
}

/**
 * Best-effort `--format` extraction for the case where commander throws
 * before we have a parsed args object. We still want a `--format json`
 * caller to receive a JSON envelope on its arg-parse failure.
 */
export function sniffFormat(argv: readonly string[]): ReportFormat {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--format=json") return "json";
    if (a === "--format=markdown") return "markdown";
    if (a === "--format") {
      const next = argv[i + 1];
      if (next === "json") return "json";
      if (next === "markdown") return "markdown";
    }
  }
  return "markdown";
}

/**
 * Classify the git/spawn/unknown tail that's identical across
 * subcommands. Per-subcommand wrappers handle their own `ArgParseError`
 * (different class per subcommand) and any subcommand-specific branches
 * (e.g. arch's `ArchConfigError`) before delegating here.
 *
 * Heuristic mapping: detector failures bubble up `git`-flavoured
 * messages most of the time.
 */
export function classifyGenericError(err: unknown): {
  code: string;
  message: string;
} {
  const message = err instanceof Error ? err.message : String(err);
  if (message.startsWith("not in a git repository")) {
    return { code: "NOT_A_GIT_REPO", message };
  }
  if (/git/i.test(message) || /spawn/i.test(message)) {
    return { code: "GIT_FAILED", message };
  }
  return { code: "UNKNOWN_ERROR", message };
}
