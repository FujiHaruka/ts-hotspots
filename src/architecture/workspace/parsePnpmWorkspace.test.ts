import { describe, expect, it } from "vitest";
import { parsePnpmWorkspaceYaml } from "./parsePnpmWorkspace.ts";

describe("parsePnpmWorkspaceYaml", () => {
  it("extracts simple list items", () => {
    const text = `packages:\n  - "packages/*"\n  - "apps/*"\n`;
    expect(parsePnpmWorkspaceYaml(text)).toEqual(["packages/*", "apps/*"]);
  });

  it("accepts unquoted values", () => {
    const text = `packages:\n  - packages/*\n  - apps/web\n`;
    expect(parsePnpmWorkspaceYaml(text)).toEqual(["packages/*", "apps/web"]);
  });

  it("accepts single-quoted values", () => {
    const text = `packages:\n  - 'packages/*'\n`;
    expect(parsePnpmWorkspaceYaml(text)).toEqual(["packages/*"]);
  });

  it("ignores comments and blank lines inside the block", () => {
    const text = `packages:\n  # leading comment\n  - "packages/*"\n\n  - "apps/*"  # tail comment\n`;
    expect(parsePnpmWorkspaceYaml(text)).toEqual(["packages/*", "apps/*"]);
  });

  it("does not strip a comment inside a quoted value", () => {
    const text = `packages:\n  - "weird # name"\n`;
    expect(parsePnpmWorkspaceYaml(text)).toEqual(["weird # name"]);
  });

  it("returns empty when packages: block is absent", () => {
    expect(parsePnpmWorkspaceYaml("# nothing here\n")).toEqual([]);
  });

  it("ends the block at a new top-level key", () => {
    const text = `packages:\n  - "packages/*"\nshamefully-hoist:\n  true\n`;
    expect(parsePnpmWorkspaceYaml(text)).toEqual(["packages/*"]);
  });

  it("ignores `packages:` written without a colon", () => {
    expect(parsePnpmWorkspaceYaml("packages\n  - ignored\n")).toEqual([]);
  });

  it("tolerates CRLF line endings", () => {
    expect(
      parsePnpmWorkspaceYaml(`packages:\r\n  - "a"\r\n  - "b"\r\n`),
    ).toEqual(["a", "b"]);
  });

  it("ignores top-level keys before packages:", () => {
    const text = `# comment\nimportant: true\npackages:\n  - "p/*"\n`;
    expect(parsePnpmWorkspaceYaml(text)).toEqual(["p/*"]);
  });
});
