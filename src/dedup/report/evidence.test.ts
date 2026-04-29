import { describe, expect, it } from "vitest";
import { defaultConfig } from "../config/index.ts";
import { buildEvidence, type Intersections } from "./evidence.ts";

describe("buildEvidence", () => {
  it("routes CALL / AWAIT_CALL / NEW into sharedCalls and PROP into sharedProperties", () => {
    const intersections: Intersections = {
      tokens: [],
      statements: [],
      calls: [
        "call:CALL:findById",
        "call:AWAIT_CALL:client.get",
        "call:NEW:UserRepo",
        "call:PROP:response.status",
        "call:PROP:user.id",
      ],
    };
    const evidence = buildEvidence(intersections, defaultConfig);
    expect(evidence.sharedCalls).toEqual([
      "CALL:findById",
      "AWAIT_CALL:client.get",
      "NEW:UserRepo",
    ]);
    expect(evidence.sharedProperties).toEqual([
      "PROP:response.status",
      "PROP:user.id",
    ]);
  });

  it("copies statement intersections as-is (prefix stripped) into matchedStatementKinds", () => {
    const intersections: Intersections = {
      tokens: [],
      statements: [
        "statement:IfStatement|ReturnStatement",
        "statement:VariableStatement|IfStatement",
      ],
      calls: [],
    };
    const evidence = buildEvidence(intersections, defaultConfig);
    expect(evidence.matchedStatementKinds).toEqual([
      "IfStatement|ReturnStatement",
      "VariableStatement|IfStatement",
    ]);
  });

  it("keeps only the first K token n-grams (prefix stripped)", () => {
    // Keys are already ascending-sorted (per scoreCandidateDetailed contract).
    const intersections: Intersections = {
      tokens: [
        "token:A",
        "token:B",
        "token:C",
        "token:D",
        "token:E",
        "token:F",
        "token:G",
      ],
      statements: [],
      calls: [],
    };
    const evidence = buildEvidence(intersections, {
      ...defaultConfig,
      report: { ...defaultConfig.report, tokenNgramSampleSize: 3 },
    });
    expect(evidence.matchedTokenNgramsSample).toEqual(["A", "B", "C"]);
  });

  it("uses default sample size 5 for tokens", () => {
    const intersections: Intersections = {
      tokens: [
        "token:A",
        "token:B",
        "token:C",
        "token:D",
        "token:E",
        "token:F",
      ],
      statements: [],
      calls: [],
    };
    const evidence = buildEvidence(intersections, defaultConfig);
    expect(evidence.matchedTokenNgramsSample).toEqual([
      "A",
      "B",
      "C",
      "D",
      "E",
    ]);
  });

  it("returns all empty arrays for empty intersections", () => {
    const evidence = buildEvidence(
      { tokens: [], statements: [], calls: [] },
      defaultConfig,
    );
    expect(evidence.sharedCalls).toEqual([]);
    expect(evidence.sharedProperties).toEqual([]);
    expect(evidence.matchedStatementKinds).toEqual([]);
    expect(evidence.matchedTokenNgramsSample).toEqual([]);
  });

  it("handles already-stripped call keys without double-stripping", () => {
    // Defensive: if the caller passes bare keys (without `call:` prefix)
    // they still classify correctly.
    const intersections: Intersections = {
      tokens: [],
      statements: [],
      calls: ["CALL:foo", "PROP:a.b"],
    };
    const evidence = buildEvidence(intersections, defaultConfig);
    expect(evidence.sharedCalls).toEqual(["CALL:foo"]);
    expect(evidence.sharedProperties).toEqual(["PROP:a.b"]);
  });
});
