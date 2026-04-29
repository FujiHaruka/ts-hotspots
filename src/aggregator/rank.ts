import type {
  AxisMeta,
  FunctionAxisId,
  FunctionCoOccurrenceEntry,
  FunctionEntry,
  FunctionMetrics,
  FunctionRef,
  HotspotCandidate,
  RankedFunctionEntry,
} from "../schema.ts";
import { FUNCTION_AXIS_IDS } from "../schema.ts";
import { compareFunctionByLocation } from "./function-location.ts";

export interface RankOptions {
  topN: number;
}

type FunctionExtractor = (e: FunctionEntry) => number;

const functionExtractors: Record<FunctionAxisId, FunctionExtractor> = {
  cognitiveComplexity: (e) => e.metrics.cognitiveComplexity ?? 0,
  cyclomaticComplexity: (e) => e.metrics.cyclomaticComplexity ?? 0,
  maxNestingDepth: (e) => e.metrics.maxNestingDepth ?? 0,
  sloc: (e) => e.metrics.sloc ?? 0,
  statementCount: (e) => e.metrics.statementCount ?? 0,
  parameterCount: (e) => e.metrics.parameterCount ?? 0,
  returnCount: (e) => e.metrics.returnCount ?? 0,
  callerCount: (e) => e.metrics.callerCount ?? 0,
  calleeCount: (e) => e.metrics.calleeCount ?? 0,
  tryCatchCount: (e) => e.metrics.tryCatchCount ?? 0,
  awaitCount: (e) => e.metrics.awaitCount ?? 0,
  mutationSiteCount: (e) => e.metrics.mutationSiteCount ?? 0,
  commitCount: (e) => e.metrics.commitCount ?? 0,
};

export function rankFunctions(
  entries: readonly FunctionEntry[],
  options: RankOptions,
): Record<FunctionAxisId, RankedFunctionEntry[]> {
  const result = {} as Record<FunctionAxisId, RankedFunctionEntry[]>;
  for (const axis of FUNCTION_AXIS_IDS) {
    const extract = functionExtractors[axis];
    const sorted = [...entries].sort((a, b) => {
      const diff = extract(b) - extract(a);
      if (diff !== 0) return diff;
      return compareFunctionByLocation(a, b);
    });
    const topSlice = sorted.slice(0, Math.max(0, options.topN));
    result[axis] = topSlice
      .map((entry) => ({
        ref: toFunctionRef(entry),
        value: extract(entry),
      }))
      .filter((e) => e.value !== 0);
  }
  return result;
}

function toFunctionRef(e: FunctionEntry): FunctionRef {
  return { location: e.location, name: e.name, kind: e.kind };
}

export function functionRefKey(ref: FunctionRef): string {
  return `${ref.location}:${ref.name}:${ref.kind}`;
}

export function collectFunctionRefKeys(
  rankings: Record<FunctionAxisId, RankedFunctionEntry[]>,
): Set<string> {
  const keys = new Set<string>();
  for (const axis of FUNCTION_AXIS_IDS) {
    for (const entry of rankings[axis]) keys.add(functionRefKey(entry.ref));
  }
  return keys;
}

export function emptyFunctionRankings(): Record<
  FunctionAxisId,
  RankedFunctionEntry[]
> {
  const result = {} as Record<FunctionAxisId, RankedFunctionEntry[]>;
  for (const axis of FUNCTION_AXIS_IDS) result[axis] = [];
  return result;
}

export function emptyFunctionAxisMeta(): Record<FunctionAxisId, AxisMeta> {
  const result = {} as Record<FunctionAxisId, AxisMeta>;
  for (const axis of FUNCTION_AXIS_IDS) {
    result[axis] = {
      nonZeroCount: 0,
      maxTieLength: 0,
      topNSpread: 0,
      uniqueTopNValues: 0,
    };
  }
  return result;
}

export function filterFunctionRankings(
  rankings: Record<FunctionAxisId, RankedFunctionEntry[]>,
  axes: readonly FunctionAxisId[],
): Record<FunctionAxisId, RankedFunctionEntry[]> {
  const allowed = new Set<FunctionAxisId>(axes);
  const result = emptyFunctionRankings();
  for (const axis of FUNCTION_AXIS_IDS) {
    if (allowed.has(axis)) result[axis] = rankings[axis];
  }
  return result;
}

