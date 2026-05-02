export interface ExcludeRules {
  globs: string[];
}

/**
 * Per-axis MinHash + LSH parameters. An axis with `enabled: false` is
 * skipped entirely (no signature work, no bucket build, no candidates).
 *
 * `numHashes` must equal `bands * rows`; `buildLshIndex` validates this
 * at construction time.
 */
export interface LshAxisConfig {
  enabled: boolean;
  numHashes: number;
  bands: number;
  rows: number;
  /**
   * Number of independent LSH passes for this axis. Each pass uses a
   * distinct hash seed family; pairs are unioned. Increases recall at
   * roughly linear cost.
   */
  seedCount: number;
  /** Base seed for the hash family. Fixing this keeps output bit-identical. */
  seed: number;
  /**
   * Defensive cap on per-band bucket size. Buckets with more than this
   * many fragments are dropped entirely — such mega-buckets come from
   * degenerate signature collisions (e.g. fragments with identical or
   * near-identical feature sets) and contribute O(k²) low-quality
   * candidate pairs that swamp scoring.
   *
   * Set to `0` or a non-positive value to disable the cap.
   */
  maxBucketSize: number;
  /**
   * Skip fragments whose feature-set size is below this floor when
   * inserting into the LSH index. Fragments with very few features
   * collapse to near-identical MinHash signatures (one shared feature key
   * → identical hash family across all 128 slots), so they all-vs-all
   * collide in every band and pollute the candidate stream with
   * `O(k²)` low-quality pairs. The cross-axis OR-gate still picks up
   * genuine clones via the other two axes.
   *
   * `1` keeps every fragment with ≥1 feature (legacy behavior); higher
   * values skip small fragments on this axis only.
   */
  minFeatures: number;
}

