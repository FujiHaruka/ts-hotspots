import { describe, expect, test } from "vitest";
import { run } from "./cli.ts";

class StringSink {
  chunks: string[] = [];
  write(chunk: string): void {
    this.chunks.push(chunk);
  }
  get text(): string {
    return this.chunks.join("");
  }
}

const ARGV = ["node", "ts-hotspots"];

/**
 * M1 alignment guard. Each test pairs a `comp` and `dup` invocation that
 * exercise the same flag, asserting they fail (or succeed) the same way.
 * The assertions intentionally stay shallow — full-feature behaviour lives
 * in the per-subcommand test files; this file only locks in that the two
 * subcommands speak the same vocabulary.
 */
describe("cross-CLI flag vocabulary", () => {
  test("both subcommands reject --format yaml at parse time", async () => {
    const compStderr = new StringSink();
    const compCode = await run(
      [...ARGV, "comp", "/nonexistent", "--format", "yaml"],
      new StringSink(),
      compStderr,
    );
    expect(compCode).toBe(1);
    expect(compStderr.text).toContain("--format");

    const dupStderr = new StringSink();
    const dupCode = await run(
      [...ARGV, "dup", "main..feature", "--format", "yaml"],
      new StringSink(),
      dupStderr,
    );
    expect(dupCode).toBe(1);
    expect(dupStderr.text).toContain("--format");
  });

  test("both subcommands reject --limit foo with a similar error", async () => {
    const compStderr = new StringSink();
    const compCode = await run(
      [...ARGV, "comp", "/nonexistent", "--limit", "foo"],
      new StringSink(),
      compStderr,
    );
    expect(compCode).toBe(1);
    expect(compStderr.text).toContain("--limit");

    const dupStderr = new StringSink();
    const dupCode = await run(
      [...ARGV, "dup", "main..feature", "--limit", "foo"],
      new StringSink(),
      dupStderr,
    );
    expect(dupCode).toBe(1);
    expect(dupStderr.text).toContain("--limit");
  });

  test("both subcommands accept --limit all without parse error", async () => {
    // Validates parse-stage acceptance only — we expect non-zero exit
    // because the path arguments resolve to an invalid project / git root,
    // but the failure must happen *after* arg parsing.
    const compStderr = new StringSink();
    const compCode = await run(
      [...ARGV, "comp", "/nonexistent", "--limit", "all"],
      new StringSink(),
      compStderr,
    );
    expect(compCode).toBe(1);
    expect(compStderr.text).not.toContain("--limit");

    const dupStderr = new StringSink();
    const dupCode = await run(
      [...ARGV, "dup", "main..feature", "/nonexistent", "--limit", "all"],
      new StringSink(),
      dupStderr,
    );
    expect(dupCode).toBe(1);
    expect(dupStderr.text).not.toContain("--limit");
  });

  test("both subcommands no longer accept --json or --repo", async () => {
    const compStderr = new StringSink();
    const compCode = await run(
      [...ARGV, "comp", "--json"],
      new StringSink(),
      compStderr,
    );
    expect(compCode).toBe(1);
    expect(compStderr.text.toLowerCase()).toContain("unknown option");

    const dupStderr = new StringSink();
    const dupCode = await run(
      [...ARGV, "dup", "main..feature", "--repo", "/tmp"],
      new StringSink(),
      dupStderr,
    );
    expect(dupCode).toBe(1);
    expect(dupStderr.text.toLowerCase()).toContain("unknown option");
  });
});
