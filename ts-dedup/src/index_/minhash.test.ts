import { describe, expect, it } from "vitest";
import { createMinHasher, estimatedJaccard } from "./minhash.ts";

describe("createMinHasher", () => {
  it("produces signatures of length numHashes", () => {
    const h = createMinHasher(64, 1);
    const sig = h.sign(new Set(["a", "b", "c"]));
    expect(sig.values.length).toBe(64);
  });

  it("is order-independent", () => {
    const h = createMinHasher(64, 42);
    const a = h.sign(["a", "b", "c", "d"]);
    const b = h.sign(["d", "c", "b", "a"]);
    expect(Array.from(a.values)).toEqual(Array.from(b.values));
  });

  it("ignores duplicate features (Set semantics)", () => {
    const h = createMinHasher(64, 42);
    const a = h.sign(["a", "b", "c"]);
    const b = h.sign(["a", "a", "b", "c", "c", "c"]);
    expect(Array.from(a.values)).toEqual(Array.from(b.values));
  });

  it("is deterministic across hasher instances with same seed", () => {
    const h1 = createMinHasher(32, 7);
    const h2 = createMinHasher(32, 7);
    const a = h1.sign(["x", "y", "z"]);
    const b = h2.sign(["x", "y", "z"]);
    expect(Array.from(a.values)).toEqual(Array.from(b.values));
  });

  it("differs across seeds", () => {
    const h1 = createMinHasher(32, 1);
    const h2 = createMinHasher(32, 2);
    const a = h1.sign(["x", "y", "z"]);
    const b = h2.sign(["x", "y", "z"]);
    expect(Array.from(a.values)).not.toEqual(Array.from(b.values));
  });

  it("rejects numHashes <= 0", () => {
    expect(() => createMinHasher(0, 1)).toThrow();
    expect(() => createMinHasher(-1, 1)).toThrow();
  });

  it("approximates Jaccard within tolerance", () => {
    // Build two sets with known Jaccard ≈ 0.5 (8 shared / 16 union).
    const a = new Set<string>();
    const b = new Set<string>();
    for (let i = 0; i < 12; i++) a.add(`feat-${String(i)}`);
    for (let i = 4; i < 16; i++) b.add(`feat-${String(i)}`);
    const trueJ = 8 / 16; // |A ∩ B| / |A ∪ B|

    const h = createMinHasher(512, 0xc0ffee);
    const sigA = h.sign(a);
    const sigB = h.sign(b);
    const est = estimatedJaccard(sigA, sigB);

    // 512 hashes → standard error ≈ sqrt(J*(1-J)/k) ≈ 0.022, so tolerance 0.08.
    expect(Math.abs(est - trueJ)).toBeLessThan(0.08);
  });
});

describe("estimatedJaccard", () => {
  it("returns 1.0 for identical signatures", () => {
    const h = createMinHasher(32, 1);
    const sig = h.sign(["a", "b", "c"]);
    expect(estimatedJaccard(sig, sig)).toBe(1);
  });

  it("returns 0 for empty signatures (length 0)", () => {
    expect(
      estimatedJaccard(
        { values: new Uint32Array(0) },
        { values: new Uint32Array(0) },
      ),
    ).toBe(0);
  });

  it("throws on length mismatch", () => {
    const h32 = createMinHasher(32, 1);
    const h64 = createMinHasher(64, 1);
    expect(() => estimatedJaccard(h32.sign(["a"]), h64.sign(["a"]))).toThrow();
  });
});