export function isFunctionAxisId(id: string): id is FunctionAxisId {
  return (FUNCTION_AXIS_IDS as readonly string[]).includes(id);
}

export function computeFunctionAxisMeta(
  entries: readonly FunctionEntry[],
  rankings: Record<FunctionAxisId, RankedFunctionEntry[]>,
): Record<FunctionAxisId, AxisMeta> {
  const result = {} as Record<FunctionAxisId, AxisMeta>;
  for (const axis of FUNCTION_AXIS_IDS) {
    const extract = functionExtractors[axis];
    let nonZeroCount = 0;
    for (const entry of entries) {
      if (extract(entry) !== 0) nonZeroCount++;
    }
    const values = rankings[axis].map((e) => e.value);
    const uniqueTopNValues = new Set(values).size;
    const topNSpread =
      values.length === 0
        ? 0
        : (values[0] ?? 0) - (values[values.length - 1] ?? 0);
    let maxTieLength = 0;
    let run = 0;
    let prev: number | undefined;
    for (const v of values) {
      if (prev !== undefined && v === prev) {
        run += 1;
      } else {
        run = 1;
      }
      prev = v;
      if (run > maxTieLength) maxTieLength = run;
    }
    result[axis] = {
      nonZeroCount,
      maxTieLength,
      topNSpread,
      uniqueTopNValues,
    };
  }
  return result;
}

const functionAxisMetricKeys: Record<
  FunctionAxisId,
  readonly (keyof FunctionMetrics)[]
> = {
  cognitiveComplexity: ["cognitiveComplexity"],
  cyclomaticComplexity: ["cyclomaticComplexity"],
  maxNestingDepth: ["maxNestingDepth"],
  sloc: ["sloc"],
  statementCount: ["statementCount"],
  parameterCount: ["parameterCount"],
  returnCount: ["returnCount"],
  callerCount: ["callerCount"],
  calleeCount: ["calleeCount"],
  tryCatchCount: ["tryCatchCount"],
  awaitCount: ["awaitCount"],
  mutationSiteCount: ["mutationSiteCount"],
  commitCount: ["commitCount"],
};

const HOTSPOT_CO_OCCURRENCE_MIN_AXES = 3;
const HOTSPOT_DISCRIMINATIVE_TOP_N = 3;

const FUNCTION_AXIS_CATEGORY: Record<FunctionAxisId, "quality" | "leverage"> = {
  cognitiveComplexity: "quality",
  cyclomaticComplexity: "quality",
  maxNestingDepth: "quality",
  sloc: "quality",
  statementCount: "quality",
  parameterCount: "quality",
  returnCount: "quality",
  callerCount: "leverage",
  calleeCount: "quality",
  tryCatchCount: "quality",
  awaitCount: "quality",
  mutationSiteCount: "quality",
  commitCount: "leverage",
};

const isQualityAxis = (axis: FunctionAxisId): boolean =>
  FUNCTION_AXIS_CATEGORY[axis] === "quality";

interface AxisHits {
  ref: FunctionRef;
  axes: Set<FunctionAxisId>;
}

function buildEntryIndex(
  entries: readonly FunctionEntry[],
): Map<string, FunctionEntry> {
  const idx = new Map<string, FunctionEntry>();
  for (const e of entries) {
    idx.set(
      functionRefKey({ location: e.location, name: e.name, kind: e.kind }),
      e,
    );
  }
  return idx;
}

