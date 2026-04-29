import { describe, expect, it } from "vitest";
import {
  STUB_PR_SUMMARY,
  STUB_WHOLE_REPO_SUMMARY,
} from "../../../test/dedup/helpers/stubSummary.ts";
import type { CloneGroup, GroupMember } from "../domain/cloneGroup.ts";
import type { CloneCandidateReport } from "../domain/report.ts";
import { buildMarkdownReport } from "./markdownReport.ts";

function mkMember(partial: Partial<GroupMember> = {}): GroupMember {
  return {
    fragment: {
      filePath: "src/existing.ts",
      startLine: 5,
      endLine: 30,
      kind: "function",
      code: "function bar() { return 2; }",
    },
    scores: {
      combined: 0.78,
      tokenOverlap: 0.82,
      statementKindSimilarity: 0.9,
      callOverlap: 0.6,
      sizeCompatibility: 0.75,
      lengthScore: 0.5,
    },
    evidence: {
      sharedCalls: ["CALL:findById", "AWAIT_CALL:client.get"],
      sharedProperties: ["PROP:user.id"],
      matchedStatementKinds: ["IfStatement|ReturnStatement"],
      matchedTokenNgramsSample: ["ID DOT ID", "IF ID DOT ID"],
    },
    ...partial,
  };
}

function mkGroup(partial: Partial<CloneGroup> = {}): CloneGroup {
  const member = mkMember();
  return {
    anchor: {
      filePath: "src/changed.ts",
      startLine: 12,
      endLine: 34,
      kind: "function",
      code: "function foo() { return 1; }",
    },
    members: [member],
    size: 2,
    aggregateScores: {
      combined: { min: 0.78, median: 0.78, max: 0.78 },
      tokenOverlap: { min: 0.82, median: 0.82, max: 0.82 },
      statementKindSimilarity: { min: 0.9, median: 0.9, max: 0.9 },
      callOverlap: { min: 0.6, median: 0.6, max: 0.6 },
    },
    sharedEvidence: member.evidence,
    recommendationHint: {
      confidence: "high",
      likelyRefactoring: "extract-function",
      riskFlags: ["size-mismatch"],
    },
    ...partial,
  };
}

