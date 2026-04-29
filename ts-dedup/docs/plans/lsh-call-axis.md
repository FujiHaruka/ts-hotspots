# Multi-axis LSH (call 軸の追加) 計画

## 目的

現状の MinHash LSH は **token 軸の特徴集合だけ**でバンディングしている。
`shouldReport` は OR 条件 (combined / token / statement / call の各閾値) で
通すので、`J(token) < LSH inflection` なのに **call 軸主導**で通っているペアが
legacy には多数あり、これらが LSH 経路では候補にすら入らない。

call 軸用の LSH をもう一段組んで、token-LSH と call-LSH の候補集合を **union**
することで、recall を 0.55 → 0.75-0.85 へ引き上げる。speedup は犠牲になる
(ts-dedup self-scan で +15-30% 程度の wall 増、大規模リポでは fixed overhead
に埋もれてもっと小さい)。

## 現状認識 (前セッションで取得した実測)

ts-dedup self-scan (1,735 frags) の legacy `decide.summary.passReasons`:

```
combined=1597, token=1994, statement=352, call=884, anyAxis=2053  (passed total: 3890)
```

このうち **call 軸 884 件** には `J(token)` が LSH inflection (0.42) を下回る
ペアが含まれており、現状の token-only LSH では拾えていない。最終 report の
file-pair Jaccard が 0.55 で止まっている主因と推定。

参考: token 軸の特徴集合サイズ分布 `p50=37, p90=421, p99=1486, max=2128`
(空集合 729 frags = 42% は LSH では明示的に skip 済)。call 軸は perfLog の
`intersectionSizes.call.mean = 6.62, max = 94` から推定して **set サイズが
1-2 桁小さい**。

## 設計

### 1. LSH index を **軸ごとに別々に build**

`buildLshIndex` の API はそのまま。runWholeRepoDetector が 2 個の index を
独立に build し、`forEachCandidatePair` を 2 回呼んで結果を **canonical key
で union** する。

```ts
// 概念 (擬似コード)
const tokenLsh = buildLshIndex(tokenInputs, config.search.lsh.token);
const callLsh = buildLshIndex(callInputs, config.search.lsh.call);

const seen = new Set<string>();
const emit = (a: string, b: string) => {
  const key = a < b ? `${a}|${b}` : `${b}|${a}`;
  if (seen.has(key)) return;
  seen.add(key);
  scoreOne(a, b);
};
tokenLsh.forEachCandidatePair(emit);
callLsh.forEachCandidatePair(emit);
```

**注意**: `forEachCandidatePair` 内部の seen Set とは別に、軸間の dedup が必要。
今 token-only では index 内の seen で済んでいたが、軸 union では runner 側で
seen を持つ。

### 2. config schema を per-axis に拡張

旧:

```ts
lsh: { numHashes, bands, rows, seedCount, seed, maxBucketSize }
```

新:

```ts
lsh: {
  token: { enabled: boolean, numHashes, bands, rows, seedCount, seed, maxBucketSize },
  call:  { enabled: boolean, numHashes, bands, rows, seedCount, seed, maxBucketSize },
  // statement 軸は意図的に省略 (set サイズが小さすぎる、後述)
}
```

`enabled: false` で軸を OFF にできるよう保つ (debug や ablation 用)。

### 3. 各軸のパラメータ初期値

| 軸 | numHashes | bands | rows | inflection | 根拠 |
|---|---:|---:|---:|---:|---|
| token | 128 | 32 | 4 | 0.42 | 現状そのまま、`shouldReport` の token 閾値 0.35 を緩く包含 |
| call | 128 | 32 | 4 | 0.42 | call 閾値 0.4 をほぼカバー。set が小さいので分散は大きいが OR union なので False Positive 寄りで OK |

`maxBucketSize` は両軸とも 64 で開始。call は set が小さく一意性が低いので
バケットが大きくなる可能性 (要観測、必要なら 32 に下げる)。

### 4. statement 軸を含めない理由

- 集合サイズが極めて小さい (`statementNgramSizes: [2,3,4,5]`、blob ごとの
  statement 列が 5-15 件 → n-gram 数は数十〜)
- MinHash の精度 (J 推定の標準誤差 ≈ √(J(1-J)/k)) は set サイズに依存しないが、
  **空集合 / 単一要素集合の比率が高い**と sentinel `UINT32_MAX` が dominate し、
  token 軸の "empty fragment 729 個全衝突" と同じ degenerate を起こしうる
- legacy の `passReasons.statement = 352 / 3890 (9%)` で寄与が一番小さい
- → 必要になったら後から追加 (難しくない)

### 5. perfLog の拡張

`lsh.summary` を per-axis で 2 回 emit + union 後の集計を 1 回:

```jsonl
{"event":"lsh.summary","axis":"token", ...}
{"event":"lsh.summary","axis":"call", ...}
{"event":"lsh.union","tokenPairs":2850,"callPairs":1800,"unionPairs":4200,"overlapPairs":450}
```

これで「どの軸が何を稼いでいるか」「軸間 overlap 率」が見える。
`overlapPairs` が極端に大きければ片軸を切れる判断材料に。