function accumulateHits(
  rankings: Record<FunctionAxisId, RankedFunctionEntry[]>,
  axisMeta: Record<FunctionAxisId, AxisMeta>,
  coOccurrence: readonly FunctionCoOccurrenceEntry[],
): Map<string, AxisHits> {
  const acc = new Map<string, AxisHits>();
  const addHit = (ref: FunctionRef, axis: FunctionAxisId): void => {
    const key = functionRefKey(ref);
    let cur = acc.get(key);
    if (cur === undefined) {
      cur = { ref, axes: new Set<FunctionAxisId>() };
      acc.set(key, cur);
    }
    cur.axes.add(axis);
  };

  for (const entry of coOccurrence) {
    if (entry.axisHitCount < HOTSPOT_CO_OCCURRENCE_MIN_AXES) continue;
    if (!entry.axes.some(isQualityAxis)) continue;
    for (const axis of entry.axes) addHit(entry.ref, axis);
  }

  for (const axis of FUNCTION_AXIS_IDS) {
    if (!isQualityAxis(axis)) continue;
    const meta = axisMeta[axis];
    if (meta.topNSpread <= 0 || meta.uniqueTopNValues <= 1) continue;
    const top = rankings[axis].slice(0, HOTSPOT_DISCRIMINATIVE_TOP_N);
    for (const rankedEntry of top) addHit(rankedEntry.ref, axis);
  }

  return acc;
}

function rankCandidates(
  acc: ReadonlyMap<string, AxisHits>,
  entryByKey: ReadonlyMap<string, FunctionEntry>,
): HotspotCandidate[] {
  const intermediate: {
    candidate: HotspotCandidate;
    totalHits: number;
    qualityHits: number;
  }[] = [];
  for (const { ref, axes } of acc.values()) {
    const orderedAxes = FUNCTION_AXIS_IDS.filter((a) => axes.has(a));
    const entry = entryByKey.get(functionRefKey(ref));
    const metrics: Partial<FunctionMetrics> = {};
    if (entry !== undefined) {
      for (const axis of orderedAxes) {
        for (const key of functionAxisMetricKeys[axis]) {
          const val = entry.metrics[key];
          if (val !== undefined) metrics[key] = val;
        }
      }
    }
    const qualityHits = orderedAxes.filter(isQualityAxis).length;
    intermediate.push({
      candidate: { ref, metrics, dismissalId: entry?.bodyHash ?? "" },
      totalHits: orderedAxes.length,
      qualityHits,
    });
  }

  intermediate.sort((a, b) => {
    if (a.totalHits !== b.totalHits) return b.totalHits - a.totalHits;
    if (a.qualityHits !== b.qualityHits) return b.qualityHits - a.qualityHits;
    return compareFunctionByLocation(a.candidate.ref, b.candidate.ref);
  });

  return intermediate.map((i) => i.candidate);
}

export function computeFunctionHotspotCandidates(
  entries: readonly FunctionEntry[],
  rankings: Record<FunctionAxisId, RankedFunctionEntry[]>,
  axisMeta: Record<FunctionAxisId, AxisMeta>,
  coOccurrence: readonly FunctionCoOccurrenceEntry[],
): HotspotCandidate[] {
  const entryByKey = buildEntryIndex(entries);
  const acc = accumulateHits(rankings, axisMeta, coOccurrence);
  return rankCandidates(acc, entryByKey);
}

export function computeFunctionCoOccurrence(
  rankings: Record<FunctionAxisId, RankedFunctionEntry[]>,
): FunctionCoOccurrenceEntry[] {
  const acc = new Map<
    string,
    { ref: FunctionRef; axes: Set<FunctionAxisId> }
  >();
  for (const axis of FUNCTION_AXIS_IDS) {
    for (const entry of rankings[axis]) {
      const key = functionRefKey(entry.ref);
      const cur = acc.get(key);
      if (cur === undefined) {
        acc.set(key, { ref: entry.ref, axes: new Set([axis]) });
      } else {
        cur.axes.add(axis);
      }
    }
  }
  const result: FunctionCoOccurrenceEntry[] = [];
  for (const { ref, axes } of acc.values()) {
    if (axes.size < 2) continue;
    const orderedAxes = FUNCTION_AXIS_IDS.filter((a) => axes.has(a));
    result.push({ ref, axisHitCount: orderedAxes.length, axes: orderedAxes });
  }
  result.sort((a, b) => {
    if (a.axisHitCount !== b.axisHitCount)
      return b.axisHitCount - a.axisHitCount;
    return compareFunctionByLocation(a.ref, b.ref);
  });
  return result;
}
