import { performance } from "node:perf_hooks";

export type PhaseTimingsLevel = "summary" | "verbose";

/**
 * Detailed perf-debug logger.
 *
 * The detector pipeline emits structured events (phase wall times, per-axis
 * intersection size distributions, candidate cap saturation, decide-pass
 * reasons, etc.) to a `PerfLogger` when one is provided. The runtime cost
 * of an absent logger is one `if (perfLog === undefined)` branch per
 * hot-path call — no `performance.now()` calls and no event allocations.
 */
export interface PerfLogger {
  readonly level: PhaseTimingsLevel;
  /** Emit a single event. Implementations must not mutate `payload`. */
  emit(name: string, payload: Record<string, unknown>): void;
}

/**
 * `PerfLogger` that serialises each event to a JSON line on the given
 * stream. Each line carries `{ ts: <ms_since_start>, event, ...payload }`.
 */
export class JsonlPerfLogger implements PerfLogger {
  private readonly start: number;
  private readonly out: NodeJS.WritableStream;
  readonly level: PhaseTimingsLevel;
  constructor(out: NodeJS.WritableStream, level: PhaseTimingsLevel) {
    this.out = out;
    this.level = level;
    this.start = performance.now();
  }
  emit(name: string, payload: Record<string, unknown>): void {
    const ts = round2(performance.now() - this.start);
    const line = `${JSON.stringify({ ts, event: name, ...payload })}\n`;
    this.out.write(line);
  }
}

/** In-memory `PerfLogger` for tests. Records every emission verbatim. */
export class RecordingPerfLogger implements PerfLogger {
  readonly events: { name: string; payload: Record<string, unknown> }[] = [];
  readonly level: PhaseTimingsLevel;
  constructor(level: PhaseTimingsLevel = "summary") {
    this.level = level;
  }
  emit(name: string, payload: Record<string, unknown>): void {
    this.events.push({ name, payload: { ...payload } });
  }
}

/** Phase wall times in ms, keyed by the 5 top-level pipeline phases. */
export interface PhaseTimingsRecord {
  diff: number;
  listBase: number;
  baseIndex: number;
  headSearch: number;
  report: number;
}

/**
 * `PerfLogger` that ignores everything except `phase.end` events and
 * writes the wall times into `timings`. Used by the bench harness, which
 * wants per-phase wall time but nothing else from the perf log.
 */
export class PhaseTimingsCollector implements PerfLogger {
  readonly level: PhaseTimingsLevel = "summary";
  readonly timings: PhaseTimingsRecord = {
    diff: 0,
    listBase: 0,
    baseIndex: 0,
    headSearch: 0,
    report: 0,
  };
  emit(name: string, payload: Record<string, unknown>): void {
    if (name !== "phase.end") return;
    const phase = payload.phase;
    const wallMs = payload.wallMs;
    if (typeof phase !== "string" || typeof wallMs !== "number") return;
    if (
      phase === "diff" ||
      phase === "listBase" ||
      phase === "baseIndex" ||
      phase === "headSearch" ||
      phase === "report"
    ) {
      this.timings[phase] = wallMs;
    }
  }
}

/** Round to two decimals, returning a finite number (NaN-safe). */
export function round2(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

/**
 * Pick the value at the given fractional rank in an ascending-sorted array.
 * Empty arrays return 0. `p` is clamped into `[0, 1]`.
 */
export function pct(sortedAsc: readonly number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const clamped = Math.max(0, Math.min(1, p));
  const idx = Math.min(
    sortedAsc.length - 1,
    Math.floor(sortedAsc.length * clamped),
  );
  return sortedAsc[idx] ?? 0;
}

export interface DistSummary {
  sum: number;
  p50: number;
  p90: number;
  p99: number;
  max: number;
}

/**
 * Summarise a numeric distribution as `{ sum, p50, p90, p99, max }`. Sorts
 * a copy of the input — caller's array is not mutated.
 */
export function distSummary(values: readonly number[]): DistSummary {
  if (values.length === 0) {
    return { sum: 0, p50: 0, p90: 0, p99: 0, max: 0 };
  }
  const sorted = [...values].sort((a, b) => a - b);
  let sum = 0;
  for (const v of values) sum += v;
  return {
    sum: round2(sum),
    p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
    p90:
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))] ?? 0,
    p99:
      sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))] ??
      0,
    max: sorted[sorted.length - 1] ?? 0,
  };
}

export interface MeanMax {
  mean: number;
  max: number;
}

/** Mean + max for a numeric distribution. Empty input returns 0/0. */
export function meanMax(values: readonly number[]): MeanMax {
  if (values.length === 0) return { mean: 0, max: 0 };
  let sum = 0;
  let max = values[0] ?? 0;
  for (const v of values) {
    sum += v;
    if (v > max) max = v;
  }
  return { mean: round2(sum / values.length), max };
}
