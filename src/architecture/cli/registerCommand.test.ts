import { Command, CommanderError } from "commander";
import { describe, expect, it } from "vitest";
import { normalizePhaseTimingsArgv } from "../../duplication/cli/registerCommand.ts";
import type { ArchParsedArgs } from "./args.ts";
import { addArchitectureCommand } from "./registerCommand.ts";

function parse(argv: readonly string[]): ArchParsedArgs {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeOut: () => {},
    writeErr: () => {},
  });
  let captured: ArchParsedArgs | undefined;
  addArchitectureCommand(program, (args) => {
    captured = args;
  });
  program.parse([
    "node",
    "ts-hotspots",
    "architecture",
    ...normalizePhaseTimingsArgv(argv),
  ]);
  if (captured === undefined) throw new Error("action did not run");
  return captured;
}

function tryParse(argv: readonly string[]): { ok: true; args: ArchParsedArgs } | { ok: false; err: unknown } {
  try {
    return { ok: true, args: parse(argv) };
  } catch (err) {
    return { ok: false, err };
  }
}

describe("addArchitectureCommand — defaults", () => {
  it("populates sane defaults", () => {
    const args = parse([]);
    expect(args.kind).toBe("run");
    expect(args.format).toBe("markdown");
    expect(args.limit).toBe(20);
    expect(args.includeTests).toBe(false);
    expect(args.includeTypes).toBe(true);
    expect(args.ref).toBeUndefined();
    expect(args.diff).toBeUndefined();
    expect(args.phaseTimings).toBeUndefined();
  });
});

describe("addArchitectureCommand — flag parsing", () => {
  it("--no-include-types flips includeTypes off", () => {
    const args = parse(["--no-include-types"]);
    expect(args.includeTypes).toBe(false);
  });

  it("--include-tests flips includeTests on", () => {
    const args = parse(["--include-tests"]);
    expect(args.includeTests).toBe(true);
  });

  it("--limit all → POSITIVE_INFINITY", () => {
    const args = parse(["--limit", "all"]);
    expect(args.limit).toBe(Number.POSITIVE_INFINITY);
  });

  it("--limit accepts positive integers", () => {
    const args = parse(["--limit", "50"]);
    expect(args.limit).toBe(50);
  });

  it("--limit 0 is rejected", () => {
    const result = tryParse(["--limit", "0"]);
    expect(result.ok).toBe(false);
  });

  it("--diff parses revrange", () => {
    const args = parse(["--diff", "origin/main..."]);
    expect(args.diff).toEqual({
      baseRef: "origin/main",
      headRef: "HEAD",
      threeDot: true,
    });
  });

  it("--ref and --diff coexist", () => {
    const args = parse(["--ref", "release/v2", "--diff", "origin/main..."]);
    expect(args.ref).toBe("release/v2");
    expect(args.diff?.baseRef).toBe("origin/main");
  });

  it("--phase-timings (bare) defaults to summary", () => {
    const args = parse(["--phase-timings"]);
    expect(args.phaseTimings).toBe("summary");
  });

  it("--phase-timings=verbose", () => {
    const args = parse(["--phase-timings=verbose"]);
    expect(args.phaseTimings).toBe("verbose");
  });

  it("repeatable -e collects globs", () => {
    const args = parse(["-e", "src/legacy/**", "-e", "**/*.gen.ts"]);
    expect(args.excludeGlobs).toEqual(["src/legacy/**", "**/*.gen.ts"]);
  });

  it("rejects unknown flags via commander", () => {
    const result = tryParse(["--unknown-flag"]);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.err).toBeInstanceOf(CommanderError);
    }
  });
});

describe("addArchitectureCommand — positional", () => {
  it("captures the [path] positional", () => {
    const args = parse(["./repos/my-app"]);
    expect(args.path).toBe("./repos/my-app");
  });
});