export interface Config {
  exclude: ExcludeRules;
  fragment: {
    statementWindowSizes: number[];
    statementWindowStride: number;
  };
  features: {
    enabled: {
      token: boolean;
      statement: boolean;
      call: boolean;
    };
    tokenNgramSizes: number[];
    statementNgramSizes: number[];
  };
  search: {
    maxCandidatesPerFragment: number;
    /**
     * Document-frequency cap on the **token** axis at query time. Posting
     * lists whose `size / totalFragments` exceeds this fraction are
     * skipped during the tally — the keys remain in the index but no
     * longer steer candidates. Tuned to drop the structural-noise n-grams
     * (e.g. `token:i\x00.\x00i`, `token:If\x00(\x00i`) that otherwise
     * pull a large fraction of every fragment into every other fragment's
     * candidate set without adding signal.
     *
     * Set to `1.0` to disable the cap entirely. The default is tuned for
     * Type-3 detection — bench-verified to keep recall on the fixture
     * suite while substantially reducing tally time.
     */
    maxTokenDocumentFrequency: number;
    /**
     * Candidate-pair generator used by `--whole-repo` mode.
     *
     * - `inverted-index`: walk `searchCandidates` per fragment. Quadratic
     *   in the fragment count — only practical up to a few thousand
     *   fragments.
     * - `lsh`: MinHash-based locality-sensitive hashing on the token
     *   feature set. Sub-quadratic; trades recall for throughput. Suitable
     *   for repo-scale scans.
     *
     * PR mode (`runDetector`) always uses the inverted-index path because
     * the changed-side fragment count is small.
     */
    wholeRepoCandidateGenerator: "inverted-index" | "lsh";
    /**
     * MinHash / LSH parameters used when `wholeRepoCandidateGenerator =
     * "lsh"`. Per-axis: each enabled axis builds its own MinHash + LSH
     * index over that axis's feature set; candidate pairs are unioned
     * across axes, deduplicated by canonical id pair, then handed to the
     * scorer.
     *
     * The S-curve inflection point of LSH banding is roughly
     * `(1 / bands) ^ (1 / rows)`; pairs whose per-axis Jaccard similarity
     * exceeds the inflection are emitted with high probability, pairs
     * below it are dropped.
     */
    lsh: {
      token: LshAxisConfig;
      call: LshAxisConfig;
      statement: LshAxisConfig;
    };
  };
  scoring: {
    weights: {
      token: number;
      statement: number;
      call: number;
      size: number;
      length: number;
    };
    thresholds: {
      combined: number;
      token: number;
      statement: number;
      call: number;
      /**
       * Minimum line count of the shorter fragment in a pair. Pairs whose
       * smaller side is below this floor are dropped before scoring.
       * Set to 0 (or negative) to disable the gate.
       */
      minLines: number;
    };
    /**
     * Line count at which `lengthScore` saturates to 1.0. The bonus uses
     * `log10(min(linesA, linesB)) / log10(lengthSaturation)`, so smaller
     * values reach saturation faster (every fragment looks "long") and
     * larger values defer the payoff to genuinely large functions.
     */
    lengthSaturation: number;
    /**
     * Hybrid Jaccard / overlap-coefficient blend for per-axis similarity.
     *
     * When both fragments are at least `minLines` long, each per-axis
     * similarity becomes `max(jaccard, alpha * overlapCoefficient)`. This
     * rescues the "long function ⊃ short function" case where Jaccard
     * underestimates similarity because the union grows with the longer
     * side. `alpha < 1` keeps full containment from saturating to 1 — only
     * exact-match Jaccard reaches 1.
     *
     * For shorter fragments overlap-coef is suppressed: 1-2 shared tokens
     * out of a 3-key set would otherwise inflate the score to 1.
     */
    containment: {
      enabled: boolean;
      minLines: number;
      alpha: number;
    };
    /**
     * Churn-based group amplifier. Multiplied into a clone group's
     * `aggregateScores.combined.max` to derive the final sort key:
     *
     *   amplifier = 1 + alpha * min(groupChurnMax, cap) / cap
     *
     * `alpha = 0` or `cap <= 0` disables the amplifier (every group
     * keeps its raw `combined.max`). With the defaults (`alpha = 0.5`,
     * `cap = 20`) a fully saturated group earns a 1.5x boost — enough
     * to flip a high-similarity-but-cold group beneath a moderate-but-
     * hot group, without letting churn overwhelm similarity entirely.
     */
    churn: {
      alpha: number;
      cap: number;
    };
  };
  report: {
    tokenNgramSampleSize: number;
    /**
     * "Thin wrapper" filter — when both fragments of a candidate pair are
     * trivial wrappers around a shared component / helper (e.g. a React
     * component whose body is just `return <SharedDialog ... />;`), the
     * pair is dropped because it is already DRYed and offers no further
     * refactor opportunity. See `dropThinWrapperPairs`.
     */
    thinWrapper: {
      enabled: boolean;
      /**
       * Maximum number of `const x = call(...)` "trivial prelude"
       * statements allowed before the single return.
       */
      maxPreludeStatements: number;
      /**
       * For `window` fragments only: an upper bound on the total number
       * of statements the window may contain. Larger windows can't be
       * thin wrappers regardless of the prelude / return shape.
       */
      maxBodyStatements: number;
    };
    /**
     * Whole-repo mode group construction — turns the symmetric pair set
     * into one clone group per dense subset of fragments. Disabled paths
     * fall back to the PR-style `changedFragment.id` pivot which produces
     * redundant `{A→{B,C}} / {B→{A,C}} / {C→{A,B}}` triplicate groups for
     * the same cluster. See `clusterPairs`.
     */
    cluster: {
      enabled: boolean;
      /**
       * Edges below this combined score do not glue cluster cores. Pairs
       * that only cleared `shouldReport` via per-axis OR (i.e. their
       * combined sits below `thresholds.combined`) are weak signals; we
       * still keep them in the report as 2-member groups but exclude
       * them from group formation.
       */
      minEdgeCombined: number;
      /**
       * Minimum edge density (`edges / C(n,2)`) required for a cluster to
       * be reported as-is. A connected component below this threshold is
       * split via greedy quasi-clique extraction; chains and weakly
       * connected nodes are dropped from the core.
       */
      minDensity: number;
      /**
       * Defensive upper bound on cluster size. Aggregate scores and
       * shared evidence are O(n²) per cluster, so a runaway clique would
       * dominate the report. Clusters above this size are split via the
       * same greedy extraction loop until each surviving cluster fits.
       */
      maxClusterSize: number;
    };
  };
}