## 実装手順

1. **(計測) 現状の "失われたペア" を可視化**:
   - legacy と LSH を両方 run、`shouldReport` を通って LSH では候補にすら入らない
     ペアの集合を抽出
   - そのうち何件が call 閾値で通っているか / J(token) の分布、を出す
   - これを実装前のベースラインとして記録 (call-LSH を入れたあとに
     "実装前にこれだけ拾えていなかった" → "実装後はこれだけ拾えた" を直接
     比較できる)
2. config schema を per-axis に変更 (`config.ts` + `defaults.ts`)
3. `runWholeRepoDetector.runLshCandidateGeneration` を多軸対応に書き換え:
   - 各軸の input を別配列で構築
   - 軸ごとに `buildLshIndex` → `forEachCandidatePair`
   - runner 側 `seenPairs` で軸間 dedup
4. `perfLogEvents.emitLshSummary` を `axis` フィールド付きに、`lsh.union`
   イベント追加
5. 単体テスト: 多軸 union が seen で正しく dedup されることを確認 (LSH モジュール
   自体は変更不要、runner レイヤのテスト)
6. ts-dedup self-scan で recall + wall 計測。「失われたペア」がどれだけ
   救済されたか確認
7. 必要なら call 軸の params を sweep (b/r、cap)

## パラメータ調整方針

最初は token / call 両軸とも `b=32, r=4, cap=64, seed=1` で start。

その後 sweep:

- `call.bands ∈ {32, 16, 64}` (16 で高 recall、64 で速度)
- `call.maxBucketSize ∈ {64, 32, 16}` (degenerate 抑制)
- `call.seedCount ∈ {1, 2}` (recall 微調整)

判断基準:
- **wall 上限**: ts-dedup self-scan で 2.5s 以内 (現状 1.5s + 余裕 1s)
- **recall 下限**: file-pair Jaccard vs legacy 0.75 以上
- **大規模 (32x scale = 55k frags)** で wall 1 分以内維持

## 期待効果 (ts-dedup self-scan、median of 5)

| 指標 | 現状 (token-only) | 期待 (token + call) | Δ |
|---|---:|---:|---:|
| 候補ペア数 | 2,850 | ~5,000-6,000 | +75-110% |
| LSH build wall | 264ms | ~500ms | +236ms |
| scoring wall | 61ms | ~100-120ms | +50ms |
| total wall | 1,544ms | ~1,800-2,000ms | +15-30% |
| **file-pair Jaccard vs legacy** | **0.55** | **0.75-0.85** | **+0.20-0.30** |
| `pnpm bench` recall@all | 0.95 | 0.95 | 不変 (PR モードは LSH 経路を通らない) |

スケール側: 32x corpus (55k frags) で legacy 推定 ~70 分 → token-only LSH 36s
(110x speedup) → token+call LSH 推定 50-60s (~75-90x speedup)。speedup は
落ちるが二桁は維持。

## 互換性 / リスク

- **config 破壊変更**: `lsh.{numHashes, bands, rows, ...}` がフラット → ネスト
  `lsh.token.{...}` / `lsh.call.{...}` に変わる。外部 config に依存している
  ユーザがいない前提 (現時点で `lsh` config はこの PR で初導入)。
- **call 軸の signature が degenerate しやすい可能性**: call set が空 / 極小
  の fragment 比率が高ければ、token 軸で起きていた "empty signature 全衝突"
  と同じ問題が起きる。`buildLshIndex` の empty-skip ロジックは既に入っているので
  そのまま効くが、small-but-not-empty (1-2 features) のケースで `cap` 必要に
  なるかもしれない。実測で監視。
- **wall regression**: 期待通り +15-30% で済むかは call set の collision 数次第。
  最悪ケース (call buckets が degenerate) で wall が 2-3x になる可能性。
  bucket size cap で抑制する。

## 完了基準

- ts-dedup self-scan の **file-pair Jaccard vs legacy ≥ 0.75** (目標 0.85)
- ts-dedup self-scan の **wall ≤ 2.5s** (5-run median)
- 32x scale corpus で **wall ≤ 90s** (現状 36s からの 2.5x 以内)
- `pnpm bench` の recall@all = 0.95 不変
- `pnpm test` 全パス
- `--phase-timings` の `lsh.summary` (axis 別) と `lsh.union` で軸ごとの
  寄与が観測可能

## 後続候補 (本計画の範囲外)

- 軸ごとに別の `numHashes / cap` (call は k=64 でも十分かもしれない、
  メモリ削減狙いで sweep する価値あり)
- 並列化: 各軸の LSH build を Worker で並列に (fixed overhead 圧縮)

## 実施結果

予定通り call 軸を追加した上で、**statement 軸も同時に追加した**。
当初 plan で範囲外としていたが、Step 1 の lost-pairs 計測で
`only-statement` ペアが 698 件と最大の取りこぼし要因であることが判明し、
`buildLshIndex` 既存の empty-skip + bucket-cap defenses で degenerate を
防げる見込みが高かったため scope に取り込んだ (commit `db09e2e`)。

