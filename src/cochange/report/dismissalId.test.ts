import { describe, expect, test } from "vitest";
import { normalizeDismissalId } from "../../dismissal/hash.ts";
import {
  computeCochangeClusterDismissalId,
  computeCochangePairDismissalId,
} from "./dismissalId.ts";

describe("computeCochangePairDismissalId", () => {
  test("returns a coch:<hex> id with 16 hex chars", () => {
    const id = computeCochangePairDismissalId("src/a.ts", "src/b.ts");
    expect(id.startsWith("coch:")).toBe(true);
    expect(id.length).toBe("coch:".length + 16);
    expect(id.slice("coch:".length)).toMatch(/^[0-9a-f]{16}$/);
  });

  test("is deterministic across calls", () => {
    const a = computeCochangePairDismissalId("src/a.ts", "src/b.ts");
    const b = computeCochangePairDismissalId("src/a.ts", "src/b.ts");
    expect(a).toBe(b);
  });

  test("is invariant under argument order (canonical-ordered)", () => {
    const ab = computeCochangePairDismissalId("src/a.ts", "src/b.ts");
    const ba = computeCochangePairDismissalId("src/b.ts", "src/a.ts");
    expect(ab).toBe(ba);
  });

  test("changes when either path changes", () => {
    const ab = computeCochangePairDismissalId("src/a.ts", "src/b.ts");
    const ac = computeCochangePairDismissalId("src/a.ts", "src/c.ts");
    expect(ab).not.toBe(ac);
  });

  test("known-vector: a fixed input yields a fixed id", () => {
    // sha256("src/a.ts\nsrc/b.ts").slice(0, 16)
    expect(computeCochangePairDismissalId("src/a.ts", "src/b.ts")).toBe(
      "coch:1b6ddeb1bb545ae5",
    );
  });

  test("normalizeDismissalId round-trips a coch:<hex> id", () => {
    const id = computeCochangePairDismissalId("src/a.ts", "src/b.ts");
    expect(normalizeDismissalId(id)).toBe(id);
  });
});

describe("computeCochangeClusterDismissalId", () => {
  test("returns a coch:<hex> id with 16 hex chars (same shape as pair ids)", () => {
    const id = computeCochangeClusterDismissalId([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
    expect(id.startsWith("coch:")).toBe(true);
    expect(id.length).toBe("coch:".length + 16);
    expect(id.slice("coch:".length)).toMatch(/^[0-9a-f]{16}$/);
  });

  test("is invariant under member order (lex-sorted before hashing)", () => {
    const a = computeCochangeClusterDismissalId([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
    const b = computeCochangeClusterDismissalId([
      "src/c.ts",
      "src/a.ts",
      "src/b.ts",
    ]);
    expect(a).toBe(b);
  });

  test("changes when the member set changes", () => {
    const abc = computeCochangeClusterDismissalId([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
    const abd = computeCochangeClusterDismissalId([
      "src/a.ts",
      "src/b.ts",
      "src/d.ts",
    ]);
    expect(abc).not.toBe(abd);
  });

  test("does not collide with the pair id of the same two files", () => {
    // The cluster hash input is prefixed with "cluster\n" so even a
    // hypothetical 2-element cluster id is distinct from the pair id of
    // the same files. This guards against future regressions where the
    // size>=3 invariant relaxes.
    const pair = computeCochangePairDismissalId("src/a.ts", "src/b.ts");
    const twoCluster = computeCochangeClusterDismissalId([
      "src/a.ts",
      "src/b.ts",
    ]);
    expect(twoCluster).not.toBe(pair);
  });

  test("normalizeDismissalId round-trips a cluster id", () => {
    const id = computeCochangeClusterDismissalId([
      "src/a.ts",
      "src/b.ts",
      "src/c.ts",
    ]);
    expect(normalizeDismissalId(id)).toBe(id);
  });
});
