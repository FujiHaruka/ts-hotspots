# tokenNgramSizes チューニング調査 (2026-04)

[m8-fixture-suite.md](./m8-fixture-suite.md) Phase 2 (パラメータチューニング、M9 候補) の
最初のスライス。`config.features.tokenNgramSizes` の既定 `[3, 4, 5, 6]` の根拠を
fixture suite + 自己リポジトリの sweep で確かめ、変更の要否を判断する。

## 動機

- v1.md 時点で `tokenNgramSizes` の値は「3〜6 gram」とだけ書かれており、
  論文や実測の裏付けは無く、`docs/plans/milestones.md` で「fixture 結果で見直し」と
  宿題になっていた。
- 「3〜6 は短く感じる」という直感的疑問に対し、precision (偽陽性) と
  recall (拾い漏れ) の両軸で実データを取りたい。

## やったこと

### 1. fixture suite での sweep
[`tools/bench/sweep.ts`](../../tools/bench/sweep.ts) を追加し、
25 fixture × 7 variant (`[2,3]` 〜 `[5,6,7,8]` 〜 `[3..8]`) を回す。

結果 ([`tools/bench/baseline/sweep.md`](../../tools/bench/baseline/sweep.md)):

- recall@all は全 variant で 0.95 で頭打ち (1 fixture が token 系統では拾えない構造)。
- negative violations は `[2,3]` のみ +1、それ以外は 3 で同点。
- → **fixture suite では `[3..8]` の範囲内のどの値も区別できない**。
  ceiling 効果が強く、parameter sweep の有効な観測台にならない。

### 2. 自己リポジトリでの sweep
[`tools/bench/sweepSelf.ts`](../../tools/bench/sweepSelf.ts) を追加し、
このリポジトリ自体の `HEAD~10..HEAD` を入力に、同じ 7 variant + `[2..6]` / `[3..7]` を回す。
fixture と違い ground truth は無いので、reported 数 / 平均 score / default との
Jaccard で観測する。

結果 ([`tools/bench/baseline/sweep-self.md`](../../tools/bench/baseline/sweep-self.md))
の主要数値:

| sizes        | reported | mean score | Jaccard vs default |
|--------------|---------:|-----------:|-------------------:|
| `[2,3]`      |      397 |      0.432 |              0.491 |
| `[2..6]`     |      283 |      0.431 |              0.924 |
| `[3,4,5]`    |      284 |      0.431 |              0.907 |
| `[3,4,5,6]`  |      271 |      0.423 |              1.000 |
| `[4,5,6]`    |      250 |      0.417 |              0.888 |
| `[4,5,6,7]`  |      238 |      0.409 |              0.838 |
| `[5,6,7,8]`  |      211 |      0.398 |              0.740 |

window を広げると reported が減り score が単調低下する。これは「token Jaccard の
分母 (union) は素直に増えるのに長い n-gram の一致は出にくい」ためで、
**recall 優先の v1 設計から見ると大きい側は不利**。
ただし default `[3,4,5,6]` と `[3,4,5]` / `[2..6]` の差は ±13 ペア程度で、
Jaccard 0.9+ の実質ほぼ同じ集合。

### 3. 差分ペアの triage
sweep は数しか教えない。「+13 ペアは本物の Type-3 か、ノイズか」を見るために
[`tools/bench/diffPairs.ts`](../../tools/bench/diffPairs.ts) を追加し、
default vs 各 variant の only-in-X ペアを score evidence 付きで全件ダンプ
([`tools/bench/baseline/diff-pairs-*.md`](../../tools/bench/baseline/) 参照)。

読んだ感想:

- **`[2..6]` / `[3,4,5]` の追加分はほぼノイズ**。共通パターンは
  `combined ≈ 0.40, token ≤ 0.20, stmt = 1.000, call = 0.000`。
  例: `tools/bench/scale.ts:38-41` ↔ `src/search/candidateSearch.ts:94-97` が
  「ExpressionStatement が 2 つ並んでる」だけで一致する。
