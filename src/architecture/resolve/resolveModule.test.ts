import { describe, expect, it } from "vitest";
import { resolveModule } from "./resolveModule.ts";
import { parseTsconfigResolution } from "./tsconfigPaths.ts";

function fromFiles(...paths: string[]): ReadonlySet<string> {
  return new Set(paths);
}

describe("resolveModule — relative imports", () => {
  it("resolves a sibling file with explicit extension", () => {
    const known = fromFiles("src/a.ts", "src/b.ts");
    expect(resolveModule("./b.ts", "src/a.ts", { knownFiles: known })).toBe(
      "src/b.ts",
    );
  });

  it("appends .ts when the import omits the extension", () => {
    const known = fromFiles("src/a.ts", "src/b.ts");
    expect(resolveModule("./b", "src/a.ts", { knownFiles: known })).toBe(
      "src/b.ts",
    );
  });

  it("prefers .ts over .tsx when both exist", () => {
    const known = fromFiles("src/a.ts", "src/b.ts", "src/b.tsx");
    expect(resolveModule("./b", "src/a.ts", { knownFiles: known })).toBe(
      "src/b.ts",
    );
  });

  it("falls back to .tsx when only the .tsx variant exists", () => {
    const known = fromFiles("src/a.ts", "src/Comp.tsx");
    expect(resolveModule("./Comp", "src/a.ts", { knownFiles: known })).toBe(
      "src/Comp.tsx",
    );
  });

  it("resolves a directory import to index.ts", () => {
    const known = fromFiles("src/a.ts", "src/lib/index.ts");
    expect(resolveModule("./lib", "src/a.ts", { knownFiles: known })).toBe(
      "src/lib/index.ts",
    );
  });

  it("resolves a directory import to index.tsx when only tsx exists", () => {
    const known = fromFiles("src/a.ts", "src/lib/index.tsx");
    expect(resolveModule("./lib", "src/a.ts", { knownFiles: known })).toBe(
      "src/lib/index.tsx",
    );
  });

  it("walks parents with ../", () => {
    const known = fromFiles("src/a/b/x.ts", "src/a/y.ts");
    expect(resolveModule("../y", "src/a/b/x.ts", { knownFiles: known })).toBe(
      "src/a/y.ts",
    );
  });

  it("returns null when the target is not a known file", () => {
    const known = fromFiles("src/a.ts");
    expect(resolveModule("./missing", "src/a.ts", { knownFiles: known })).toBe(
      null,
    );
  });
});

describe("resolveModule — bare specifiers", () => {
  it("returns null for unmapped bare imports (node_modules etc.)", () => {
    const known = fromFiles("src/a.ts");
    expect(resolveModule("react", "src/a.ts", { knownFiles: known })).toBe(
      null,
    );
    expect(
      resolveModule("@scope/pkg", "src/a.ts", { knownFiles: known }),
    ).toBe(null);
  });
});

describe("resolveModule — tsconfig paths", () => {
  it("resolves a wildcard mapping", () => {
    const tsconfig = parseTsconfigResolution({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
    });
    const known = fromFiles("src/a.ts", "src/feature/foo.ts");
    expect(
      resolveModule("@/feature/foo", "src/a.ts", {
        knownFiles: known,
        tsconfig,
      }),
    ).toBe("src/feature/foo.ts");
  });

  it("resolves an exact (no-wildcard) mapping", () => {
    const tsconfig = parseTsconfigResolution({
      compilerOptions: { paths: { app: ["src/app/index.ts"] } },
    });
    const known = fromFiles("src/x.ts", "src/app/index.ts");
    expect(
      resolveModule("app", "src/x.ts", { knownFiles: known, tsconfig }),
    ).toBe("src/app/index.ts");
  });

  it("falls back through the target list and stops at the first hit", () => {
    const tsconfig = parseTsconfigResolution({
      compilerOptions: {
        paths: { "~/*": ["src/missing/*", "src/real/*"] },
      },
    });
    const known = fromFiles("src/a.ts", "src/real/foo.ts");
    expect(
      resolveModule("~/foo", "src/a.ts", { knownFiles: known, tsconfig }),
    ).toBe("src/real/foo.ts");
  });

  it("prefers the longer pattern when both match", () => {
    const tsconfig = parseTsconfigResolution({
      compilerOptions: {
        paths: {
          "@/*": ["src/*"],
          "@/feature/*": ["src/feature-impl/*"],
        },
      },
    });
    const known = fromFiles(
      "src/a.ts",
      "src/feature-impl/foo.ts",
      "src/feature/foo.ts",
    );
    expect(
      resolveModule("@/feature/foo", "src/a.ts", {
        knownFiles: known,
        tsconfig,
      }),
    ).toBe("src/feature-impl/foo.ts");
  });

  it("respects baseUrl when joining replacements", () => {
    const tsconfig = parseTsconfigResolution({
      compilerOptions: { baseUrl: "src", paths: { "@/*": ["*"] } },
    });
    const known = fromFiles("src/a.ts", "src/foo/bar.ts");
    expect(
      resolveModule("@/foo/bar", "src/a.ts", {
        knownFiles: known,
        tsconfig,
      }),
    ).toBe("src/foo/bar.ts");
  });

  it("returns null when a matched pattern's targets all miss", () => {
    const tsconfig = parseTsconfigResolution({
      compilerOptions: { paths: { "@/*": ["src/missing/*"] } },
    });
    const known = fromFiles("src/a.ts");
    expect(
      resolveModule("@/foo", "src/a.ts", { knownFiles: known, tsconfig }),
    ).toBe(null);
  });
});
