import { describe, expect, test } from "vitest";
import { emptyFunctionAxisMeta } from "../aggregator/rank.ts";
import type { ErrorReport, FunctionReport } from "../schema.ts";
import {
  renderJson,
  renderMarkdown,
  renderMarkdownBody,
  renderMarkdownErrorBody,
  renderMarkdownHead,
  renderMarkdownPreError,
  renderStatsLine,
} from "./render.ts";

function makeFunctionReport(
  overrides: Partial<FunctionReport> = {},
): FunctionReport {
  return {
    tool: { name: "ts-hotspots", version: "0.1.0" },
    project: {
      tsconfigPath: "/abs/tsconfig.json",
      sourceFileCount: 3,
      functionCount: 5,
    },
    hotspots: [],
    ...overrides,
  };
}

describe("renderJson", () => {
  test("produces deterministic pretty JSON with trailing newline for FunctionReport", () => {
    const report = makeFunctionReport();
    const a = renderJson(report);
    const b = renderJson(report);
    expect(a).toBe(b);
    expect(a.endsWith("\n")).toBe(true);
    expect(JSON.parse(a)).toEqual(report);
  });

  test("renders slim FunctionReport by default with only hotspot candidates", () => {
    const report = makeFunctionReport();
    const parsed = JSON.parse(renderJson(report)) as Record<string, unknown>;
    expect(parsed.hotspots).toBeDefined();
    expect(parsed.functionRankings).toBeUndefined();
    expect(parsed.functionAxisMeta).toBeUndefined();
    expect(parsed.functions).toBeUndefined();
    expect(parsed.functionCoOccurrence).toBeUndefined();
  });

  test("renders optional sections when provided", () => {
    const report = makeFunctionReport({
      functionRankings: {},
      functionAxisMeta: emptyFunctionAxisMeta(),
      functionCoOccurrence: [],
      functions: [],
    });
    const parsed = JSON.parse(renderJson(report)) as Record<string, unknown>;
    expect(parsed.functionRankings).toEqual({});
    expect(parsed.functionAxisMeta).toBeDefined();
    expect(parsed.functionCoOccurrence).toEqual([]);
    expect(parsed.functions).toEqual([]);
  });

  test("renders ErrorReport", () => {
    const err: ErrorReport = {
      status: "error",
      error: { code: "TSCONFIG_NOT_FOUND", message: "missing" },
    };
    expect(JSON.parse(renderJson(err))).toEqual(err);
  });

  test("success reports omit `status`; error reports keep `status: \"error\"`", () => {
    const ok = JSON.parse(renderJson(makeFunctionReport())) as {
      status?: string;
    };
    expect(ok.status).toBeUndefined();
    const err: ErrorReport = {
      status: "error",
      error: { code: "X", message: "y" },
    };
    const parsed = JSON.parse(renderJson(err)) as { status: string };
    expect(parsed.status).toBe("error");
  });
});

function extractJsonFence(markdown: string): string {
  const match = /```json\n([\s\S]*?)\n```/.exec(markdown);
  if (match === null) throw new Error("no ```json fence found");
  return match[1] ?? "";
}

