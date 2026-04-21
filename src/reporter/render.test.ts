import { describe, expect, test } from "vitest";
import { emptyFunctionAxisMeta } from "../aggregator/rank.ts";
import type { ErrorReport, FunctionReport } from "../schema.ts";
import {
  renderJson,
  renderMarkdown,
  renderMarkdownBody,
  renderMarkdownErrorBody,
  renderMarkdownHead,
} from "./render.ts";

function makeFunctionReport(
  overrides: Partial<FunctionReport> = {},
): FunctionReport {
  return {
    status: "ok",
    tool: { name: "ts-hotspots", version: "0.1.0" },
    project: {
      tsconfigPath: "/abs/tsconfig.json",
      sourceFileCount: 3,
      functionCount: 5,
    },
    functionHotspotCandidates: [],
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
    const { status, ...rest } = report;
    void status;
    expect(JSON.parse(a)).toEqual(rest);
  });

  test("renders slim FunctionReport by default with only hotspot candidates", () => {
    const report = makeFunctionReport();
    const parsed = JSON.parse(renderJson(report)) as Record<string, unknown>;
    expect(parsed.functionHotspotCandidates).toBeDefined();
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

  test("omits status for ok Report but keeps it for ErrorReport", () => {
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

describe("renderMarkdown", () => {
  test("FunctionReport: includes prompt header and JSON fence whose body matches renderJson", () => {
    const report = makeFunctionReport();
    const md = renderMarkdown(report);
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
    const md = renderMarkdown(err);
    expect(md.startsWith("# ts-hotspots error")).toBe(true);
    expect(md).toContain("missing at /x");
    expect(md).not.toContain("```json");
    expect(() => {
      JSON.parse(md);
    }).toThrow();
  });

  test("head + body compose to the same string as renderMarkdown", () => {
    const report = makeFunctionReport();
    const composed = `${renderMarkdownHead()}${renderMarkdownBody(report)}`;
    expect(composed).toBe(renderMarkdown(report));
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
    expect(renderMarkdownHead()).toBe(renderMarkdownHead());
    // Building the streamed form for two different reports yields the same head.
    const headA = renderMarkdown(a).slice(0, renderMarkdownHead().length);
    const headB = renderMarkdown(b).slice(0, renderMarkdownHead().length);
    expect(headA).toBe(renderMarkdownHead());
    expect(headB).toBe(renderMarkdownHead());
  });

  test("error body closes the fence and carries the error JSON", () => {
    const err: ErrorReport = {
      status: "error",
      error: { code: "X", message: "boom" },
    };
    const body = renderMarkdownErrorBody(err);
    expect(body.endsWith("```\n")).toBe(true);
    // Head + errorBody must form a well-formed fenced-JSON Markdown document.
    const doc = `${renderMarkdownHead()}${body}`;
    const match = /```json\n([\s\S]*?)\n```/.exec(doc);
    expect(match).not.toBeNull();
    const parsed = JSON.parse(match?.[1] ?? "") as ErrorReport;
    expect(parsed).toEqual(err);
  });
});
