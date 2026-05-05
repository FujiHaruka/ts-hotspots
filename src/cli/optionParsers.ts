import { InvalidArgumentError } from "commander";
import type { ReportFormat } from "../cli-defaults.ts";
import {
  parseRevRange,
  type RevRange,
  RevRangeParseError,
} from "../util/git/parseRevRange.ts";

export function parseLimit(value: string): number {
  const trimmed = value.trim();
  if (trimmed.toLowerCase() === "all") return Number.POSITIVE_INFINITY;
  if (!/^\d+$/.test(trimmed)) {
    throw new InvalidArgumentError(
      `invalid --limit '${value}' (expected a positive integer or 'all')`,
    );
  }
  const n = Number.parseInt(trimmed, 10);
  if (n <= 0) {
    throw new InvalidArgumentError(
      `invalid --limit '${value}' (expected a positive integer or 'all')`,
    );
  }
  return n;
}

export function parseFormat(value: string): ReportFormat {
  if (value === "markdown" || value === "json") return value;
  throw new InvalidArgumentError(
    `invalid --format '${value}' (expected 'markdown' or 'json')`,
  );
}

export function parseDiff(value: string): RevRange {
  try {
    return parseRevRange(value);
  } catch (err) {
    if (err instanceof RevRangeParseError) {
      throw new InvalidArgumentError(err.message);
    }
    throw err;
  }
}

export function collectExcludeGlob(
  value: string,
  previous: readonly string[],
): string[] {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new InvalidArgumentError("--exclude requires a non-empty glob");
  }
  return [...previous, trimmed];
}

export function parsePositiveInteger(
  flagName: string,
): (value: string) => number {
  return (value: string): number => {
    const trimmed = value.trim();
    if (!/^\d+$/.test(trimmed)) {
      throw new InvalidArgumentError(
        `invalid ${flagName} '${value}' (expected a positive integer)`,
      );
    }
    const n = Number.parseInt(trimmed, 10);
    if (n <= 0) {
      throw new InvalidArgumentError(
        `invalid ${flagName} '${value}' (expected a positive integer)`,
      );
    }
    return n;
  };
}
