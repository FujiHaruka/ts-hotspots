import { DEFAULT_EXCLUDE_GLOBS } from "../../defaults.ts";
import type { Config } from "./config.ts";

export const defaultConfig: Config = {
  exclude: {
    globs: [...DEFAULT_EXCLUDE_GLOBS],
  },
  fragment: {
    statementWindowSizes: [5, 10],
    statementWindowStride: 3,
  },
  features: {
    enabled: {
      token: true,
      statement: true,
      call: true,
    },
    tokenNgramSizes: [3, 4, 5, 6],
    statementNgramSizes: [2, 3, 4, 5],
  },
  search: {
    maxCandidatesPerFragment: 100,
    maxTokenDocumentFrequency: 0.15,
    wholeRepoCandidateGenerator: "lsh",
    lsh: {
      token: {
        enabled: true,
        numHashes: 128,
        bands: 32,
        rows: 4,
        seedCount: 1,
        seed: 0xdeadbeef,
        maxBucketSize: 64,
        minFeatures: 1,
      },
      call: {
        enabled: true,
        numHashes: 128,
        // Same banding shape as the token axis (inflection ≈ 0.42). The
        // earlier looser setting (rows=2, inflection 0.13) was meant to
        // cast a wider net for the small call set, but that produced
        // mega-bucket collisions (max 143 deep) and ~22k candidate
        // pairs whose call Jaccard was too low to clear the 0.4
        // statement-axis report threshold anyway.
        bands: 32,
        rows: 4,
        seedCount: 1,
        // Distinct seed so the call axis uses an independent hash family
        // from the token axis. Same seed would produce correlated
        // collisions on fragments that happen to share token+call
        // structure (e.g. identical method bodies).
        seed: 0xcafebabe,
        maxBucketSize: 64,
        minFeatures: 1,
      },
      statement: {
        enabled: true,
        numHashes: 128,
        // Tighter banding than the call axis (inflection ≈ 0.42 vs 0.13).
        // Statement n-gram sets are small (mean ≈ 2.7, p50=0) and their
        // alphabet is tiny, so a loose threshold floods the candidate
        // stream with mega-bucket collisions (worst observed: 234
        // fragments deep). Genuine clones tend to share most of their
        // statement n-grams when they share any (the alphabet is small),
        // so the surviving signal at J ≥ 0.42 stays well above the
        // 0.45 statement-axis report threshold.
        bands: 32,
        rows: 4,
        seedCount: 1,
        seed: 0xfeedface,
        maxBucketSize: 64,
        minFeatures: 1,
      },
    },
  },
  scoring: {
    weights: {
      token: 0.35,
      statement: 0.15,
      call: 0.25,
      size: 0.05,
      length: 0.2,
    },
    thresholds: {
      combined: 0.3,
      token: 0.35,
      statement: 0.45,
      call: 0.4,
      minLines: 4,
    },
    lengthSaturation: 80,
    containment: {
      enabled: true,
      minLines: 20,
      alpha: 0.85,
    },
    churn: {
      alpha: 0.5,
      cap: 20,
    },
  },
  report: {
    tokenNgramSampleSize: 5,
    thinWrapper: {
      enabled: true,
      maxPreludeStatements: 2,
      maxBodyStatements: 4,
    },
    cluster: {
      enabled: true,
      minEdgeCombined: 0.3,
      minDensity: 0.6,
      maxClusterSize: 50,
    },
  },
};
