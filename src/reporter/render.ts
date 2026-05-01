import type { ErrorReport, FunctionReport } from "../schema.ts";
import { ERROR_REPORT_PROMPT, FUNCTION_REPORT_PROMPT } from "./prompt.ts";

export function renderJson(report: FunctionReport | ErrorReport): string {
  return `${JSON.stringify(report, null, 2)}\n`;
}

const MARKDOWN_HEAD = `${FUNCTION_REPORT_PROMPT}\n## Data\n\n\`\`\`json\n`;

export function renderMarkdownHead(): string {
  return MARKDOWN_HEAD;
}

export function renderMarkdownBody(
  report: FunctionReport & { status: "ok" },
): string {
  return `${JSON.stringify(report, null, 2)}\n\`\`\`\n`;
}

export function renderMarkdownErrorBody(report: ErrorReport): string {
  return `${JSON.stringify(report, null, 2)}\n\`\`\`\n`;
}

export function renderMarkdown(report: FunctionReport | ErrorReport): string {
  if (report.status === "error") {
    const { message } = report.error;
    return `${ERROR_REPORT_PROMPT}\n${message}\n`;
  }
  return `${renderMarkdownHead()}${renderMarkdownBody(report)}`;
}
