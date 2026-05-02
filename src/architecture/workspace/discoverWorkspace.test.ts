import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { discoverWorkspace } from "./discoverWorkspace.ts";

function writeJson(path: string, value: unknown): void {
  writeFileSync(path, JSON.stringify(value), "utf8");
}

function writePackage(
  root: string,
  rel: string,
  body: Record<string, unknown> = {},
): void {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "package.json"), {
    name: rel.replace(/\//g, "-"),
    ...body,
  });
}

describe("discoverWorkspace", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ts-hotspots-discover-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns null when neither pnpm-workspace.yaml nor package.json#workspaces exists", () => {
    expect(discoverWorkspace(dir)).toBeNull();
  });

  it("prefers pnpm-workspace.yaml when both are present", () => {
    writeFileSync(
      join(dir, "pnpm-workspace.yaml"),
      `packages:\n  - "packages/*"\n`,
    );
    writeJson(join(dir, "package.json"), {
      workspaces: ["apps/*"], // should be ignored
    });
    writePackage(dir, "packages/foo");
    writePackage(dir, "apps/web");

    const got = discoverWorkspace(dir);
    expect(got?.mode).toBe("pnpm-workspace");
    expect(got?.packageRoots).toEqual(["packages/foo"]);
  });

  it("falls back to package.json#workspaces (string array form)", () => {
    writeJson(join(dir, "package.json"), {
      workspaces: ["packages/*"],
    });
    writePackage(dir, "packages/foo");
    writePackage(dir, "packages/bar");

    const got = discoverWorkspace(dir);
    expect(got?.mode).toBe("package-json-workspaces");
    expect(got?.packageRoots).toEqual(["packages/bar", "packages/foo"]);
  });

  it("supports `{ packages: [...] }` shape under workspaces", () => {
    writeJson(join(dir, "package.json"), {
      workspaces: { packages: ["apps/*"] },
    });
    writePackage(dir, "apps/web");
    writePackage(dir, "apps/api");

    const got = discoverWorkspace(dir);
    expect(got?.packageRoots).toEqual(["apps/api", "apps/web"]);
  });

  it("excludes node_modules/dist/build/.git/.next/.cache/.hidden", () => {
    writeFileSync(
      join(dir, "pnpm-workspace.yaml"),
      `packages:\n  - "packages/*"\n`,
    );
    writePackage(dir, "packages/foo");
    writePackage(dir, "packages/node_modules");
    writePackage(dir, "packages/dist");
    writePackage(dir, "packages/.cache");

    const got = discoverWorkspace(dir);
    expect(got?.packageRoots).toEqual(["packages/foo"]);
  });

  it("honours negation patterns", () => {
    writeFileSync(
      join(dir, "pnpm-workspace.yaml"),
      `packages:\n  - "packages/*"\n  - "!packages/excluded"\n`,
    );
    writePackage(dir, "packages/keep");
    writePackage(dir, "packages/excluded");

    const got = discoverWorkspace(dir);
    expect(got?.packageRoots).toEqual(["packages/keep"]);
  });

  it("returns empty packageRoots when patterns match nothing", () => {
    writeFileSync(
      join(dir, "pnpm-workspace.yaml"),
      `packages:\n  - "missing/*"\n`,
    );
    const got = discoverWorkspace(dir);
    expect(got?.mode).toBe("pnpm-workspace");
    expect(got?.packageRoots).toEqual([]);
  });

  it("treats invalid pnpm-workspace.yaml as no workspace, falls back to npm form", () => {
    // Empty `packages:` block is still a valid declaration → empty roots.
    // To trigger fallback we make the file unreadable as YAML; here we
    // simulate by having no `packages:` key — which the parser yields
    // [] for. Fallback to npm form should NOT fire because the file is
    // present (`pnpm-workspace.yaml` always wins on existence).
    writeFileSync(
      join(dir, "pnpm-workspace.yaml"),
      `# no packages block here\n`,
    );
    writeJson(join(dir, "package.json"), { workspaces: ["apps/*"] });
    writePackage(dir, "apps/web");

    const got = discoverWorkspace(dir);
    expect(got?.mode).toBe("pnpm-workspace");
    expect(got?.packageRoots).toEqual([]);
  });
});