- **`[5,6,7,8]` が default から落とす 60 ペアもほぼノイズ**。同じ短いブロック
  (`extractFragments.ts:123-129` の `ExpressionStatement|ContinueStatement`) が
  9 か所と pair を作っている類。ただし
  `src/scoring/internal/jaccard.ts` ↔ `jaccardWithIntersection.ts` のような
  **本物の Type-3 もまとめて落ちる**。
- import-only / interface-only window 由来の FP は eaf1164 の
  `dropLowSemanticEvidence` でも残っており、今回の sweep でも全 variant で観測。

## 結論

1. **`tokenNgramSizes` は default `[3, 4, 5, 6]` 据え置きが妥当**。下げても上げても
   precision / recall いずれかが selective に改善することは無い。
2. **構造的 FP の主因は `tokenNgramSizes` ではなく score 設計側にある**。
   `combined = 0.4·token + 0.3·stmt + 0.2·call + 0.1·size` と閾値 0.3 の組み合わせは、
   `stmt=1.0` が単独で combined ≥ 0.30 を作れるため、
   token / call が 0 でも通ってしまう。観測された FP の大半がこの形。
3. 直前のコミット eaf1164 で導入された `dropLowSemanticEvidence` は方向性として
   同じだが、現状閾値だと `token=0.218 stmt=1.0 call=0` が残る。**閾値の見直しが
   ngram レンジ変更より効きそう**。

## 推奨フォローアップ (優先順)

1. ✅ **完了**: `dropLowSemanticEvidence` に token gate を追加。
   下記「フォローアップ #1 の結果」参照。
2. ✅ **完了**: 1 fragment あたりの pair 数上限 (`capPerFragmentPairs`)。
   下記「フォローアップ #3 の結果」参照。
3. ✅ **完了**: scoring weights の再配分 (statement → call)。
   下記「フォローアップ #2 の結果」参照。

## フォローアップ #1 の結果 (2026-04-26)

`src/report/dropLowSemanticEvidence.ts` の判定を以下に拡張:

```ts
drop if: intersections.calls.length === 0
         AND (combined < 0.4 OR tokenOverlap < 0.2)
```

つまり「semantic anchor (call/prop) が無い」ペアに対し、従来の combined 閾値に加え
`tokenOverlap < 0.2` でも drop するよう強化した。stmt が単独でスコアを担いでいる
構造的 FP を狙い撃つ形。`TOKEN_FLOOR` は今回 hardcoded、必要なら config 化。

### 自己リポジトリでの効果 (HEAD~10..HEAD, default config)

| metric         | before | after | delta |
|----------------|-------:|------:|------:|
| reported pairs |    290 |   223 |  **−67 (−23%)** |
| mean score     |  0.418 | 0.414 | −0.004 |
| median         |  0.432 | 0.438 | +0.006 |
| p90            |  0.541 | 0.577 | **+0.036** |
| newly added    |      — |     0 | (純減: 偶発昇格なし) |

drop された 67 件は全て `token<0.20, stmt=1.0, call=0` パターン。token 分布:
`<0.05: 1`, `0.05–0.10: 12`, `0.10–0.15: 30`, `0.15–0.20: 24`。
本物の Type-3 候補 (`src/scoring/internal/jaccard.ts ↔ jaccardWithIntersection.ts`、
`collectDiff.ts ↔ listBaseSources.ts` 関数粒度の `gitShow/isTypeScript` 共有版など、
call/prop を持つペア) は **すべて生存**。

サンプル (drop されたもの):

```
tools/bench/diffPairs.ts:156-160 ↔ test/e2e/helpers/tempRepo.ts:36-40
combined=0.443 token=0.108 stmt=1.000 call=0.000
evidence: stmts=[ExpressionStatement|ExpressionStatement, VariableStatement|ExpressionStatement]
↑ "(err) => process.exit(1)" 系の trivial error handler が tempRepo の小ブロックと一致
```

### fixture suite での影響

`pnpm bench` (default config) で recall@all = 0.95 / negative violations = 3。
gate 変更前と完全に同じ。回帰なし。

(注: fixture `015-same-file-near-twins` の miss は eaf1164 系列以降の既存 bug で、
この gate 変更とは無関係。`tools/bench/baseline/summary.md` の committed 値
`recall@all=1.00` は古い snapshot だったため一致しなくなった。別 issue。)

