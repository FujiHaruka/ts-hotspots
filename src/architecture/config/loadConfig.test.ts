import { describe, expect, it } from "vitest";
import { ArchConfigError } from "./types.ts";
import { parseArchConfig } from "./loadConfig.ts";

const SOURCE = ".ts-hotspots.json";

describe("parseArchConfig — happy path", () => {
  it("returns empty config when there is no architecture block", () => {
    expect(parseArchConfig({}, SOURCE)).toEqual({ downweight: [] });
    expect(parseArchConfig({ duplication: {} }, SOURCE)).toEqual({
      downweight: [],
    });
  });

  it("parses a valid downweight block", () => {
    const cfg = parseArchConfig(
      {
        architecture: {
          downweight: [
            { glob: "src/legacy/**", factor: 0.5 },
            { glob: "**/*.barrel.ts", factor: 0 },
          ],
        },
      },
      SOURCE,
    );
    expect(cfg.downweight).toEqual([
      { glob: "src/legacy/**", factor: 0.5 },
      { glob: "**/*.barrel.ts", factor: 0 },
    ]);
  });
});

describe("parseArchConfig — validation", () => {
  it("rejects non-object top level", () => {
    expect(() => parseArchConfig(null, SOURCE)).toThrow(ArchConfigError);
    expect(() => parseArchConfig([], SOURCE)).not.toThrow(); // arrays are objects in JS — still ok unless arch block invalid
  });

  it("rejects non-object 'architecture'", () => {
    expect(() => parseArchConfig({ architecture: 5 }, SOURCE)).toThrow(
      ArchConfigError,
    );
  });

  it("rejects non-array 'architecture.downweight'", () => {
    expect(() =>
      parseArchConfig({ architecture: { downweight: "nope" } }, SOURCE),
    ).toThrow(ArchConfigError);
  });

  it("rejects empty glob", () => {
    expect(() =>
      parseArchConfig(
        { architecture: { downweight: [{ glob: "", factor: 0.5 }] } },
        SOURCE,
      ),
    ).toThrow(ArchConfigError);
  });

  it("rejects out-of-range factor", () => {
    expect(() =>
      parseArchConfig(
        { architecture: { downweight: [{ glob: "x", factor: 1.5 }] } },
        SOURCE,
      ),
    ).toThrow(/in \[0, 1\]/);
    expect(() =>
      parseArchConfig(
        { architecture: { downweight: [{ glob: "x", factor: -0.1 }] } },
        SOURCE,
      ),
    ).toThrow(/in \[0, 1\]/);
  });

  it("rejects non-numeric factor", () => {
    expect(() =>
      parseArchConfig(
        { architecture: { downweight: [{ glob: "x", factor: "0.5" }] } },
        SOURCE,
      ),
    ).toThrow(ArchConfigError);
  });
});
