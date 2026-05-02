# `dup` 性能改善 — 次の周回計画

## ゴール

`dup` whole-repo モードのウォール時間を、現状 (このリポジトリ自身に対して
~2.9-3.1s) からさらに **20-30% 削減**する。bench recall@all = 0.90 と
neg violations = 0、および report 同一性 (dismissalId 集合) を維持する。

## 直近の到達点

直前の周回 (commits up to `fc0f1e5`) で達成済:

- `git cat-file --batch` 化で `listBase` 640ms → 50ms (**-93%**)
- LSH band tuning (call/statement: bands=64,rows=2 → bands=32,rows=4) で
  candidate pairs 96k → 34k (**-64%**), `headSearch` 4427 → ~1800ms
- LSH の数値 ID end-to-end 化 (`LshIndexInput.fragmentId: string → number`)
  で visit 境界の string 往復を排除
- runner 側 pair-dedup を `Set<string>` → `Set<number>` (packed `lo*stride+hi`)

セッション開始時 ~6.2s → 現状 ~2.9-3.1s で **約 -50%**。

## 現状の内訳 (5-run avg, cold start 除外)

| Phase | wall ms | %  | 備考 |
|---|---|---|---|
| diff | 9 | 0.3% | git rev-parse |
| listBase | 50 | 1.6% | cat-file batch 済 |
| churn | 19 | 0.6% | |
| baseIndex | ~1000 | 32% | TS parse + AST 走査 + feature 抽出 |
| **headSearch** | **~1750** | **57%** | |
| report | 110 | 3.6% | |

`headSearch` の内訳 (verbose log より):

- LSH builds: ~530ms (token 430 + call 70 + statement 30)
- LSH iterate (40ns/collision): ~50ms 以下
- visit overhead (~620ns/unique pair): ~30ms 以下
- **scoring: ~390-410ms** (15-20μs/pair)
- buildIntersectionsFromSets (passing pairs ~20k 分): 残り

## 試して失敗したこと (このリポジトリで再試しないこと)

### scoring の cheap-axis-first reorder + token early-exit (revert 済)

decide の OR-gate と weight 構成:

- 閾値: `combined ≥ 0.3 OR token ≥ 0.35 OR statement ≥ 0.45 OR call ≥ 0.4`
- 重み: `{token: 0.35, statement: 0.15, call: 0.25, size: 0.05, length: 0.2}`

upper-bound combined を「token=1.0 を仮定して計算」で gate にしようとしたが、
**token weight 0.35 だけで combined 閾値 0.3 を超える**ため `combinedFeasible`
判定は常時 true、early-exit 分岐が一度も発動しない dead code 化。
余分な `combinedScore()` 呼び出しと条件分岐のぶん scoring が
**388 → 411ms (+23ms 悪化)**。

教訓: scoring 周りで「一部の axis 計算をスキップ」型の最適化を試す前に、
threshold と weight の数値関係を先に検算すること。
特に `wT > combinedThreshold` が成立する限り、token を使った feasibility
判定は無効。

## 候補 (推定インパクト降順)

### 1. baseIndex の worker_threads 並列化 (高インパクト・中リスク)

**狙い**: baseIndex ~1000ms を 1/N に。N=4-8 で **300-700ms 削減**見込み。

**現状の処理** (`src/duplication/cli/runWholeRepoDetector.ts:130-160`):

```ts
for (const source of sources) {
  const parsed = parseSource(source.path, source.text);
  const fragments = extractFragments(parsed, config);
  const fileCtx = buildFileFeatureContext(parsed.sourceFile);
  for (const fragment of fragments) {
    const features = extractFeatures(fragment, parsed.sourceFile, config, fileCtx);
    entries.push({ fragment, features });
    featureSetsById.set(fragment.id, buildFeatureSets(features));
  }
}
```

ファイル単位で完全に独立 (fragmentId は `path:line` ベース)。
worker_threads で N 並列実行できる。

**設計メモ**:

- ワーカは `{path, text}` を受け取り `{fragments, features[]}` を返す純関数。
  `ts.SourceFile` はメインに戻せないので、`sourceFileByPath` (report 段階で
  使用) は worker から返らない、メインで再 parse するか、それを止めるかの判断が要る。
  - 案 A: source code text もメインに保持 → report 時に必要なら再 parse
  - 案 B: `sourceFileByPath` を pre-build せず lazy 化 (使い回す箇所が少ない)
- workerPool ラッパは Node 標準 `worker_threads` で十分。`npm:piscina` 等の
  追加依存は不要。
- pre-commit `check:strip-only` がワーカ用 entry も走らせるかを確認すること
  (現状 `tools/check-strip-only.ts` は `src/cli.ts` から到達するモジュールを
  網羅、worker entry も import される作りなら自動的にカバーされる)。
- `ts.createSourceFile` は thread-safe (TypeScript 公式の言明あり)。

**リスク**: worker 起動コスト (~50-100ms each) が dominate しないか。
ファイル数 173 / cpu 8 = 22 ファイル/worker と分配すれば worker 起動が amortize する。
小さい repo (10 ファイル等) で逆に遅くなる可能性 → ファイル数閾値で
シリアル fallback が要る。

**受け入れ条件**:

