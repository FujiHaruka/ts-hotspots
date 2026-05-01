import { describe, expect, it } from "vitest";
import { ArgParseError, parseCliArgs } from "./args.ts";

describe("parseCliArgs", () => {
  it("parses a three-dot revrange with options and positional [path]", () => {
    const r = parseCliArgs([
      "origin/main...feature",
      "/tmp/x",
      "--format",
      "json",
    ]);
    expect(r).toEqual({
      kind: "run",
      mode: "pr",
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
    const r = parseCliArgs(["main..feature"]);
    if (r.kind !== "run" || r.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(r.format).toBe("markdown");
  });

  it("parses a two-dot revrange", () => {
    const r = parseCliArgs(["main..feature"]);
    if (r.kind !== "run" || r.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(r.baseRef).toBe("main");
    expect(r.headRef).toBe("feature");
    expect(r.threeDot).toBe(false);
  });

  it("defaults the head side of A... to HEAD", () => {
    const r = parseCliArgs(["origin/main..."]);
    if (r.kind !== "run" || r.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(r.baseRef).toBe("origin/main");
    expect(r.headRef).toBe("HEAD");
    expect(r.threeDot).toBe(true);
  });

  it("leaves path undefined when no positional [path] is given", () => {
    const r = parseCliArgs(["main..feature"]);
    if (r.kind !== "run" || r.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(r.path).toBeUndefined();
  });

  it("returns help when --help is passed", () => {
    expect(parseCliArgs(["--help"])).toEqual({ kind: "help" });
    expect(parseCliArgs(["-h"])).toEqual({ kind: "help" });
  });

  it("throws ArgParseError when the revrange is missing", () => {
    expect(() => parseCliArgs([])).toThrow(ArgParseError);
  });

  it("throws ArgParseError on a bare ref with no separator", () => {
    expect(() => parseCliArgs(["main"])).toThrow(ArgParseError);
  });

  it("accepts a second positional as [path]", () => {
    const r = parseCliArgs(["main..feature", "/tmp/repo"]);
    if (r.kind !== "run" || r.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(r.path).toBe("/tmp/repo");
  });

  it("throws ArgParseError when more than two positionals are given", () => {
    expect(() => parseCliArgs(["main..feature", "/tmp/repo", "extra"])).toThrow(
      ArgParseError,
    );
  });

  it("throws ArgParseError on unknown flags", () => {
    expect(() => parseCliArgs(["main..feature", "--nope"])).toThrow(
      ArgParseError,
    );
  });

  it("throws ArgParseError on an unknown --format value", () => {
    expect(() => parseCliArgs(["main..feature", "--format", "yaml"])).toThrow(
      ArgParseError,
    );
  });

  it("collects repeated --exclude flags into excludeGlobs", () => {
    const r = parseCliArgs([
      "main..feature",
      "--exclude",
      "src/legacy/**",
      "--exclude",
      "**/*.gen.ts",
    ]);
    if (r.kind !== "run" || r.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(r.excludeGlobs).toEqual(["src/legacy/**", "**/*.gen.ts"]);
  });

  it("returns an empty excludeGlobs when --exclude is not passed", () => {
    const r = parseCliArgs(["main..feature"]);
    if (r.kind !== "run" || r.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(r.excludeGlobs).toEqual([]);
  });

  it("rejects an empty --exclude value", () => {
    expect(() => parseCliArgs(["main..feature", "--exclude", "  "])).toThrow(
      ArgParseError,
    );
  });

  it("returns whole-repo mode when --whole-repo is passed", () => {
    const r = parseCliArgs(["--whole-repo"]);
    expect(r).toEqual({
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

  it("accepts a positional [path] in whole-repo mode", () => {
    const r = parseCliArgs(["--whole-repo", "/tmp/repo"]);
    if (r.kind !== "run" || r.mode !== "whole-repo") {
      throw new Error("expected whole-repo mode");
    }
    expect(r.path).toBe("/tmp/repo");
  });

  it("treats bare --phase-timings as level 'summary'", () => {
    const pr = parseCliArgs(["main..feature", "--phase-timings"]);
    if (pr.kind !== "run" || pr.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(pr.phaseTimings).toBe("summary");

    const wr = parseCliArgs(["--whole-repo", "--phase-timings"]);
    if (wr.kind !== "run" || wr.mode !== "whole-repo") {
      throw new Error("expected whole-repo mode");
    }
    expect(wr.phaseTimings).toBe("summary");
  });

  it("accepts --phase-timings=verbose and --phase-timings verbose", () => {
    const eq = parseCliArgs(["main..feature", "--phase-timings=verbose"]);
    if (eq.kind !== "run" || eq.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(eq.phaseTimings).toBe("verbose");

    const space = parseCliArgs(["main..feature", "--phase-timings", "verbose"]);
    if (space.kind !== "run" || space.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(space.phaseTimings).toBe("verbose");
  });

  it("rejects invalid --phase-timings level", () => {
    expect(() =>
      parseCliArgs(["main..feature", "--phase-timings=loud"]),
    ).toThrow(ArgParseError);
  });

  it("defaults phaseTimings to undefined", () => {
    const pr = parseCliArgs(["main..feature"]);
    if (pr.kind !== "run" || pr.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(pr.phaseTimings).toBeUndefined();
  });

  it("uses --ref when given alongside --whole-repo", () => {
    const r = parseCliArgs(["--whole-repo", "--ref", "release/v2"]);
    if (r.kind !== "run" || r.mode !== "whole-repo") {
      throw new Error("expected whole-repo mode");
    }
    expect(r.ref).toBe("release/v2");
  });

  it("rejects more than one positional alongside --whole-repo", () => {
    expect(() => parseCliArgs(["--whole-repo", "/tmp/a", "/tmp/b"])).toThrow(
      ArgParseError,
    );
  });

  it("rejects --ref without --whole-repo", () => {
    expect(() => parseCliArgs(["main..feature", "--ref", "abc"])).toThrow(
      ArgParseError,
    );
  });

  it("hints --whole-repo in the missing-revrange error message", () => {
    try {
      parseCliArgs([]);
      throw new Error("expected ArgParseError");
    } catch (err) {
      expect(err).toBeInstanceOf(ArgParseError);
      expect((err as Error).message).toContain("--whole-repo");
    }
  });

  it("parses --limit as a positive integer", () => {
    const r = parseCliArgs(["main..feature", "--limit", "10"]);
    if (r.kind !== "run" || r.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(r.limit).toBe(10);
  });

  it("treats --limit all as no cap (POSITIVE_INFINITY)", () => {
    const r = parseCliArgs(["main..feature", "--limit", "all"]);
    if (r.kind !== "run" || r.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(r.limit).toBe(Number.POSITIVE_INFINITY);
  });

  it("rejects --limit 0 (use 'all' instead for no cap)", () => {
    expect(() => parseCliArgs(["main..feature", "--limit", "0"])).toThrow(
      ArgParseError,
    );
  });

  it("rejects negative --limit", () => {
    expect(() => parseCliArgs(["main..feature", "--limit", "-5"])).toThrow(
      ArgParseError,
    );
  });

  it("rejects non-numeric --limit (other than 'all')", () => {
    expect(() => parseCliArgs(["main..feature", "--limit", "many"])).toThrow(
      ArgParseError,
    );
  });

  it("--limit is also valid in whole-repo mode", () => {
    const r = parseCliArgs(["--whole-repo", "--limit", "200"]);
    if (r.kind !== "run" || r.mode !== "whole-repo") {
      throw new Error("expected whole-repo mode");
    }
    expect(r.limit).toBe(200);
  });

  it("defaults verbose to false", () => {
    const pr = parseCliArgs(["main..feature"]);
    if (pr.kind !== "run" || pr.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(pr.verbose).toBe(false);

    const wr = parseCliArgs(["--whole-repo"]);
    if (wr.kind !== "run" || wr.mode !== "whole-repo") {
      throw new Error("expected whole-repo mode");
    }
    expect(wr.verbose).toBe(false);
  });

  it("sets verbose to true when --verbose is passed", () => {
    const pr = parseCliArgs(["main..feature", "--verbose"]);
    if (pr.kind !== "run" || pr.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(pr.verbose).toBe(true);

    const wr = parseCliArgs(["--whole-repo", "--verbose"]);
    if (wr.kind !== "run" || wr.mode !== "whole-repo") {
      throw new Error("expected whole-repo mode");
    }
    expect(wr.verbose).toBe(true);
  });

  it("defaults churn to enabled with window 200 and undefined ref", () => {
    const pr = parseCliArgs(["main..feature"]);
    if (pr.kind !== "run" || pr.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(pr.churn).toEqual({
      enabled: true,
      window: 200,
      ref: undefined,
    });

    const wr = parseCliArgs(["--whole-repo"]);
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
    const r = parseCliArgs(["main..feature", "--no-churn"]);
    if (r.kind !== "run" || r.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(r.churn.enabled).toBe(false);
  });

  it("parses --churn-window as a positive integer", () => {
    const r = parseCliArgs(["main..feature", "--churn-window", "50"]);
    if (r.kind !== "run" || r.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(r.churn.window).toBe(50);
  });

  it("rejects --churn-window 0 and non-numeric values", () => {
    expect(() =>
      parseCliArgs(["main..feature", "--churn-window", "0"]),
    ).toThrow(ArgParseError);
    expect(() =>
      parseCliArgs(["main..feature", "--churn-window", "many"]),
    ).toThrow(ArgParseError);
  });

  it("parses --churn-ref as a string", () => {
    const r = parseCliArgs([
      "main..feature",
      "--churn-ref",
      "origin/release",
    ]);
    if (r.kind !== "run" || r.mode !== "pr") {
      throw new Error("expected pr mode");
    }
    expect(r.churn.ref).toBe("origin/release");
  });

  it("rejects empty --churn-ref", () => {
    expect(() =>
      parseCliArgs(["main..feature", "--churn-ref", "  "]),
    ).toThrow(ArgParseError);
  });
});