### 追加した bench ツール

- [`tools/bench/dumpPairs.ts`](../../tools/bench/dumpPairs.ts) — default config の
  reported pair list を JSON にダンプ。before/after 比較に使う。
- 比較は `git stash push src/report/dropLowSemanticEvidence.ts` →
  `dumpPairs --out before.json` → stash pop → `dumpPairs --out after.json` の
  手順で取れる (`/tmp/dropped.md` を出力する一行 node コマンドは
  本 doc に記載した手順を参照)。

### 残課題

- α (= 0.2) と β (= 1 件以上の calls) のチューニング余地はあるが、現状
  hardcoded で十分。実プロジェクトで使ってみて FP / FN の温度を見る。
- 015-same-file-near-twins の既存 bug は別タスク。eaf1164 commit で
  `dropSameFileOverlap` か他の filter が同一ファイル twin helper を取り違えている
  可能性が高い。

## フォローアップ #3 の結果 (2026-04-26)

新規 [`src/report/capPerFragmentPairs.ts`](../../src/report/capPerFragmentPairs.ts) を
パイプラインの `sortCandidates` 直後に挿入し、**1 fragment あたり最大 K = 3 件**
までしか pair に登場できないようにした。pair は score 降順で見るので、各
fragment の "上位 3 つの partner" が残る。

### K = 3 の根拠

#1 適用後 (265 pairs) の per-fragment 出現数分布:

| 出現数  | fragment 数 |
|---------|------------:|
| 1       |        120 (49%) |
| 2       |         75 (30%) |
| 3       |         16 |
| 4       |          9 |
| 5       |         13 |
| 6–9     |         12 |
| 10+     |          2 (`recommendationHint.ts:1-12` で 14, `tools/bench/index.ts:4-231` で 11) |

79% (195 / 247) が ≤ 2 件で、3 件以下までで 85%。3 を超える long tail は
file-header window (imports + interface decls) 由来の `stmt=1.0, call=0` パターンが
支配的。K = 3 はこの分布の自然な肘に対応。

### 自己リポジトリでの効果 (HEAD~10..HEAD, default config)

| metric         | #1 後 | #3 後 | delta  |
|----------------|------:|------:|-------:|
| reported pairs |   265 |   193 | **−72 (−27%)** |
| 偶発昇格       |     — |     0 | (純減) |
| jaccard helpers (`jaccard.ts ↔ jaccardWithIntersection.ts` 等) | 残存 | 残存 | ✅ |
| collectDiff/listBaseSources | 残存 | 残存 | ✅ |
| `index.ts:204↔190`, `index.ts:163↔155` (両方 combined ≥ 0.93 の真の重複) | 残存 | 残存 | ✅ |

drop された 72 件の典型例 (top 8 はすべて file-header window 同士):

```
src/report/recommendationHint.ts:1-12 ↔ src/indexer/buildCodebaseIndex.ts:1-10
combined=0.611 token=0.568 stmt=1.000 call=0.000
↑ どちらも import + interface のみのファイル先頭。token Jaccard は高いが
  refactoring 対象ではないので #1 では落ちず、#3 で初めて切れた。
```

`recommendationHint.ts:1-12` 単体で 14 件の partner を持っていたが、上位 3 件
だけが残り、残り 11 件は drop。

### fixture suite での影響

`pnpm bench` で `recall@all = 0.95 / negative violations = 3`。#1 後と完全同値。
回帰なし。

### 実装メモ

- cap は `sortCandidates` の **後** に置いた。score 降順で見るので各
  fragment の上位 partner が選ばれる。
- 両側で count を持ち、片側でも cap に達したら drop。`hot ↔ x` で hot の枠が
  尽きると `y ↔ hot` も blocked、という形。
- K は hardcoded (3)。実プロジェクトで観察してから config 化を検討。
- granularity 別にしなかった: window が主犯だが block も無視できないため、
  「全粒度に 1 つの上限」という単純設計を採用。

## フォローアップ #2 の結果 (2026-04-26)

