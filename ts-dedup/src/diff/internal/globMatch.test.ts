import { describe, expect, it } from "vitest";
import { globToRegExp, matchesAnyGlob } from "./globMatch.ts";

describe("globToRegExp", () => {
  it("matches dist/** against nested files", () => {
    const re = globToRegExp("dist/**");
    expect(re.test("dist/a.js")).toBe(true);
    expect(re.test("dist/nested/b.ts")).toBe(true);
    expect(re.test("dist/a/b/c/d.ts")).toBe(true);
  });

  it("matches **/*.snap against any-depth .snap files", () => {
    const re = globToRegExp("**/*.snap");
    expect(re.test("a/b/c.snap")).toBe(true);
    expect(re.test("c.snap")).toBe(true);
    expect(re.test("x/y.snap")).toBe(true);
    expect(re.test("x/y.snapshot")).toBe(false);
  });

  it("does not match node_modules/** against paths outside node_modules", () => {
    const re = globToRegExp("node_modules/**");
    expect(re.test("src/a.ts")).toBe(false);
    expect(re.test("node_modules/foo/index.ts")).toBe(true);
  });

  it("single * does not cross path separators", () => {
    const re = globToRegExp("src/*.ts");
    expect(re.test("src/a.ts")).toBe(true);
    expect(re.test("src/nested/a.ts")).toBe(false);
  });

  it("? matches exactly one char within a segment", () => {
    const re = globToRegExp("a?.ts");
    expect(re.test("ab.ts")).toBe(true);
    expect(re.test("abc.ts")).toBe(false);
    expect(re.test("a/b.ts")).toBe(false);
  });
});

describe("matchesAnyGlob", () => {
  it("OR-matches across multiple globs", () => {
    const globs = ["dist/**", "**/*.snap", "node_modules/**"];
    expect(matchesAnyGlob("dist/a.js", globs)).toBe(true);
    expect(matchesAnyGlob("src/a/b.snap", globs)).toBe(true);
    expect(matchesAnyGlob("node_modules/foo/index.ts", globs)).toBe(true);
    expect(matchesAnyGlob("src/a.ts", globs)).toBe(false);
  });

  it("returns false when globs list is empty", () => {
    expect(matchesAnyGlob("src/a.ts", [])).toBe(false);
  });
});
