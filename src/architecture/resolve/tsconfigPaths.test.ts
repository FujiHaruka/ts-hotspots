import { describe, expect, it } from "vitest";
import { parseTsconfigResolution } from "./tsconfigPaths.ts";

describe("parseTsconfigResolution", () => {
  it("falls back to baseUrl='.' when not set", () => {
    expect(parseTsconfigResolution({})).toEqual({
      baseUrl: ".",
      mappings: [],
    });
  });

  it("normalizes baseUrl by stripping trailing slashes", () => {
    expect(
      parseTsconfigResolution({ compilerOptions: { baseUrl: "src/" } }).baseUrl,
    ).toBe("src");
  });

  it("returns mappings sorted by pattern length (longest first)", () => {
    const result = parseTsconfigResolution({
      compilerOptions: {
        paths: {
          "@/*": ["src/*"],
          "@/feature/*": ["src/feature-impl/*"],
          app: ["src/app/index.ts"],
        },
      },
    });
    expect(result.mappings.map((m) => m.pattern)).toEqual([
      "@/feature/*",
      "@/*",
      "app",
    ]);
  });

  it("ignores mappings whose targets array is empty or non-string", () => {
    const result = parseTsconfigResolution({
      compilerOptions: {
        paths: {
          "ok/*": ["src/*"],
          "skip-empty/*": [],
          // biome-ignore lint/suspicious/noExplicitAny: malformed input fixture
          "skip-nonstring/*": [123 as unknown as string],
          // biome-ignore lint/suspicious/noExplicitAny: malformed input fixture
          "skip-nonarray/*": "src/*" as unknown as string[],
        },
      },
    });
    expect(result.mappings.map((m) => m.pattern)).toEqual(["ok/*"]);
  });

  it("collapses missing compilerOptions to the empty resolution", () => {
    expect(parseTsconfigResolution({})).toEqual({
      baseUrl: ".",
      mappings: [],
    });
  });
});
