import { describe, expect, it } from "vitest";
import { buildEdgeWeightHook } from "./applyDownweight.ts";

describe("buildEdgeWeightHook", () => {
  it("returns undefined when there are no rules", () => {
    expect(buildEdgeWeightHook([])).toBeUndefined();
  });

  it("multiplies the factor when the source matches", () => {
    const hook = buildEdgeWeightHook([
      { glob: "src/legacy/**", factor: 0.5 },
    ]);
    if (hook === undefined) throw new Error("hook missing");
    const w = hook({
      fromFile: "src/legacy/foo.ts",
      toFile: "src/clean/bar.ts",
      baseWeight: 1,
      kind: "value",
    });
    expect(w).toBe(0.5);
  });

  it("multiplies the factor when the target matches", () => {
    const hook = buildEdgeWeightHook([
      { glob: "**/*.barrel.ts", factor: 0.3 },
    ]);
    if (hook === undefined) throw new Error("hook missing");
    const w = hook({
      fromFile: "src/a.ts",
      toFile: "src/x.barrel.ts",
      baseWeight: 1,
      kind: "value",
    });
    expect(w).toBeCloseTo(0.3, 6);
  });

  it("composes multiple matching rules multiplicatively", () => {
    const hook = buildEdgeWeightHook([
      { glob: "src/legacy/**", factor: 0.5 },
      { glob: "**/*.barrel.ts", factor: 0.5 },
    ]);
    if (hook === undefined) throw new Error("hook missing");
    const w = hook({
      fromFile: "src/legacy/foo.ts",
      toFile: "src/x.barrel.ts",
      baseWeight: 1,
      kind: "value",
    });
    expect(w).toBe(0.25);
  });

  it("passes through unchanged when no rule matches", () => {
    const hook = buildEdgeWeightHook([
      { glob: "src/legacy/**", factor: 0.5 },
    ]);
    if (hook === undefined) throw new Error("hook missing");
    expect(
      hook({
        fromFile: "src/clean/a.ts",
        toFile: "src/clean/b.ts",
        baseWeight: 1.5,
        kind: "implements",
      }),
    ).toBe(1.5);
  });

  it("factor 0 short-circuits to 0", () => {
    const hook = buildEdgeWeightHook([
      { glob: "src/x.ts", factor: 0 },
    ]);
    if (hook === undefined) throw new Error("hook missing");
    expect(
      hook({
        fromFile: "src/x.ts",
        toFile: "src/y.ts",
        baseWeight: 2,
        kind: "extends",
      }),
    ).toBe(0);
  });
});
