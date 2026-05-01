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
      },
      call: {
        enabled: true,
        numHashes: 128,
        // Looser banding (inflection ≈ 0.13) than the token axis: call
        // sets are 1-2 orders of magnitude smaller (mean ~6 keys), so
        // their MinHash signatures have higher variance and we need to
        // cast a wider net to surface pairs that pass via call axis
        // alone. Bench-verified to lift file-pair Jaccard meaningfully
        // without flooding scoring.
        bands: 64,
        rows: 2,
        seedCount: 1,
        // Distinct seed so the call axis uses an independent hash family
        // from the token axis. Same seed would produce correlated
        // collisions on fragments that happen to share token+call
        // structure (e.g. identical method bodies).
        seed: 0xcafebabe,
        maxBucketSize: 64,
      },
      statement: {
        enabled: true,
        numHashes: 128,
        // Same banding shape as call: statement n-gram sets are also
        // small (statementNgramSizes [2,3,4,5] over 5-15 statement
        // sequences), and the wider net is needed for the same reason.
        bands: 64,
        rows: 2,
        seedCount: 1,
        seed: 0xfeedface,
        maxBucketSize: 64,
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