describe("buildMarkdownReport", () => {
  it("renders header and groups: 0 when empty", () => {
    const md = buildMarkdownReport({
      pr: { baseSha: "deadbeef", headSha: "cafef00d" },
      summary: STUB_PR_SUMMARY,
      groups: [],
    });
    expect(md).toContain("# ts-dedup report");
    expect(md).toContain("base: deadbeef");
    expect(md).toContain("head: cafef00d");
    expect(md).toContain("groups: 0");
    expect(md.endsWith("\n")).toBe(true);
  });

  it("renders aggregateScores, hint, sharedEvidence, anchor and member blocks for each group", () => {
    const md = buildMarkdownReport({
      pr: { baseSha: "a", headSha: "b" },
      summary: STUB_PR_SUMMARY,
      groups: [mkGroup()],
    });
    expect(md).toContain("groups: 1");
    expect(md).toContain("## 1. src/changed.ts:12-34 (function) [size 2]");
    expect(md).toContain("- combined: 0.78/0.78/0.78");
    expect(md).toContain(
      "- token: 0.82/0.82/0.82, statement: 0.90/0.90/0.90, call: 0.60/0.60/0.60",
    );
    expect(md).toContain("- confidence: high / refactoring: extract-function");
    expect(md).toContain("- risks: size-mismatch");
    expect(md).toContain("shared evidence (every member):");
    expect(md).toContain(
      "- shared calls: CALL:findById, AWAIT_CALL:client.get",
    );
    expect(md).toContain("- shared properties: PROP:user.id");
    expect(md).toContain("### member 1: src/existing.ts:5-30 (function)");
    expect(md).toContain(
      "- token: 0.82, statement: 0.90, call: 0.60, size: 0.75, length: 0.50",
    );
    expect(md).toContain("changed:\n```ts\nfunction foo() { return 1; }\n```");
    expect(md).toContain("existing:\n```ts\nfunction bar() { return 2; }\n```");
  });

  it("expands the fence when code contains a backtick run >= 3", () => {
    const md = buildMarkdownReport({
      pr: { baseSha: "a", headSha: "b" },
      summary: STUB_PR_SUMMARY,
      groups: [
        mkGroup({
          anchor: {
            filePath: "a.ts",
            startLine: 1,
            endLine: 3,
            kind: "function",
            code: "const md = `\\`\\`\\` block ```` end`;",
          },
        }),
      ],
    });
    expect(md).toContain(
      "changed:\n`````ts\nconst md = `\\`\\`\\` block ```` end`;\n`````",
    );
    expect(md).toContain("existing:\n```ts\nfunction bar() { return 2; }\n```");
  });

  it("is deterministic: two runs produce the same string", () => {
    const report: CloneCandidateReport = {
      pr: { baseSha: "a", headSha: "b" },
      summary: STUB_PR_SUMMARY,
      groups: [
        mkGroup(),
        mkGroup({
          anchor: {
            filePath: "x.ts",
            startLine: 1,
            endLine: 5,
            kind: "block",
            code: "return x;",
          },
        }),
      ],
    };
    expect(buildMarkdownReport(report)).toBe(buildMarkdownReport(report));
  });

  it("omits the changed:/existing: code blocks when code is undefined", () => {
    const member = mkMember({
      fragment: {
        filePath: "src/existing.ts",
        startLine: 5,
        endLine: 30,
        kind: "function",
      },
    });
    const md = buildMarkdownReport({
      pr: { baseSha: "a", headSha: "b" },
      summary: STUB_PR_SUMMARY,
      groups: [
        mkGroup({
          anchor: {
            filePath: "src/changed.ts",
            startLine: 12,
            endLine: 34,
            kind: "function",
          },
          members: [member],
        }),
      ],
    });
    expect(md).toContain("## 1. src/changed.ts:12-34 (function) [size 2]");
    expect(md).toContain("### member 1: src/existing.ts:5-30 (function)");
    expect(md).not.toContain("changed:\n```");
    expect(md).not.toContain("existing:\n```");
    expect(md).not.toContain("```ts");
  });

  it("renders 'Cluster #N' heading for anchor-less whole-repo groups", () => {
    const member = mkMember();
    const md = buildMarkdownReport({
      pr: { baseSha: "deadbeef", headSha: "deadbeef" },
      summary: STUB_WHOLE_REPO_SUMMARY,
      groups: [
        mkGroup({
          anchor: undefined,
          members: [member, mkMember()],
          size: 2,
        }),
      ],
    });
    expect(md).toContain("## Cluster #1 [size 2]");
    expect(md).not.toContain("(anonymous group)");
  });

  it("uses neutral 'anchor:' / 'member:' labels in whole-repo mode", () => {
    const md = buildMarkdownReport({
      pr: { baseSha: "deadbeef", headSha: "deadbeef" },
      summary: STUB_WHOLE_REPO_SUMMARY,
      groups: [mkGroup()],
    });
    expect(md).toContain("anchor:\n```ts\nfunction foo() { return 1; }\n```");
    expect(md).toContain("member:\n```ts\nfunction bar() { return 2; }\n```");
    expect(md).not.toContain("changed:\n```");
    expect(md).not.toContain("existing:\n```");
  });

  it("renders '(none)' for empty risk/evidence fields", () => {
    const member = mkMember({
      evidence: {
        sharedCalls: [],
        sharedProperties: [],
        matchedStatementKinds: [],
        matchedTokenNgramsSample: [],
      },
    });
    const md = buildMarkdownReport({
      pr: { baseSha: "a", headSha: "b" },
      summary: STUB_PR_SUMMARY,
      groups: [
        mkGroup({
          members: [member],
          sharedEvidence: member.evidence,
          recommendationHint: {
            confidence: "low",
            likelyRefactoring: "manual-review",
            riskFlags: [],
          },
        }),
      ],
    });
    expect(md).toContain("- risks: (none)");
    expect(md).toContain("- shared calls: (none)");
    expect(md).toContain("- shared properties: (none)");
    expect(md).toContain("- matched statement kinds: (none)");
    expect(md).toContain("- matched token n-grams (sample): (none)");
  });
});
