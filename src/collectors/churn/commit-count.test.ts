import { describe, expect, test } from "vitest";
import { parseChurnLog } from "./commit-count.ts";

const cmt = "CMT";

describe("parseChurnLog", () => {
  test("counts a single commit touching multiple files", () => {
    const raw = [cmt, "M\tsrc/foo.ts", "M\tsrc/bar.ts", ""].join("\n");
    const files = new Set(["src/foo.ts", "src/bar.ts", "src/baz.ts"]);
    const result = parseChurnLog(raw, files);
    expect(result.get("src/foo.ts")).toBe(1);
    expect(result.get("src/bar.ts")).toBe(1);
    expect(result.get("src/baz.ts")).toBeUndefined();
  });

  test("accumulates counts across commits", () => {
    const raw = [
      cmt,
      "M\tsrc/foo.ts",
      "",
      cmt,
      "M\tsrc/foo.ts",
      "M\tsrc/bar.ts",
      "",
      cmt,
      "A\tsrc/foo.ts",
    ].join("\n");
    const files = new Set(["src/foo.ts", "src/bar.ts"]);
    const result = parseChurnLog(raw, files);
    expect(result.get("src/foo.ts")).toBe(3);
    expect(result.get("src/bar.ts")).toBe(1);
  });

  test("rename credits the new (canonical) path and follows history back", () => {
    // Newest → oldest:
    //   c3: modified after rename
    //   c2: rename src/old.ts → src/new.ts
    //   c1: modified before rename (as src/old.ts)
    const raw = [
      cmt,
      "M\tsrc/new.ts",
      "",
      cmt,
      "R100\tsrc/old.ts\tsrc/new.ts",
      "",
      cmt,
      "M\tsrc/old.ts",
    ].join("\n");
    const files = new Set(["src/new.ts"]);
    const result = parseChurnLog(raw, files);
    expect(result.get("src/new.ts")).toBe(3);
  });

  test("a previous (unrelated) file at the same path before the rename is not counted", () => {
    // Newest → oldest:
    //   c2: rename src/old.ts → src/new.ts
    //   c1: "A src/new.ts" refers to an unrelated earlier file at that path,
    //       which was then presumably deleted before commit c2.
    const raw = [
      cmt,
      "R100\tsrc/old.ts\tsrc/new.ts",
      "",
      cmt,
      "A\tsrc/new.ts",
    ].join("\n");
    const files = new Set(["src/new.ts"]);
    const result = parseChurnLog(raw, files);
    expect(result.get("src/new.ts")).toBe(1);
  });

  test("copy counts the destination commit but does not follow the source", () => {
    const raw = [
      cmt,
      "C75\tsrc/source.ts\tsrc/copy.ts",
      "",
      cmt,
      "M\tsrc/source.ts",
    ].join("\n");
    const files = new Set(["src/copy.ts"]);
    const result = parseChurnLog(raw, files);
    expect(result.get("src/copy.ts")).toBe(1);
  });

  test("multiple entries on the same canonical file in one commit count once", () => {
    // Pathological but legal: same file touched twice in one commit entry.
    const raw = [cmt, "M\tsrc/foo.ts", "M\tsrc/foo.ts"].join("\n");
    const files = new Set(["src/foo.ts"]);
    const result = parseChurnLog(raw, files);
    expect(result.get("src/foo.ts")).toBe(1);
  });

  test("paths not in fileSet are dropped", () => {
    const raw = [cmt, "M\tREADME.md", "M\tpackage.json", "M\tsrc/foo.ts"].join(
      "\n",
    );
    const files = new Set(["src/foo.ts"]);
    const result = parseChurnLog(raw, files);
    expect(result.get("src/foo.ts")).toBe(1);
    expect(result.size).toBe(1);
  });

  test("empty input yields empty map", () => {
    expect(parseChurnLog("", new Set()).size).toBe(0);
  });

  test("prefix strips monorepo sub-package offset before fileSet lookup", () => {
    const raw = [cmt, "M\tpackages/core/src/foo.ts", "M\tdocs/x.md"].join("\n");
    const files = new Set(["src/foo.ts"]);
    const result = parseChurnLog(raw, files, "packages/core");
    expect(result.get("src/foo.ts")).toBe(1);
    expect(result.size).toBe(1);
  });

  test("rename crossing into the prefix counts the rename but stops the chain", () => {
    // File currently at packages/core/src/new.ts was moved in from outside
    // the package. Older commits against the out-of-scope old path must not
    // contribute to the in-scope file's churn.
    const raw = [
      cmt,
      "R100\tother/old.ts\tpackages/core/src/new.ts",
      "",
      cmt,
      "M\tother/old.ts",
    ].join("\n");
    const files = new Set(["src/new.ts"]);
    const result = parseChurnLog(raw, files, "packages/core");
    expect(result.get("src/new.ts")).toBe(1);
  });
});
