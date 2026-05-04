/**
 * Micro-bench for the token n-gram build + compare hot path.
 *
 * Purpose: isolate the cost shape that `pnpm bench:scale` muddies with
 * surrounding work (parsing, diff, scoring axes other than tokens). Four
 * variants live side by side here; the same input feeds each so we can
 * compare like-for-like with no scaffolding noise.
 *
 * Variants:
 *   V0  baseline       — long token strings ("LPAREN" etc.), `slice` + `join`,
 *                        FeatureKey = string with " " separator.
 *   V1  manual-concat  — same long tokens, manual `for` concat instead of
 *                        slice+join.
 *   V2  short-tokens   — short tokens ("(", "}", "i", "Re" ...), manual
 *                        concat, "\x00" separator.
 *   V3  symbol         — variant V2's keys passed through Symbol.for, sets
 *                        held as Set<symbol>.
 *
 * For each variant we time:
 *   build  — produce all n-gram keys for F fragments × T tokens,
 *            sizes [3,4,5,6].
 *   pairs  — build a Set per fragment, then run NPAIRS Jaccard-style probes
 *            (the smaller-set ⊆ larger-set walk used by `jaccardCount`).
 *
 * Output: median of 5 runs, build / pairs / total (ms) per variant, written
 * to stdout and appended to tools/bench/baseline/ngram-build.md.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";
import { parseArgs } from "node:util";

// ---- input shape -----------------------------------------------------------

const SIZES = [3, 4, 5, 6] as const;

interface Args {
  fragments: number;
  tokens: number;
  pairs: number;
  runs: number;
  out: string;
  label: string;
  print: boolean;
}

function parseCli(argv: readonly string[]): Args {
  const { values } = parseArgs({
    args: argv.slice(2),
    options: {
      fragments: { type: "string", default: "200" },
      tokens: { type: "string", default: "400" },
      pairs: { type: "string", default: "6000" },
      runs: { type: "string", default: "5" },
      out: { type: "string", default: "tools/bench/baseline/ngram-build.md" },
      label: { type: "string", default: "" },
      print: { type: "boolean", default: false },
    },
    strict: true,
  });
  const toInt = (s: string, name: string): number => {
    const n = Number.parseInt(s, 10);
    if (!Number.isFinite(n) || n <= 0) {
      throw new Error(`${name} must be a positive integer`);
    }
    return n;
  };
  return {
    fragments: toInt(values.fragments, "--fragments"),
    tokens: toInt(values.tokens, "--tokens"),
    pairs: toInt(values.pairs, "--pairs"),
    runs: toInt(values.runs, "--runs"),
    out: values.out,
    label: values.label,
    print: values.print,
  };
}

// xorshift32 — small, fast, deterministic across runs and platforms.
function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  if (s === 0) s = 0x9e3779b9;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

// Two parallel token vocabularies of equal length. Each index pair maps the
// same logical kind to its long and short string forms. The ngram builder
// only sees the indices used to address the chosen vocab.
const VOCAB_LONG: readonly string[] = [
  "ID",
  "STR",
  "NUM",
  "BOOL",
  "NULL",
  "REGEX",
  "IF",
  "ELSE",
  "RETURN",
  "FOR",
  "WHILE",
  "DO",
  "SWITCH",
  "CASE",
  "DEFAULT",
  "BREAK",
  "CONTINUE",
  "TRY",
  "CATCH",
  "FINALLY",
  "THROW",
  "NEW",
  "DELETE",
  "TYPEOF",
  "VOID",
  "FUNCTION",
  "CLASS",
  "EXTENDS",
  "IMPLEMENTS",
  "THIS",
  "SUPER",
  "CONST",
  "LET",
  "VAR",
  "ASYNC",
  "AWAIT",
  "YIELD",
  "IMPORT",
  "EXPORT",
  "FROM",
  "AS",
  "LBRACE",
  "RBRACE",
  "LPAREN",
  "RPAREN",
  "LBRACKET",
  "RBRACKET",
  "SEMI",
  "COMMA",
  "DOT",
  "SPREAD",
  "QUESTION",
  "QUESTIONDOT",
  "NULLISH",
  "COLON",
  "AT",
  "EQ",
  "EQEQ",
  "EQEQEQ",
  "BANG",
  "NEQ",
  "NEQEQ",
  "LT",
  "LTE",
  "GT",
  "GTE",
  "PLUS",
  "MINUS",
  "STAR",
  "POW",
  "SLASH",
  "PERCENT",
  "AMP",
  "AND",
  "BAR",
  "OR",
  "CARET",
  "TILDE",
  "ARROW",
];

const VOCAB_SHORT: readonly string[] = [
  "i",
  "s",
  "n",
  "b",
  "u",
  "r",
  "If",
  "El",
  "Re",
  "Fo",
  "Wh",
  "Do",
  "Sw",
  "Ca",
  "De",
  "Br",
  "Co",
  "Tr",
  "Ct",
  "Fi",
  "Th",
  "Nw",
  "Dl",
  "Ty",
  "Vo",
  "Fn",
  "Cl",
  "Ex",
  "Im",
  "ts",
  "Su",
  "Cn",
  "Le",
  "Va",
  "As",
  "Aw",
  "Yi",
  "Ip",
  "Ep",
  "Fm",
  "as",
  "{",
  "}",
  "(",
  ")",
  "[",
  "]",
  ";",
  ",",
  ".",
  "..",
  "?",
  "?.",
  "??",
  ":",
  "@",
  "=",
  "==",
  "===",
  "!",
  "!=",
  "!==",
  "<",
  "<=",
  ">",
  ">=",
  "+",
  "-",
  "*",
  "**",
  "/",
  "%",
  "&",
  "&&",
  "|",
  "||",
  "^",
  "~",
  "=>",
];

if (VOCAB_LONG.length !== VOCAB_SHORT.length) {
  throw new Error("vocab length mismatch");
}

function buildIndexMatrix(
  fragments: number,
  tokens: number,
  rng: () => number,
): Uint8Array[] {
  const out: Uint8Array[] = [];
  const v = VOCAB_LONG.length;
  for (let f = 0; f < fragments; f += 1) {
    const arr = new Uint8Array(tokens);
    for (let t = 0; t < tokens; t += 1) {
      arr[t] = Math.floor(rng() * v);
    }
    out.push(arr);
  }
  return out;
}

function indicesToTokens(
  rows: Uint8Array[],
  vocab: readonly string[],
): string[][] {
  const out: string[][] = [];
  for (const row of rows) {
    const tokens = new Array<string>(row.length);
    for (let i = 0; i < row.length; i += 1) {
      const idx = row[i] ?? 0;
      tokens[i] = vocab[idx] ?? "";
    }
    out.push(tokens);
  }
  return out;
}

// ---- builders --------------------------------------------------------------

function buildV0_sliceJoin(tokens: string[]): string[] {
  // baseline shape — unchanged from src/features/normalizedTokenNgram.ts
  // before any phase of this plan landed.
  const out: string[] = [];
  for (const size of SIZES) {
    if (size <= 0 || tokens.length < size) continue;
    for (let i = 0; i + size <= tokens.length; i += 1) {
      const slice = tokens.slice(i, i + size).join(" ");
      out.push(`token:${slice}`);
    }
  }
  return out;
}

function buildV1_manualConcat(tokens: string[]): string[] {
  const out: string[] = [];
  for (const size of SIZES) {
    if (size <= 0 || tokens.length < size) continue;
    for (let i = 0; i + size <= tokens.length; i += 1) {
      let key = `token:${tokens[i] ?? ""}`;
      for (let j = 1; j < size; j += 1) {
        key += ` ${tokens[i + j] ?? ""}`;
      }
      out.push(key);
    }
  }
  return out;
}

function buildV2_shortTokensConcat(tokens: string[]): string[] {
  // Short vocab + manual concat + NUL separator.
  const SEP = "\x00";
  const out: string[] = [];
  for (const size of SIZES) {
    if (size <= 0 || tokens.length < size) continue;
    for (let i = 0; i + size <= tokens.length; i += 1) {
      let key = `token:${tokens[i] ?? ""}`;
      for (let j = 1; j < size; j += 1) {
        key += SEP + (tokens[i + j] ?? "");
      }
      out.push(key);
    }
  }
  return out;
}

function buildV3_symbolKey(tokens: string[]): symbol[] {
  // Same shape as V2 but each finished string is folded through Symbol.for.
  const SEP = "\x00";
  const out: symbol[] = [];
  for (const size of SIZES) {
    if (size <= 0 || tokens.length < size) continue;
    for (let i = 0; i + size <= tokens.length; i += 1) {
      let key = `token:${tokens[i] ?? ""}`;
      for (let j = 1; j < size; j += 1) {
        key += SEP + (tokens[i + j] ?? "");
      }
      out.push(Symbol.for(key));
    }
  }
  return out;
}

// ---- compare loop ----------------------------------------------------------

function jaccardLikeStrings(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const k of small) {
    if (large.has(k)) inter += 1;
  }
  const u = a.size + b.size - inter;
  return u === 0 ? 0 : inter / u;
}

function jaccardLikeSymbols(a: Set<symbol>, b: Set<symbol>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let inter = 0;
  for (const k of small) {
    if (large.has(k)) inter += 1;
  }
  const u = a.size + b.size - inter;
  return u === 0 ? 0 : inter / u;
}

interface PairPlan {
  i: number;
  j: number;
}

function makePairPlan(
  fragments: number,
  npairs: number,
  seed: number,
): PairPlan[] {
  const rng = makeRng(seed);
  const pairs = new Array<PairPlan>(npairs);
  for (let p = 0; p < npairs; p += 1) {
    const i = Math.floor(rng() * fragments);
    let j = Math.floor(rng() * fragments);
    if (j === i) j = (j + 1) % fragments;
    pairs[p] = { i, j };
  }
  return pairs;
}

// ---- per-variant runner ----------------------------------------------------

interface Sample {
  buildMs: number;
  pairsMs: number;
  totalMs: number;
  // sink for the optimizer; printed as a checksum-like number
  acc: number;
}

function runStringVariant(
  rows: Uint8Array[],
  vocab: readonly string[],
  builder: (tokens: string[]) => string[],
  pairPlan: PairPlan[],
): Sample {
  const tokenLists = indicesToTokens(rows, vocab);
  const t0 = performance.now();
  const features = new Array<string[]>(tokenLists.length);
  for (let f = 0; f < tokenLists.length; f += 1) {
    features[f] = builder(tokenLists[f] ?? []);
  }
  const t1 = performance.now();
  const sets = new Array<Set<string>>(features.length);
  for (let f = 0; f < features.length; f += 1) {
    sets[f] = new Set(features[f]);
  }
  let acc = 0;
  for (const { i, j } of pairPlan) {
    const a = sets[i];
    const b = sets[j];
    if (a === undefined || b === undefined) continue;
    acc += jaccardLikeStrings(a, b);
  }
  const t2 = performance.now();
  return { buildMs: t1 - t0, pairsMs: t2 - t1, totalMs: t2 - t0, acc };
}

function runSymbolVariant(
  rows: Uint8Array[],
  vocab: readonly string[],
  builder: (tokens: string[]) => symbol[],
  pairPlan: PairPlan[],
): Sample {
  const tokenLists = indicesToTokens(rows, vocab);
  const t0 = performance.now();
  const features = new Array<symbol[]>(tokenLists.length);
  for (let f = 0; f < tokenLists.length; f += 1) {
    features[f] = builder(tokenLists[f] ?? []);
  }
  const t1 = performance.now();
  const sets = new Array<Set<symbol>>(features.length);
  for (let f = 0; f < features.length; f += 1) {
    sets[f] = new Set(features[f]);
  }
  let acc = 0;
  for (const { i, j } of pairPlan) {
    const a = sets[i];
    const b = sets[j];
    if (a === undefined || b === undefined) continue;
    acc += jaccardLikeSymbols(a, b);
  }
  const t2 = performance.now();
  return { buildMs: t1 - t0, pairsMs: t2 - t1, totalMs: t2 - t0, acc };
}

// ---- bench plumbing --------------------------------------------------------

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[m] ?? 0;
  return ((s[m - 1] ?? 0) + (s[m] ?? 0)) / 2;
}

interface VariantResult {
  name: string;
  buildMs: number;
  pairsMs: number;
  totalMs: number;
  acc: number;
}

function runAll(args: Args): VariantResult[] {
  const dataRng = makeRng(0xc0ffee);
  const rows = buildIndexMatrix(args.fragments, args.tokens, dataRng);
  const pairPlan = makePairPlan(args.fragments, args.pairs, 0xfeed1234);

  // warmup once per variant to stabilise JIT.
  runStringVariant(rows, VOCAB_LONG, buildV0_sliceJoin, pairPlan);
  runStringVariant(rows, VOCAB_LONG, buildV1_manualConcat, pairPlan);
  runStringVariant(rows, VOCAB_SHORT, buildV2_shortTokensConcat, pairPlan);
  runSymbolVariant(rows, VOCAB_SHORT, buildV3_symbolKey, pairPlan);

  const variants: {
    name: string;
    fn: () => Sample;
  }[] = [
    {
      name: "V0  long / slice+join / string",
      fn: () => runStringVariant(rows, VOCAB_LONG, buildV0_sliceJoin, pairPlan),
    },
    {
      name: "V1  long / manual concat / string",
      fn: () =>
        runStringVariant(rows, VOCAB_LONG, buildV1_manualConcat, pairPlan),
    },
    {
      name: "V2  short / manual concat / string",
      fn: () =>
        runStringVariant(
          rows,
          VOCAB_SHORT,
          buildV2_shortTokensConcat,
          pairPlan,
        ),
    },
    {
      name: "V3  short / manual concat / symbol",
      fn: () =>
        runSymbolVariant(rows, VOCAB_SHORT, buildV3_symbolKey, pairPlan),
    },
  ];

  const results: VariantResult[] = [];
  for (const v of variants) {
    const builds: number[] = [];
    const pairs: number[] = [];
    const totals: number[] = [];
    let lastAcc = 0;
    for (let r = 0; r < args.runs; r += 1) {
      const s = v.fn();
      builds.push(s.buildMs);
      pairs.push(s.pairsMs);
      totals.push(s.totalMs);
      lastAcc = s.acc;
    }
    results.push({
      name: v.name,
      buildMs: median(builds),
      pairsMs: median(pairs),
      totalMs: median(totals),
      acc: lastAcc,
    });
  }
  return results;
}

function formatBlock(args: Args, results: VariantResult[]): string {
  const lines: string[] = [];
  const stamp = new Date().toISOString();
  const baseline = results[0]?.totalMs ?? 0;
  const header =
    args.label.length > 0 ? `## ${args.label} — ${stamp}` : `## run ${stamp}`;
  lines.push(header);
  lines.push("");
  lines.push(
    `params: F=${String(args.fragments)}, T=${String(args.tokens)}, sizes=[${SIZES.join(",")}], pairs=${String(args.pairs)}, runs=${String(args.runs)} (median)`,
  );
  lines.push("");
  lines.push(
    "| variant                                | build ms | pairs ms | total ms | vs V0 |",
  );
  lines.push(
    "|----------------------------------------|---------:|---------:|---------:|------:|",
  );
  const fmt = (n: number): string => n.toFixed(1);
  for (const r of results) {
    const delta =
      baseline === 0
        ? "  —"
        : `${(((r.totalMs - baseline) / baseline) * 100).toFixed(0)}%`;
    lines.push(
      `| ${r.name.padEnd(38)} | ${fmt(r.buildMs).padStart(8)} | ${fmt(r.pairsMs).padStart(8)} | ${fmt(r.totalMs).padStart(8)} | ${delta.padStart(5)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

function ensureFile(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  if (!existsSync(path)) {
    writeFileSync(
      path,
      "# token n-gram build/compare micro-bench\n\nResults from `pnpm bench:ngram`. Each block records median ms over the configured runs for build (n-gram construction) and pairs (Jaccard-style Set probes) phases.\n\n",
      "utf-8",
    );
  }
}

function main(): number {
  const args = parseCli(process.argv);
  const results = runAll(args);
  const block = formatBlock(args, results);
  if (args.print) {
    process.stdout.write(`${block}\n`);
    return 0;
  }
  ensureFile(args.out);
  appendFileSync(args.out, `${block}\n`, "utf-8");
  process.stdout.write(`${block}\n`);
  process.stderr.write(`appended to ${args.out}\n`);
  return 0;
}

const isMain = import.meta.url === `file://${process.argv[1] ?? ""}`;
if (isMain) {
  try {
    process.exit(main());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`microNgramBuild: ${msg}\n`);
    process.exit(1);
  }
}
