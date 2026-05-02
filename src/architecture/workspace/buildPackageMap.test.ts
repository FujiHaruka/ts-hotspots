import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildPackageMap } from "./buildPackageMap.ts";

function writePackage(
  root: string,
  rel: string,
  body: Record<string, unknown>,
): void {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify(body));
}

describe("buildPackageMap", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ts-hotspots-pkgmap-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("indexes packages by name and lists them in sorted-root order", () => {
    writePackage(dir, "packages/foo", { name: "@scope/foo" });
    writePackage(dir, "packages/bar", { name: "@scope/bar" });

    const map = buildPackageMap({
      repoRoot: dir,
      packageRoots: ["packages/foo", "packages/bar"],
    });
    expect([...map.byName.keys()]).toEqual(["@scope/bar", "@scope/foo"]);
    expect(map.packages.map((p) => p.root)).toEqual([
      "packages/bar",
      "packages/foo",
    ]);
  });

  it("byFile resolves files via longest-root-prefix", () => {
    writePackage(dir, "apps/web", { name: "web" });
    writePackage(dir, "apps/web/internal", { name: "web-internal" });

    const map = buildPackageMap({
      repoRoot: dir,
      packageRoots: ["apps/web", "apps/web/internal"],
    });

    expect(map.byFile("apps/web/src/x.ts")?.name).toBe("web");
    expect(map.byFile("apps/web/internal/src/y.ts")?.name).toBe("web-internal");
    expect(map.byFile("apps/web/internal")?.name).toBe("web-internal");
    expect(map.byFile("apps/web")?.name).toBe("web");
  });

  it("byFile returns undefined for files outside any package root", () => {
    writePackage(dir, "packages/foo", { name: "foo" });
    const map = buildPackageMap({
      repoRoot: dir,
      packageRoots: ["packages/foo"],
    });
    expect(map.byFile("scripts/release.ts")).toBeUndefined();
  });

  it("does not match a sibling whose root happens to be a string prefix", () => {
    writePackage(dir, "apps/web", { name: "web" });
    writePackage(dir, "apps/webapp", { name: "webapp" });

    const map = buildPackageMap({
      repoRoot: dir,
      packageRoots: ["apps/web", "apps/webapp"],
    });
    expect(map.byFile("apps/webapp/src/x.ts")?.name).toBe("webapp");
    expect(map.byFile("apps/web/src/x.ts")?.name).toBe("web");
  });

  it("first-wins on duplicate package names (sorted root order)", () => {
    writePackage(dir, "a", { name: "duplicate" });
    writePackage(dir, "b", { name: "duplicate" });

    const map = buildPackageMap({
      repoRoot: dir,
      packageRoots: ["a", "b"],
    });
    expect(map.byName.get("duplicate")?.root).toBe("a");
    expect(map.packages).toHaveLength(1);
  });

  it("skips packages whose package.json fails to parse", () => {
    mkdirSync(join(dir, "packages/broken"), { recursive: true });
    writeFileSync(join(dir, "packages/broken/package.json"), "{ broken");
    writePackage(dir, "packages/ok", { name: "ok" });

    const map = buildPackageMap({
      repoRoot: dir,
      packageRoots: ["packages/broken", "packages/ok"],
    });
    expect(map.packages.map((p) => p.name)).toEqual(["ok"]);
  });
});
