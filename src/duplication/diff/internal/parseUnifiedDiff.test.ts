import { describe, expect, it } from "vitest";
import { parseUnifiedDiff } from "./parseUnifiedDiff.ts";

describe("parseUnifiedDiff", () => {
  it("parses one file with one hunk", () => {
    const out = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -12,3 +18,4 @@",
      "-old",
      "+new1",
      "+new2",
      "",
    ].join("\n");
    const parsed = parseUnifiedDiff(out);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.filePath).toBe("src/a.ts");
    expect(parsed[0]?.hunks).toEqual([{ startLine: 18, endLine: 21 }]);
  });

  it("parses a file with multiple hunks", () => {
    const out = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,1 +1,2 @@",
      "+a",
      "+b",
      "@@ -10 +12 @@",
      "-old",
      "+new",
      "@@ -50,0 +60,3 @@",
      "+a",
      "+b",
      "+c",
      "",
    ].join("\n");
    const parsed = parseUnifiedDiff(out);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.hunks).toEqual([
      { startLine: 1, endLine: 2 },
      { startLine: 12, endLine: 12 }, // omitted length defaults to 1
      { startLine: 60, endLine: 62 },
    ]);
  });

  it("parses a new file (--- /dev/null)", () => {
    const out = [
      "diff --git a/src/new.ts b/src/new.ts",
      "new file mode 100644",
      "index 0000000..3333333",
      "--- /dev/null",
      "+++ b/src/new.ts",
      "@@ -0,0 +1,5 @@",
      "+line1",
      "+line2",
      "+line3",
      "+line4",
      "+line5",
      "",
    ].join("\n");
    const parsed = parseUnifiedDiff(out);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.filePath).toBe("src/new.ts");
    expect(parsed[0]?.basePath).toBeUndefined();
    expect(parsed[0]?.hunks).toEqual([{ startLine: 1, endLine: 5 }]);
  });

  it("records the old path of a renamed file", () => {
    const out = [
      "diff --git a/src/old.ts b/src/new.ts",
      "similarity index 90%",
      "rename from src/old.ts",
      "rename to src/new.ts",
      "index 1111111..2222222 100644",
      "--- a/src/old.ts",
      "+++ b/src/new.ts",
      "@@ -4 +4 @@",
      "-old",
      "+new",
      "",
    ].join("\n");
    const parsed = parseUnifiedDiff(out);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.filePath).toBe("src/new.ts");
    expect(parsed[0]?.basePath).toBe("src/old.ts");
    expect(parsed[0]?.hunks).toEqual([{ startLine: 4, endLine: 4 }]);
  });

  it("drops a pure rename that changes no lines", () => {
    const out = [
      "diff --git a/src/old.ts b/src/new.ts",
      "similarity index 100%",
      "rename from src/old.ts",
      "rename to src/new.ts",
      "",
    ].join("\n");
    expect(parseUnifiedDiff(out)).toEqual([]);
  });

  it("skips a deleted file (+++ /dev/null)", () => {
    const out = [
      "diff --git a/src/gone.ts b/src/gone.ts",
      "deleted file mode 100644",
      "index 4444444..0000000",
      "--- a/src/gone.ts",
      "+++ /dev/null",
      "@@ -1,3 +0,0 @@",
      "-a",
      "-b",
      "-c",
      "",
    ].join("\n");
    const parsed = parseUnifiedDiff(out);
    expect(parsed).toEqual([]);
  });

  it("skips deletion-only hunks within an otherwise modified file", () => {
    const out = [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 1111111..2222222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -5,3 +4,0 @@", // pure deletion — no head range
      "-x",
      "-y",
      "-z",
      "@@ -20 +17 @@", // normal replace (d omitted = 1)
      "-old",
      "+new",
      "",
    ].join("\n");
    const parsed = parseUnifiedDiff(out);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.hunks).toEqual([{ startLine: 17, endLine: 17 }]);
    expect(parsed[0]?.spans).toEqual([
      { baseStart: 5, baseCount: 3, headStart: 4, headCount: 0 },
      { baseStart: 20, baseCount: 1, headStart: 17, headCount: 1 },
    ]);
    expect(parsed[0]?.basePath).toBe("src/a.ts");
  });
});