`config.scoring.weights` の既定を変更:

| axis      | before | after |
|-----------|-------:|------:|
| token     |    0.4 |   0.4 |
| statement |    0.3 |  **0.2** |
| call      |    0.2 |  **0.3** |
| size      |    0.1 |   0.1 |

statement 0.3 → 0.2 で開いた 0.1 を **call 単独に振った** (token は据え置き)。

### なぜ token を増やさなかったか

最初に試した `0.45 / 0.2 / 0.25 / 0.1` (token と call に半々で振る案) は
**改善が薄く、新規 FP も呼んだ**:

- 21 件 drop / 15 件 add (うち 12 件は borderline / header-FP)
- 「import + interface のみのファイル先頭」が token Jaccard 0.5+ を取りやすい
  ため、token を増やすと **header-FP が score 閾値の上に上がってくる** のが
  原因。`dropLowSemanticEvidence` で combined ≥ 0.4 を救う規則が逆に働く。

call 単独に振る案 `0.4 / 0.2 / 0.3 / 0.1` は対照的に:

- 27 件 drop / 12 件 add、**新規 FP ゼロ**
- structural-FP (stmt=1, call=0, token≤0.35): 15 → **0**
- header-FP (stmt≥0.4, call=0, token≤0.5): 5 → **2**
- real-anchor (call/prop 入り): 39 → **39** (drop 3, add 4 で純増)

### 自己リポジトリでの効果 (default config, HEAD~10..HEAD)

| variant                      | reported | structural-FP | header-FP | real-anchor |
|------------------------------|---------:|--------------:|----------:|------------:|
| #3 後 (0.4/0.3/0.2/0.1)       |      163 |            15 |         5 |          39 |
| split (0.45/0.2/0.25/0.1)     |      157 |             3 |         4 |          38 |
| **採用 (0.4/0.2/0.3/0.1)**    |      148 |             0 |         2 |          39 |

drop されたが diff range の境界で alternate pair に置き換わった例:

- `collectDiff.ts:4-84 ↔ listBaseSources.ts:1-54` (combined 0.301 → 閾値割れ) は
  消えるが、近隣の `collectDiff.ts:5-89 ↔ listBaseSources.ts:2-59`
  (combined 0.335) と関数粒度の `listBaseSources.ts:65 ↔ collectDiff.ts:45`
  (combined 0.310) が残るので、**論理的な clone は引き続き 1 件として報告される**。
- bench harness 内の `sweepSelf ↔ index` (combined 0.424) が drop されたが、
  cap の枠が `sweep ↔ index` (combined 0.425) に再割当てされて補われた。

### fixture suite

`pnpm bench`: `recall@all = 0.95 / negative violations = 3`。#1, #3 後と完全同値。
回帰なし。

### 全フォローアップ通算の効果

token gate (#1) + cap (#3) + weight rebalance (#2) を併せて、構造的 FP の
代表クラスはすべて潰れた。default config の reported pair の質が底上げされ、
file-header window 同士の真っ当な import 一致だけが少し残る形に落ち着いた。

## 成果物

- [`tools/bench/sweep.ts`](../../tools/bench/sweep.ts) — fixture suite × n-gram sweep。
  `pnpm bench:sweep` で再実行可能。
- [`tools/bench/sweepSelf.ts`](../../tools/bench/sweepSelf.ts) — 自己リポジトリ
  に対する sweep。`pnpm bench:sweep-self -- --base <ref>` で任意の range を試せる。
- [`tools/bench/diffPairs.ts`](../../tools/bench/diffPairs.ts) — 任意 2 config の
  reported pair 集合差分。only-in-X を score evidence 付きで全件ダンプ。
- [`tools/bench/configs/ngram-*.json`](../../tools/bench/configs/) — 9 通りの
  `tokenNgramSizes` 設定。
- [`tools/bench/baseline/sweep.md`](../../tools/bench/baseline/sweep.md) /
  [`sweep-self.md`](../../tools/bench/baseline/sweep-self.md) /
  [`diff-pairs-*.md`](../../tools/bench/baseline/) — 今回のスナップショット。
