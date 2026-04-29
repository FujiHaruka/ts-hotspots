import { describe, expect, it } from "vitest";
import { buildLshIndex, type LshIndexInput, type LshParams } from "./lsh.ts";

const baseParams: LshParams = {
  numHashes: 32,
  bands: 8,
  rows: 4,
  seedCount: 1,
  seed: 1,
  maxBucketSize: 0,
};

function collect(
  inputs: readonly LshIndexInput[],
  params: LshParams,
): string[] {
  const lsh = buildLshIndex(inputs, params);
  const pairs: string[] = [];
  lsh.forEachCandidatePair((a, b) => {
    pairs.push(`${a}|${b}`);
  });
  return pairs.sort();
}

describe("buildLshIndex", () => {
  it("validates numHashes === bands * rows", () => {
    expect(() =>
      buildLshIndex([], { ...baseParams, numHashes: 32, bands: 4, rows: 4 }),
    ).toThrow();
  });

  it("validates seedCount >= 1", () => {
    expect(() => buildLshIndex([], { ...baseParams, seedCount: 0 })).toThrow();
  });

  it("emits each candidate pair at most once across bands", () => {
    // Identical token sets → both fragments collide in every band, but
    // forEachCandidatePair must dedup.
    const features = new Set(["a", "b", "c", "d", "e"]);
    const inputs: LshIndexInput[] = [
      { fragmentId: "f1", features: features },
      { fragmentId: "f2", features: features },
    ];
    expect(collect(inputs, baseParams)).toEqual(["f1|f2"]);
  });

  it("emits no pairs for entirely disjoint sets (high prob)", () => {
    // Two disjoint sets should rarely collide. With 8 bands × 4 rows the
    // probability of any-band collision for J=0 is 0 (excluding hash
    // accidents), so the candidate set is empty.
    const inputs: LshIndexInput[] = [
      { fragmentId: "f1", features: new Set(["a1", "a2", "a3", "a4"]) },
      { fragmentId: "f2", features: new Set(["b1", "b2", "b3", "b4"]) },
    ];
    expect(collect(inputs, baseParams)).toEqual([]);
  });

  it("emits canonical pair keys (lex-smaller first)", () => {
    const features = new Set(["x", "y", "z"]);
    const inputs: LshIndexInput[] = [
      { fragmentId: "zebra", features: features },
      { fragmentId: "alpha", features: features },
    ];
    expect(collect(inputs, baseParams)).toEqual(["alpha|zebra"]);
  });

  it("is deterministic across runs given fixed params", () => {
    const inputs: LshIndexInput[] = Array.from({ length: 10 }, (_, i) => ({
      fragmentId: `f${String(i)}`,
      features: new Set([
        `x${String(i % 3)}`,
        `y${String(i % 4)}`,
        `z${String(i % 2)}`,
      ]),
    }));
    const a = collect(inputs, baseParams);
    const b = collect(inputs, baseParams);
    expect(a).toEqual(b);
  });

  it("skips empty token sets entirely", () => {
    // 3 fragments, two empty + one non-empty. If empties were included,
    // they'd all collide on the all-UINT32_MAX signature and emit a pair.
    const inputs: LshIndexInput[] = [
      { fragmentId: "empty1", features: new Set() },
      { fragmentId: "empty2", features: new Set() },
      { fragmentId: "real", features: new Set(["a", "b"]) },
    ];
    expect(collect(inputs, baseParams)).toEqual([]);
  });

  it("drops buckets above maxBucketSize", () => {
    // 10 identical fragments. Without cap, would emit C(10,2)=45 pairs.
    // With cap 5, the bucket is dropped.
    const features = new Set(["a", "b", "c"]);
    const inputs: LshIndexInput[] = Array.from({ length: 10 }, (_, i) => ({
      fragmentId: `f${String(i)}`,
      features: features,
    }));
    const capped = collect(inputs, { ...baseParams, maxBucketSize: 5 });
    expect(capped).toEqual([]);
    // Cap 0 disables → all 45 pairs emitted.
    const uncapped = collect(inputs, { ...baseParams, maxBucketSize: 0 });
    expect(uncapped.length).toBe(45);
  });

  it("emits high-Jaccard pairs reliably", () => {
    // J(A,B) ≈ 0.9 should collide with very high probability.
    const a = new Set<string>();
    const b = new Set<string>();
    for (let i = 0; i < 100; i++) {
      a.add(`x${String(i)}`);
      if (i < 90) b.add(`x${String(i)}`);
    }
    for (let i = 100; i < 110; i++) b.add(`x${String(i)}`);
    const trueJ = 90 / 110;
    expect(trueJ).toBeGreaterThan(0.8);

    const inputs: LshIndexInput[] = [
      { fragmentId: "a", features: a },
      { fragmentId: "b", features: b },
    ];
    expect(collect(inputs, baseParams)).toEqual(["a|b"]);
  });

  it("seedCount > 1 builds independent passes (more candidates)", () => {
    // J ≈ 0.4: borderline collision probability for inflection 0.5.
    // With seedCount=1 we may or may not catch it; with seedCount=4 more
    // likely to. Test only checks the API works and collisions are
    // non-decreasing.
    const a = new Set<string>();
    const b = new Set<string>();
    for (let i = 0; i < 10; i++) a.add(`x${String(i)}`);
    for (let i = 5; i < 20; i++) b.add(`x${String(i)}`);
    const inputs: LshIndexInput[] = [
      { fragmentId: "a", features: a },
      { fragmentId: "b", features: b },
    ];
    const single = collect(inputs, { ...baseParams, seedCount: 1 });
    const multi = collect(inputs, { ...baseParams, seedCount: 4 });
    // Multi-pass result is a superset of single-pass result.
    for (const k of single) expect(multi).toContain(k);
  });
});
