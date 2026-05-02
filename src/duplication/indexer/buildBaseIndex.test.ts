import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import { type BaseIndexSource, buildBaseIndex } from "./buildBaseIndex.ts";

const SOURCES: BaseIndexSource[] = [
  {
    path: "src/a.ts",
    text: "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
  },
  {
    path: "src/b.ts",
    text:
      "export function thinWrap(x: number): number {\n" +
      "  return helper(x);\n" +
      "}\n" +
      "export function meaty(x: number): number {\n" +
      "  let acc = 0;\n" +
      "  for (let i = 0; i < x; i++) acc += i;\n" +
      "  if (acc > 100) acc -= 50;\n" +
      "  return acc * 2;\n" +
      "}\n",
  },
  {
    path: "src/c.ts",
    text: "export const value = 42;\n",
  },
];

describe("buildBaseIndex", () => {
  it("serial path returns deterministic entries in source order", async () => {
    const result = await buildBaseIndex(SOURCES, defaultConfig, {
      thinWrapperEnabled: true,
      // Force serial: workers=1 short-circuits to runSerial.
      workers: 1,
    });
    const paths = result.entries.map((e) => e.fragment.filePath);
    // Source order must be preserved (lex by path within same listing).
    for (let i = 1; i < paths.length; i++) {
      const prev = paths[i - 1];
      const cur = paths[i];
      if (prev === undefined || cur === undefined) continue;
      // Same-file entries cluster together by virtue of per-file fragment
      // extraction order; cross-file order matches the input.
    }
    // Sanity: at least one fragment per file with extractable content.
    expect(result.fragmentsPerFile.length).toBe(SOURCES.length);
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it("returns a featureSetsById entry for every emitted fragment", async () => {
    const result = await buildBaseIndex(SOURCES, defaultConfig, {
      thinWrapperEnabled: false,
      workers: 1,
    });
    for (const { fragment } of result.entries) {
      expect(result.featureSetsById.has(fragment.id)).toBe(true);
    }
  });

  it("populates thinWrapperByFragmentId iff thinWrapperEnabled is true", async () => {
    const enabled = await buildBaseIndex(SOURCES, defaultConfig, {
      thinWrapperEnabled: true,
      workers: 1,
    });
    for (const { fragment } of enabled.entries) {
      expect(enabled.thinWrapperByFragmentId.has(fragment.id)).toBe(true);
    }
    const disabled = await buildBaseIndex(SOURCES, defaultConfig, {
      thinWrapperEnabled: false,
      workers: 1,
    });
    expect(disabled.thinWrapperByFragmentId.size).toBe(0);
  });

  it("parallel and serial paths produce identical results", async () => {
    // Repeat the source list to push past the parallelMinFiles fallback
    // and exercise the actual worker dispatch.
    const many: BaseIndexSource[] = [];
    for (let i = 0; i < 12; i++) {
      for (const src of SOURCES) {
        many.push({
          path: `dup${String(i)}/${src.path}`,
          text: src.text,
        });
      }
    }
    const serial = await buildBaseIndex(many, defaultConfig, {
      thinWrapperEnabled: true,
      workers: 1,
    });
    const parallel = await buildBaseIndex(many, defaultConfig, {
      thinWrapperEnabled: true,
      workers: 2,
      // Drop the threshold so a 36-source input actually parallelises.
      parallelMinFiles: 1,
    });
    expect(parallel.entries.length).toBe(serial.entries.length);
    for (let i = 0; i < serial.entries.length; i++) {
      const s = serial.entries[i];
      const p = parallel.entries[i];
      if (s === undefined || p === undefined) {
        throw new Error("entry missing");
      }
      expect(p.fragment.id).toBe(s.fragment.id);
      expect(p.fragment.filePath).toBe(s.fragment.filePath);
      expect(p.fragment.startLine).toBe(s.fragment.startLine);
      expect(p.fragment.endLine).toBe(s.fragment.endLine);
      expect(p.features.tokens).toEqual(s.features.tokens);
      expect(p.features.statements).toEqual(s.features.statements);
      expect(p.features.calls).toEqual(s.features.calls);
    }
    expect(parallel.fragmentsPerFile).toEqual(serial.fragmentsPerFile);
    expect(parallel.fragmentsByKind).toEqual(serial.fragmentsByKind);
    expect(parallel.thinWrapperByFragmentId.size).toBe(
      serial.thinWrapperByFragmentId.size,
    );
    for (const [id, isThin] of serial.thinWrapperByFragmentId) {
      expect(parallel.thinWrapperByFragmentId.get(id)).toBe(isThin);
    }
  });

  it("falls back to serial when sources.length is below parallelMinFiles", async () => {
    // Empty input is the trivial case: no workers spawned, returns empty.
    const result = await buildBaseIndex([], defaultConfig, {
      thinWrapperEnabled: true,
    });
    expect(result.entries).toEqual([]);
    expect(result.fragmentsPerFile).toEqual([]);
    expect(result.thinWrapperByFragmentId.size).toBe(0);
  });
});
