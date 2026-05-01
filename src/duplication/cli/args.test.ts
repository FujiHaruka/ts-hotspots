import { describe, expect, it } from "vitest";
import { ArgParseError, parseCliArgs } from "./args.ts";

describe("parseCliArgs", () => {
  it("defaults to whole-repo mode at HEAD when no flags or positionals are given", () => {
    expect(parseCliArgs([])).toEqual({
      kind: "run",
      mode: "whole-repo",
      ref: "HEAD",
      path: undefined,
      format: "markdown",
      excludeGlobs: [],
      phaseTimings: undefined,
      limit: 20,
      verbose: false,
      churn: { enabled: true, window: 200, ref: undefined },
    });
  });

  it("parses --diff with a three-dot revrange and a positional [path]", () => {
    const r = parseCliArgs([
      "--diff",
      "origin/main...feature",
      "/tmp/x",
      "--format",
      "json",
    ]);
    expect(r).toEqual({
      kind: "run",
      mode: "diff",
      baseRef: "origin/main",
      headRef: "feature",
      threeDot: true,
      path: "/tmp/x",
      format: "json",
      excludeGlobs: [],
      phaseTimings: undefined,
      limit: 20,
      verbose: false,
      churn: { enabled: true, window: 200, ref: undefined },
    });
  });

  it("defaults format to markdown when --format is omitted", () => {
    const r = parseCliArgs(["--diff", "main..feature"]);
    if (r.kind !== "run" || r.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(r.format).toBe("markdown");
  });

  it("parses a two-dot revrange via --diff", () => {
    const r = parseCliArgs(["--diff", "main..feature"]);
    if (r.kind !== "run" || r.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(r.baseRef).toBe("main");
    expect(r.headRef).toBe("feature");
    expect(r.threeDot).toBe(false);
  });

  it("defaults the head side of A... to HEAD", () => {
    const r = parseCliArgs(["--diff", "origin/main..."]);
    if (r.kind !== "run" || r.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(r.baseRef).toBe("origin/main");
    expect(r.headRef).toBe("HEAD");
    expect(r.threeDot).toBe(true);
  });

  it("leaves path undefined when no positional [path] is given", () => {
    const r = parseCliArgs(["--diff", "main..feature"]);
    if (r.kind !== "run" || r.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(r.path).toBeUndefined();
  });

  it("returns help when --help is passed", () => {
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["-h"])).toEqual({ kind: "help" });
  });

  it("throws ArgParseError on a bare ref with no separator", () => {
    expect(() => parseCliArgs(["--diff", "main"])).toThrow(ArgParseError);
  });

  it("accepts a positional [path] in whole-repo mode", () => {
    const r = parseCliArgs(["/tmp/repo"]);
    if (r.kind !== "run" || r.mode !== "whole-repo") {
      throw new Error("expected whole-repo mode");
    }
    expect(r.path).toBe("/tmp/repo");
  });

  it("accepts a positional [path] alongside --diff", () => {
    const r = parseCliArgs(["--diff", "main..feature", "/tmp/repo"]);
    if (r.kind !== "run" || r.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(r.path).toBe("/tmp/repo");
  });

  it("throws ArgParseError when more than one positional is given", () => {
    expect(() => parseCliArgs(["/tmp/a", "/tmp/b"])).toThrow(ArgParseError);
    expect(() =>
      parseCliArgs(["--diff", "main..feature", "/tmp/a", "/tmp/b"]),
    ).toThrow(ArgParseError);
  });

  it("throws ArgParseError on unknown flags", () => {
    expect(() => parseCliArgs(["--nope"])).toThrow(ArgParseError);
  });

  it("throws ArgParseError on an unknown --format value", () => {
    expect(() => parseCliArgs(["--format", "yaml"])).toThrow(ArgParseError);
  });

  it("collects repeated --exclude flags into excludeGlobs", () => {
    const r = parseCliArgs([
      "--diff",
      "main..feature",
      "--exclude",
      "src/legacy/**",
      "--exclude",
      "**/*.gen.ts",
    ]);
    if (r.kind !== "run" || r.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(r.excludeGlobs).toEqual(["src/legacy/**", "**/*.gen.ts"]);
  });

  it("accepts -e as a short alias for --exclude", () => {
    const r = parseCliArgs([
      "--diff",
      "main..feature",
      "-e",
      "src/legacy/**",
      "-e",
      "**/*.gen.ts",
    ]);
    if (r.kind !== "run" || r.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(r.excludeGlobs).toEqual(["src/legacy/**", "**/*.gen.ts"]);
  });

  it("returns an empty excludeGlobs when --exclude is not passed", () => {
    const r = parseCliArgs([]);
    if (r.kind !== "run" || r.mode !== "whole-repo") {
      throw new Error("expected whole-repo mode");
    }
    expect(r.excludeGlobs).toEqual([]);
  });

  it("rejects an empty --exclude value", () => {
    expect(() => parseCliArgs(["--exclude", "  "])).toThrow(ArgParseError);
  });

  it("treats bare --phase-timings as level 'summary'", () => {
    const diff = parseCliArgs(["--diff", "main..feature", "--phase-timings"]);
    if (diff.kind !== "run" || diff.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(diff.phaseTimings).toBe("summary");

    const wr = parseCliArgs(["--phase-timings"]);
    if (wr.kind !== "run" || wr.mode !== "whole-repo") {
      throw new Error("expected whole-repo mode");
    }
    expect(wr.phaseTimings).toBe("summary");
  });

  it("accepts --phase-timings=verbose and --phase-timings verbose", () => {
    const eq = parseCliArgs([
      "--diff",
      "main..feature",
      "--phase-timings=verbose",
    ]);
    if (eq.kind !== "run" || eq.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(eq.phaseTimings).toBe("verbose");

    const space = parseCliArgs([
      "--diff",
      "main..feature",
      "--phase-timings",
      "verbose",
    ]);
    if (space.kind !== "run" || space.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(space.phaseTimings).toBe("verbose");
  });

  it("rejects invalid --phase-timings level", () => {
    expect(() =>
      parseCliArgs(["--diff", "main..feature", "--phase-timings=loud"]),
    ).toThrow(ArgParseError);
  });

  it("defaults phaseTimings to undefined", () => {
    const r = parseCliArgs(["--diff", "main..feature"]);
    if (r.kind !== "run" || r.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(r.phaseTimings).toBeUndefined();
  });

  it("uses --ref to pin the whole-repo scan to a non-HEAD ref", () => {
    const r = parseCliArgs(["--ref", "release/v2"]);
    if (r.kind !== "run" || r.mode !== "whole-repo") {
      throw new Error("expected whole-repo mode");
    }
    expect(r.ref).toBe("release/v2");
  });

  it("rejects --ref combined with --diff", () => {
    expect(() =>
      parseCliArgs(["--diff", "main..feature", "--ref", "abc"]),
    ).toThrow(ArgParseError);
  });

  it("parses --limit as a positive integer", () => {
    const r = parseCliArgs(["--diff", "main..feature", "--limit", "10"]);
    if (r.kind !== "run" || r.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(r.limit).toBe(10);
  });

  it("treats --limit all as no cap (POSITIVE_INFINITY)", () => {
    const r = parseCliArgs(["--diff", "main..feature", "--limit", "all"]);
    if (r.kind !== "run" || r.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(r.limit).toBe(Number.POSITIVE_INFINITY);
  });

  it("rejects --limit 0 (use 'all' instead for no cap)", () => {
    expect(() =>
      parseCliArgs(["--diff", "main..feature", "--limit", "0"]),
    ).toThrow(ArgParseError);
  });

  it("rejects negative --limit", () => {
    expect(() =>
      parseCliArgs(["--diff", "main..feature", "--limit", "-5"]),
    ).toThrow(ArgParseError);
  });

  it("rejects non-numeric --limit (other than 'all')", () => {
    expect(() =>
      parseCliArgs(["--diff", "main..feature", "--limit", "many"]),
    ).toThrow(ArgParseError);
  });

  it("--limit is also valid in whole-repo mode", () => {
    const r = parseCliArgs(["--limit", "200"]);
    if (r.kind !== "run" || r.mode !== "whole-repo") {
      throw new Error("expected whole-repo mode");
    }
    expect(r.limit).toBe(200);
  });

  it("defaults verbose to false", () => {
    const diff = parseCliArgs(["--diff", "main..feature"]);
    if (diff.kind !== "run" || diff.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(diff.verbose).toBe(false);

    const wr = parseCliArgs([]);
    if (wr.kind !== "run" || wr.mode !== "whole-repo") {
      throw new Error("expected whole-repo mode");
    }
    expect(wr.verbose).toBe(false);
  });

  it("sets verbose to true when --verbose is passed", () => {
    const diff = parseCliArgs(["--diff", "main..feature", "--verbose"]);
    if (diff.kind !== "run" || diff.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(diff.verbose).toBe(true);

    const wr = parseCliArgs(["--verbose"]);
    if (wr.kind !== "run" || wr.mode !== "whole-repo") {
      throw new Error("expected whole-repo mode");
    }
    expect(wr.verbose).toBe(true);
  });

  it("defaults churn to enabled with window 200 and undefined ref", () => {
    const diff = parseCliArgs(["--diff", "main..feature"]);
    if (diff.kind !== "run" || diff.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(diff.churn).toEqual({
      enabled: true,
      window: 200,
      ref: undefined,
    });

    const wr = parseCliArgs([]);
    if (wr.kind !== "run" || wr.mode !== "whole-repo") {
      throw new Error("expected whole-repo mode");
    }
    expect(wr.churn).toEqual({
      enabled: true,
      window: 200,
      ref: undefined,
    });
  });

  it("disables churn when --no-churn is passed", () => {
    const r = parseCliArgs(["--diff", "main..feature", "--no-churn"]);
    if (r.kind !== "run" || r.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(r.churn.enabled).toBe(false);
  });

  it("parses --churn-window as a positive integer", () => {
    const r = parseCliArgs([
      "--diff",
      "main..feature",
      "--churn-window",
      "50",
    ]);
    if (r.kind !== "run" || r.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(r.churn.window).toBe(50);
  });

  it("rejects --churn-window 0 and non-numeric values", () => {
    expect(() =>
      parseCliArgs(["--diff", "main..feature", "--churn-window", "0"]),
    ).toThrow(ArgParseError);
    expect(() =>
      parseCliArgs(["--diff", "main..feature", "--churn-window", "many"]),
    ).toThrow(ArgParseError);
  });

  it("parses --churn-ref as a string", () => {
    const r = parseCliArgs([
      "--diff",
      "main..feature",
      "--churn-ref",
      "origin/release",
    ]);
    if (r.kind !== "run" || r.mode !== "diff") {
      throw new Error("expected diff mode");
    }
    expect(r.churn.ref).toBe("origin/release");
  });

  it("rejects empty --churn-ref", () => {
    expect(() =>
      parseCliArgs(["--diff", "main..feature", "--churn-ref", "  "]),
    ).toThrow(ArgParseError);
  });
});
