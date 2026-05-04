import { describe, expect, test } from "vitest";
import { NotAGitRepoError } from "../util/git/findGitRoot.ts";
import { classifyGenericError } from "./streaming.ts";

describe("classifyGenericError", () => {
  test("preserves NOT_A_GIT_REPO from a coded error", () => {
    const err = new NotAGitRepoError("/tmp/not-a-repo");
    expect(classifyGenericError(err)).toEqual({
      code: "NOT_A_GIT_REPO",
      message:
        "ts-hotspots requires a git repository (none found at: /tmp/not-a-repo)",
    });
  });

  test("maps Node ENOENT for git binary to GIT_NOT_INSTALLED", () => {
    const err = Object.assign(new Error("spawn git ENOENT"), {
      code: "ENOENT",
      path: "git",
      syscall: "spawn git",
    });
    expect(classifyGenericError(err)).toEqual({
      code: "GIT_NOT_INSTALLED",
      message:
        "git command not found on PATH — ts-hotspots requires git to be installed",
    });
  });

  test("does not misclassify ENOENT for unrelated binaries as GIT_NOT_INSTALLED", () => {
    const err = Object.assign(new Error("spawn rg ENOENT"), {
      code: "ENOENT",
      path: "rg",
      syscall: "spawn rg",
    });
    const result = classifyGenericError(err);
    expect(result.code).not.toBe("GIT_NOT_INSTALLED");
  });

  test("falls back to GIT_FAILED when git failed for any other reason", () => {
    const err = new Error(
      "Command failed: git rev-parse foo\nfatal: bad revision 'foo'",
    );
    expect(classifyGenericError(err)).toEqual({
      code: "GIT_FAILED",
      message: err.message,
    });
  });

  test("falls back to UNKNOWN_ERROR for unrecognized errors", () => {
    const err = new Error("something else broke");
    expect(classifyGenericError(err)).toEqual({
      code: "UNKNOWN_ERROR",
      message: "something else broke",
    });
  });
});