- `dup-perf-next-round` 計測で baseIndex の median が **300ms 以下**
- bench recall@all = 0.90 維持、neg violations = 0
- report dismissalId が bit-identical (worker 並列化は順序非決定だが、
  最終的に lex sort で正規化されるので report は不変なはず — 必ず確認)

### 2. MinHash signature 永続化 + token Jaccard 推定 (中インパクト・中リスク)

**狙い**: scoring 390ms のうち token Jaccard が支配 (~5μs/pair × 34k = ~170ms)。
MinHash 推定で **80-150ms 削減**。

**設計メモ**:

- LSH 構築時に作る 128-値 signature (`Uint32Array`) を fragment ごとに保持
  (memory: 128 × 4B × 4271 = ~2.2MB, OK)。
- scoring 時に agreement-count / 128 で Jaccard 推定 (~250ns/pair)。
  推定が threshold を大きく下回るペアで token Jaccard 計算をスキップ。
- 制約: containment blend (`max(jaccard, alpha*overlap_coef)`) は
  overlap_coef が MinHash で推定不可。**containment が使われないペア
  (短尺 < 20 lines) でのみ安全に fast-reject 可能**。
  → 長尺ペアでは効かない。長尺ペアの割合次第で削減幅は大きく変わる。
- API 拡張: LSH の `forEachCandidatePair` だけでなく
  `getSignature(fragmentId): Uint32Array | undefined` を公開、
  scoring 経路に runner 側で signature を渡す。

**リスク**: 推定の標準偏差は約 √(p(1-p)/128) (Jaccard p=0.35 で σ≈0.042)。
2σ マージンで安全側 (推定 < 0.27 なら reject) にすると false-reject 率は
~2.5%。bench recall に影響しないことを必ず確認。

**受け入れ条件**:

- scoring の median が **250ms 以下**
- bench recall@all = 0.90 維持
- report dismissalId 完全一致

### 3. Lazy intersection / scoring deferral (高インパクト・大リスク)

**狙い**: `report.summary` で `afterDecide=20198 → reportedPairs=1002` (95% drop)。
scoring + intersection 計算の大半が捨てられている。
**scoring 全体を 100ms 以下** に押し込める可能性。

**設計メモ**:

- 現状: scoring → shouldReport → buildIntersectionsFromSets → push to scoredPairs
  → report 段階で複数 filter (`dropLowSemanticEvidence`, `collapsePairs`,
  `dropThinWrapperPairs`, `capPerFragmentPairs`)
- 案: cheap scoring (statement+call+size+length) → approximate shouldReport
  → report-stage filter を score 値ではなく「approximate score」で適用
  → 残った pair だけ精密 scoring + intersection
- フィルタの sound 性: `dropLowSemanticEvidence` は intersection size を見る、
  `collapsePairs` は score を比較、`dropThinWrapperPairs` は AST 形状を見る。
  これらが approximate score でも安全に動くか、または再設計が必要かを精査する。

**リスク**:

- report パイプラインの依存グラフが深い。`src/duplication/report/` 配下
  すべてを精査する必要あり。
- approximate score での filter が真値 score での filter と diverge した場合、
  bench recall に影響する可能性。

**受け入れ条件**:

- scoring + intersection 合計の median が **150ms 以下**
- bench recall@all = 0.90 維持
- report dismissalId が完全一致 (もし変わる場合は fragment-level coverage で
  85% 以上の overlap を確認)

### 4. 周辺 micro-optimization (低インパクト)

variance 以下なので単独では着手しないが、上記改善のついでに入れて良い:

- scoring の重み正規化 (`combinedScore` 内の sum / div) を起動時 1 回に
  pre-compute: ~10ms
- `now()` の関数呼び出し排除 (perfLog 無効時は no-op に展開): ~5ms
- `tracker.tScore += 0` 等の useless writes を perfLog 無効時に skip: ~2ms

## 着手順序

**1 → 2 → 3** の順:

- 1 は最も独立性が高くコスパ良い (worker pool は scoring 周りに触らない)
- 2 は signature の API 設計が必要だが scoring/report は触らない
- 3 は report 周りの理解が前提で、最後にやる

各段階で計測 (`pnpm perf:dup --compare HEAD~1` 等) と bench を必ず実行する。

## 計測ハーネス

`tools/perf/dupMeasure.ts` (`pnpm perf:dup` で起動)。

- 既定: 6 回実行 (cold start 1 回 + warm 5 回) して warm の median と
  p25/p75 を per-phase で出力
- `--compare <ref>`: `git stash` で worktree を退避し `<ref>` を計測、戻して
  worktree 側を計測、A/B 表示
- `--bench`: `pnpm bench --no-ablation` を回して recall@all / neg violations を
  併記
- `--report-diff`: `--format json --limit all` で dismissalId と
  fragment-level location を A/B 抽出、bit-identical / fragment overlap を表示

## 環境メモ

- Node 24 必須 (`source /opt/nvm/nvm.sh && nvm use 24`)
- pre-commit hook: `pnpm lint-staged && pnpm typecheck && pnpm check:strip-only`
- git commit は `-c commit.gpgsign=false` 必要 (sandbox 環境の signing server 起因)
- `pnpm bench` 実行で `tools/bench/baseline/summary.{md,json}` が変わる →
  コミット前に必ず revert
