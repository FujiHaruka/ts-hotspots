import { describe, expect, it } from "vitest";
import { parseExportsField } from "../workspace/exportsMap.ts";
import type { PackageInfo, PackageMap } from "../workspace/types.ts";
import { resolveModule } from "./resolveModule.ts";
import { parseTsconfigResolution } from "./tsconfigPaths.ts";

function fromFiles(...paths: string[]): ReadonlySet<string> {
  return new Set(paths);
}

function pkg(
  name: string,
  root: string,
  opts: {
    exports?: unknown;
    main?: string;
  } = {},
): PackageInfo {
  return {
    name,
    root,
    exportsMap:
      opts.exports === undefined ? null : parseExportsField(opts.exports),
    mainTarget: opts.main ?? null,
    tsconfigPath: null,
    tsconfig: null,
  };
}

function makePackageMap(...packages: PackageInfo[]): PackageMap {
  const byName = new Map<string, PackageInfo>();
  for (const p of packages) byName.set(p.name, p);
  const sorted = [...packages].sort((a, b) => b.root.length - a.root.length);
  const byFile = (file: string): PackageInfo | undefined => {
    for (const p of sorted) {
      if (file === p.root) return p;
      if (file.startsWith(`${p.root}/`)) return p;
    }
    return undefined;
  };
  return { byName, byFile, packages: [...packages] };
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
    expect(resolveModule("@scope/pkg", "src/a.ts", { knownFiles: known })).toBe(
      null,
    );
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

describe("resolveModule — workspace package", () => {
  it("resolves @scope/foo (subpath empty → '.') via exports map", () => {
    const packageMap = makePackageMap(
      pkg("@scope/foo", "packages/foo", {
        exports: { ".": "./src/index.ts" },
      }),
    );
    const known = fromFiles("packages/foo/src/index.ts", "src/a.ts");
    expect(
      resolveModule("@scope/foo", "src/a.ts", {
        knownFiles: known,
        packageMap,
      }),
    ).toBe("packages/foo/src/index.ts");
  });

  it("resolves @scope/foo/client via explicit subpath in exports", () => {
    const packageMap = makePackageMap(
      pkg("@scope/foo", "packages/foo", {
        exports: { "./client": "./src/client.ts" },
      }),
    );
    const known = fromFiles("packages/foo/src/client.ts", "src/a.ts");
    expect(
      resolveModule("@scope/foo/client", "src/a.ts", {
        knownFiles: known,
        packageMap,
      }),
    ).toBe("packages/foo/src/client.ts");
  });

  it("resolves wildcard exports (single * substitution)", () => {
    const packageMap = makePackageMap(
      pkg("@scope/foo", "packages/foo", {
        exports: { "./sub/*": "./src/sub/*.ts" },
      }),
    );
    const known = fromFiles("packages/foo/src/sub/x.ts", "src/a.ts");
    expect(
      resolveModule("@scope/foo/sub/x", "src/a.ts", {
        knownFiles: known,
        packageMap,
      }),
    ).toBe("packages/foo/src/sub/x.ts");
  });

  it("returns null when exports is declared but subpath is unmatched (E12)", () => {
    const packageMap = makePackageMap(
      pkg("@scope/foo", "packages/foo", {
        exports: { "./client": "./src/client.ts" },
      }),
    );
    const known = fromFiles(
      "packages/foo/src/client.ts",
      "packages/foo/src/missing.ts",
      "src/a.ts",
    );
    expect(
      resolveModule("@scope/foo/missing", "src/a.ts", {
        knownFiles: known,
        packageMap,
      }),
    ).toBe(null);
  });

  it("falls back to package.json#main when exports is absent (subpath empty)", () => {
    const packageMap = makePackageMap(
      pkg("@scope/foo", "packages/foo", {
        main: "packages/foo/src/index.ts",
      }),
    );
    const known = fromFiles("packages/foo/src/index.ts", "src/a.ts");
    expect(
      resolveModule("@scope/foo", "src/a.ts", {
        knownFiles: known,
        packageMap,
      }),
    ).toBe("packages/foo/src/index.ts");
  });

  it("legacy-probes <root>/<subpath>.ts when exports is absent", () => {
    const packageMap = makePackageMap(pkg("@scope/foo", "packages/foo"));
    const known = fromFiles("packages/foo/util.ts", "src/a.ts");
    expect(
      resolveModule("@scope/foo/util", "src/a.ts", {
        knownFiles: known,
        packageMap,
      }),
    ).toBe("packages/foo/util.ts");
  });

  it("legacy probing returns null when no extension/index variant exists", () => {
    const packageMap = makePackageMap(pkg("@scope/foo", "packages/foo"));
    const known = fromFiles("packages/foo/util.ts", "src/a.ts");
    expect(
      resolveModule("@scope/foo/missing", "src/a.ts", {
        knownFiles: known,
        packageMap,
      }),
    ).toBe(null);
  });

  it("self-referential import resolves through the same package's exports", () => {
    const packageMap = makePackageMap(
      pkg("@scope/foo", "packages/foo", {
        exports: { "./util": "./src/util.ts" },
      }),
    );
    const known = fromFiles(
      "packages/foo/src/util.ts",
      "packages/foo/src/x.ts",
    );
    expect(
      resolveModule("@scope/foo/util", "packages/foo/src/x.ts", {
        knownFiles: known,
        packageMap,
      }),
    ).toBe("packages/foo/src/util.ts");
  });

  it("tsconfig.paths overrides workspace package matches with the same prefix", () => {
    const packageMap = makePackageMap(
      pkg("@scope/foo", "packages/foo", {
        exports: { ".": "./src/index.ts" },
      }),
    );
    const tsconfig = parseTsconfigResolution({
      compilerOptions: { paths: { "@scope/foo": ["src/local-override.ts"] } },
    });
    const known = fromFiles(
      "packages/foo/src/index.ts",
      "src/local-override.ts",
      "src/a.ts",
    );
    expect(
      resolveModule("@scope/foo", "src/a.ts", {
        knownFiles: known,
        tsconfig,
        packageMap,
      }),
    ).toBe("src/local-override.ts");
  });

  it("falls through to workspace resolution when paths matched but targets miss", () => {
    // tsconfig.paths is a soft override — when the matched pattern's
    // targets don't hit a known file, resolution continues to the
    // workspace branch. This mirrors TS's Bundler resolver, which
    // doesn't lock in a matched paths pattern to a hard miss.
    const packageMap = makePackageMap(
      pkg("@scope/foo", "packages/foo", {
        exports: { ".": "./src/index.ts" },
      }),
    );
    const tsconfig = parseTsconfigResolution({
      compilerOptions: { paths: { "@scope/foo": ["src/missing.ts"] } },
    });
    const known = fromFiles("packages/foo/src/index.ts", "src/a.ts");
    expect(
      resolveModule("@scope/foo", "src/a.ts", {
        knownFiles: known,
        tsconfig,
        packageMap,
      }),
    ).toBe("packages/foo/src/index.ts");
  });

  it("non-package specifier (e.g. node_modules-only) returns null", () => {
    const packageMap = makePackageMap(pkg("@scope/foo", "packages/foo"));
    const known = fromFiles("packages/foo/src/index.ts", "src/a.ts");
    expect(
      resolveModule("react", "src/a.ts", { knownFiles: known, packageMap }),
    ).toBe(null);
  });
});

describe("resolveModule — per-package tsconfig (M3)", () => {
  function pkgWithTsconfig(
    name: string,
    root: string,
    paths: Record<string, string[]>,
  ): PackageInfo {
    return {
      name,
      root,
      exportsMap: null,
      mainTarget: null,
      tsconfigPath: `${root}/tsconfig.json`,
      tsconfig: parseTsconfigResolution({
        compilerOptions: { baseUrl: ".", paths },
      }),
    };
  }

  it("uses the importing file's package tsconfig for `paths`", () => {
    const fooPkg = pkgWithTsconfig("@scope/foo", "packages/foo", {
      "~/*": ["packages/foo/src/*"],
    });
    const packageMap = makePackageMap(fooPkg);
    const known = fromFiles(
      "packages/foo/src/x.ts",
      "packages/foo/src/util.ts",
    );
    expect(
      resolveModule("~/util", "packages/foo/src/x.ts", {
        knownFiles: known,
        packageMap,
      }),
    ).toBe("packages/foo/src/util.ts");
  });

  it("does not leak one package's `~/*` alias into another package", () => {
    const fooPkg = pkgWithTsconfig("@scope/foo", "packages/foo", {
      "~/*": ["packages/foo/src/*"],
    });
    const barPkg: PackageInfo = {
      name: "@scope/bar",
      root: "packages/bar",
      exportsMap: null,
      mainTarget: null,
      tsconfigPath: null,
      tsconfig: null,
    };
    const packageMap = makePackageMap(fooPkg, barPkg);
    const known = fromFiles(
      "packages/foo/src/util.ts",
      "packages/bar/src/x.ts",
    );
    // Importer is in @scope/bar — its tsconfig is null, root tsconfig
    // is also undefined → no path mapping fires, `~/util` returns null.
    expect(
      resolveModule("~/util", "packages/bar/src/x.ts", {
        knownFiles: known,
        packageMap,
      }),
    ).toBe(null);
  });

  it("falls back to root tsconfig when the file is outside any package", () => {
    const rootTsconfig = parseTsconfigResolution({
      compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } },
    });
    const packageMap = makePackageMap(
      pkgWithTsconfig("@scope/foo", "packages/foo", {
        "~/*": ["packages/foo/src/*"],
      }),
    );
    const known = fromFiles("src/util.ts", "scripts/release.ts");
    // `scripts/release.ts` doesn't belong to any package → root tsconfig
    // applies.
    expect(
      resolveModule("@/util", "scripts/release.ts", {
        knownFiles: known,
        tsconfig: rootTsconfig,
        packageMap,
      }),
    ).toBe("src/util.ts");
  });

  it("yields no mappings when neither package nor root tsconfig has any", () => {
    const packageMap = makePackageMap(pkg("@scope/foo", "packages/foo"));
    const known = fromFiles("packages/foo/src/x.ts", "packages/foo/src/y.ts");
    expect(
      resolveModule("@/y", "packages/foo/src/x.ts", {
        knownFiles: known,
        packageMap,
      }),
    ).toBe(null);
  });
});
