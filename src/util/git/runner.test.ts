import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { gitCatFileBatch } from "./runner.ts";

function git(cwd: string, args: readonly string[]): void {
  const res = spawnSync(
    "git",
    [
      // Override any host-level commit-signing config so the sandbox
      // doesn't reach for an unavailable signing server.
      "-c",
      "commit.gpgsign=false",
      "-c",
      "tag.gpgsign=false",
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@example.com",
      ...args,
    ],
    { cwd, encoding: "utf8" },
  );
  if (res.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${res.stderr || res.stdout}`,
    );
  }
}

function touch(root: string, relPath: string, body: string): void {
  const full = join(root, relPath);
  mkdirSync(dirname(full), { recursive: true });
  writeFileSync(full, body);
}

describe("gitCatFileBatch", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "ts-hotspots-catfile-"));
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  test("returns blob contents keyed by the input spec, in input order", async () => {
    touch(tmp, "a.ts", "export const a = 1;\n");
    touch(tmp, "src/b.ts", "export const b = 2;\nexport const c = 3;\n");
    touch(tmp, "empty.ts", "");
    git(tmp, ["init", "--initial-branch=main"]);
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "c1"]);

    const specs = ["HEAD:a.ts", "HEAD:src/b.ts", "HEAD:empty.ts"];
    const { contents } = await gitCatFileBatch(tmp, specs);
    expect(contents.get("HEAD:a.ts")).toBe("export const a = 1;\n");
    expect(contents.get("HEAD:src/b.ts")).toBe(
      "export const b = 2;\nexport const c = 3;\n",
    );
    expect(contents.get("HEAD:empty.ts")).toBe("");
  });

  test("silently skips missing specs without aborting the rest", async () => {
    touch(tmp, "a.ts", "export const a = 1;\n");
    git(tmp, ["init", "--initial-branch=main"]);
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "c1"]);

    const specs = ["HEAD:a.ts", "HEAD:does-not-exist.ts", "HEAD:also-missing"];
    const { contents } = await gitCatFileBatch(tmp, specs);
    expect(contents.get("HEAD:a.ts")).toBe("export const a = 1;\n");
    expect(contents.has("HEAD:does-not-exist.ts")).toBe(false);
    expect(contents.has("HEAD:also-missing")).toBe(false);
  });

  test("preserves bytes containing newlines (not framed by line breaks)", async () => {
    const body = "line1\nline2\n\nline4\n";
    touch(tmp, "multi.ts", body);
    git(tmp, ["init", "--initial-branch=main"]);
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "c1"]);

    const { contents } = await gitCatFileBatch(tmp, ["HEAD:multi.ts"]);
    expect(contents.get("HEAD:multi.ts")).toBe(body);
  });

  test("returns an empty map for an empty spec list (no child process)", async () => {
    const { contents } = await gitCatFileBatch(tmp, []);
    expect(contents.size).toBe(0);
  });

  test("ignores non-blob refs (e.g. tree)", async () => {
    touch(tmp, "src/a.ts", "x\n");
    git(tmp, ["init", "--initial-branch=main"]);
    git(tmp, ["add", "."]);
    git(tmp, ["commit", "-m", "c1"]);

    // HEAD^{tree} resolves to the root tree object — non-blob.
    const { contents } = await gitCatFileBatch(tmp, [
      "HEAD^{tree}",
      "HEAD:src/a.ts",
    ]);
    expect(contents.has("HEAD^{tree}")).toBe(false);
    expect(contents.get("HEAD:src/a.ts")).toBe("x\n");
  });
});