### Step 1 で記録した lost-pairs ベースライン (token-only LSH 時点)

| 指標 | 数 |
|---|---:|
| legacy passed (post-decide) | 4,052 |
| LSH (token-only) passed | 2,168 (-46%) |
| **lost (legacy passed, LSH missed)** | **1,889** |
| └ only-call (call axis alone) | 192 |
| └ only-statement (statement axis alone) | 698 ← 最大の取りこぼし |
| └ J(call) ≥ 0.42 (call-LSH inflection) | 366 |

### config 変更

`lsh.{numHashes, bands, ...}` フラット構造 → `lsh.{token, call, statement}`
の per-axis ネスト構造。各軸に `enabled: boolean` + 独立 `seed`。

| 軸 | bands | rows | inflection | seed | 根拠 |
|---|---:|---:|---:|---:|---|
| token | 32 | 4 | 0.42 | 0xDEADBEEF | 既存と同じ |
| call | 64 | 2 | 0.13 | 0xCAFEBABE | call set が小さいため looser に変更 (sweep で確認) |
| statement | 64 | 2 | 0.13 | 0xFEEDFACE | call と同じ理由 (small-set) |

### 軸別の貢献 (file-pair Jaccard vs legacy、ts-dedup self-scan)

| variant | J vs legacy | kept / 217 | wall (mean of 2) |
|---|---:|---:|---:|
| LSH token-only | 0.553 | 125 | 1148ms |
| LSH token + call | 0.683 | 168 | 1403ms |
| LSH token + statement | 0.861 | 198 | 1637ms |
| **LSH 3-axis (default)** | **0.871** | **210** | **1790ms** |

statement 軸が単独で recall を 0.55 → 0.86 に押し上げた最大の貢献者。
call 軸はそこに +12 file-pairs (210/217) 上積み。

### 5-run 計測 (whole-repo self-scan, median)

| phase | 旧 (token-only) | 新 (3-axis) | Δ |
|---|---:|---:|---:|
| diff | 10 | 8 | ±0 |
| listBase | 370 | 326 | -44 |
| baseIndex | 656 | 539 | -117 |
| **headSearch** | **502** | **1,061** | +559 (LSH build × 3 軸 + scoring) |
| ┗ scoring | 61 | 332 | +271 (候補ペア 2.85k → 28k で約 10x) |
| report | 8 | 12 | ±0 |
| **total** | **1,544ms** | **1,947ms** | **+403ms (+26%)** |

### Scale test (合成: ts-dedup を 32x 複製)

| scale | frags | LSH 3-axis wall (algo) | (legacy 推定) | speedup |
|---|---:|---:|---:|---:|
| 1x | 1,845 | 798ms | 3.6s | 4.5x |
| 2x | 3,690 | 1,983ms | ~14s | ~7x |
| 4x | 7,380 | 4,842ms | ~57s | ~12x |
| 8x | 14,760 | 11,300ms | ~4分 | ~22x |
| 16x | 29,520 | 26,405ms | ~17分 | ~40x |
| 32x | 59,040 | 55,580ms | ~70分 | **~75x** |

> algo wall = candidate-gen + scoring + decide (parse/extract/listBase は
> 事前 1 回計測で固定)。end-to-end では parse/extract が linear-scale で
> 載るが、N が大きいほど比率は薄まる。

### 完了基準に対する評価

| 基準 | 結果 | 判定 |
|---|---|---|
| ts-dedup self-scan file-pair Jaccard ≥ 0.75 (目標 0.85) | **0.871** | ✅ 目標超過 |
| ts-dedup self-scan wall ≤ 2.5s (5-run median) | **1.95s** | ✅ |
| 32x scale corpus で wall ≤ 90s | **55s** (algo) / ~87s (e2e) | ✅ |
| `pnpm bench` recall@all = 0.95 不変 | 0.95 | ✅ (PR モードは LSH 経路を通らない) |
| `pnpm test` 全パス | 327/327 | ✅ |
| `--phase-timings` の `lsh.summary` (axis 別) と `lsh.union` | 動作確認済 | ✅ |

すべての完了基準を満たした。token-only LSH 比で **+26% wall / +0.32 J**
のトレードで recall を回復しつつ、大規模 (32x) でも 1 分弱で完走する。

### 残課題 / 既知の制約

- statement 軸は call 軸と同じく **looser banding (b=64, r=2, inflection
  0.13)** で起動。これは恣意的で、別途 sweep で micro-tune の余地あり
  (例: bands=128, rows=2 で更に低い inflection)。
- 当初 plan の "wall +15-30% 程度" は token+call 限定の見積もり。実際は
  3 軸で +26% に収まったが、statement-LSH の build wall (~500ms 単独) は
  scoring 候補ペア数を増やす副作用があり、scale 32x で 1.5x 遅化
  (1-axis 36s → 3-axis 55s)。recall 重視を選んだ判断を docs に明記。
- `gained` (legacy にないが LSH が surface するペア) が +24 件あり。
  False positive 増の側面 — 必要なら閾値で抑える。