describe("renderMarkdown (complexity)", () => {
  test("FunctionReport: includes prompt header and JSON fence whose body matches renderJson", () => {
    const report = makeFunctionReport();
    const md = renderMarkdown("complexity", report);
    expect(md.startsWith("# ts-hotspots report")).toBe(true);
    expect(md).toContain("## Data");
    const body = extractJsonFence(md);
    expect(JSON.parse(body)).toEqual(JSON.parse(renderJson(report)));
  });

  test("ErrorReport: produces a Markdown error block, not JSON", () => {
    const err: ErrorReport = {
      status: "error",
      error: { code: "TSCONFIG_NOT_FOUND", message: "missing at /x" },
    };
    const md = renderMarkdown("complexity", err);
    expect(md.startsWith("# ts-hotspots error")).toBe(true);
    expect(md).toContain("missing at /x");
    expect(md).not.toContain("```json");
    expect(() => {
      JSON.parse(md);
    }).toThrow();
  });

  test("head + body compose to the same string as renderMarkdown", () => {
    const report = makeFunctionReport();
    const composed = `${renderMarkdownHead("complexity")}${renderMarkdownBody(report)}`;
    expect(composed).toBe(renderMarkdown("complexity", report));
  });

  test("head is data-independent (stable across different reports)", () => {
    const a = makeFunctionReport();
    const b = makeFunctionReport({
      project: {
        tsconfigPath: "/other/tsconfig.json",
        sourceFileCount: 999,
        functionCount: 123,
      },
    });
    const head = renderMarkdownHead("complexity");
    expect(renderMarkdownHead("complexity")).toBe(head);
    // Building the streamed form for two different reports yields the same head.
    const headA = renderMarkdown("complexity", a).slice(0, head.length);
    const headB = renderMarkdown("complexity", b).slice(0, head.length);
    expect(headA).toBe(head);
    expect(headB).toBe(head);
  });

  test("error body closes the fence and carries the error JSON", () => {
    const err: ErrorReport = {
      status: "error",
      error: { code: "X", message: "boom" },
    };
    const body = renderMarkdownErrorBody(err);
    expect(body.endsWith("```\n")).toBe(true);
    // Head + errorBody must form a well-formed fenced-JSON Markdown document.
    const doc = `${renderMarkdownHead("complexity")}${body}`;
    const match = /```json\n([\s\S]*?)\n```/.exec(doc);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match?.[1] ?? "") as ErrorReport;
    expect(parsed).toEqual(err);
  });
});

describe("renderMarkdown (duplication)", () => {
  test("head starts with the duplication-specific instruction heading and opens a JSON fence", () => {
    const head = renderMarkdownHead("duplication");
    expect(head.startsWith("# ts-hotspots duplication report")).toBe(true);
    expect(head).toContain("## Data");
    expect(head.endsWith("```json\n")).toBe(true);
  });

  test("head + body compose to a parseable fenced-JSON Markdown document for any payload", () => {
    const payload = {
      status: "ok" as const,
      tool: { name: "ts-hotspots", version: "0.1.0" },
      groups: [],
    };
    const doc = `${renderMarkdownHead("duplication")}${renderMarkdownBody(payload)}`;
    const fence = extractJsonFence(doc);
    expect(JSON.parse(fence)).toEqual(payload);
  });

  test("renderMarkdownPreError emits a stand-alone duplication-error block (no JSON fence)", () => {
    const md = renderMarkdownPreError("duplication", "git ref does not exist");
    expect(md.startsWith("# ts-hotspots duplication error")).toBe(true);
    expect(md).toContain("git ref does not exist");
    expect(md).not.toContain("```json");
  });

  test("post-stream error closes the head's open JSON fence with the error envelope", () => {
    const errPayload = {
      status: "error" as const,
      tool: { name: "ts-hotspots", version: "0.1.0" },
      error: { code: "GIT_FAILED", message: "boom" },
    };
    const doc = `${renderMarkdownHead("duplication")}${renderMarkdownErrorBody(errPayload)}`;
    expect(doc.endsWith("```\n")).toBe(true);
    expect(JSON.parse(extractJsonFence(doc))).toEqual(errPayload);
  });
});

describe("renderStatsLine", () => {
  test("uses the `ts-hotspots <feature>: <payload>` format and ends with a newline", () => {
    expect(renderStatsLine("complexity", "files=3, functions=5, candidates=2")).toBe(
      "ts-hotspots complexity: files=3, functions=5, candidates=2\n",
    );
    expect(renderStatsLine("duplication", "repo=10 files/200 fragments")).toBe(
      "ts-hotspots duplication: repo=10 files/200 fragments\n",
    );
  });
});
