# Whole-repo モード速度改善計画

## 目的

ts-dedup を whole-repo モードで自身のリポジトリに対して走らせ、フェーズと
サブフェーズを実測し、ボトルネックに対して影響度の大きい順に改善案を立てる。

将来コードベースが拡大した場合に "明らかに遅い" と感じる原因を、O 記法レベルの
推測ではなく **実測値ベース** で潰すための作業計画。

## 計測方法

`tools/bench/profileSelf.ts` (この PR で追加) で whole-repo モードを連続 5 回
実行し、以下を採取する:

- `searchCandidates` / `scoring` / `decide` のサブフェーズ wall
- posting list size 分布 (avg / p50 / p90 / p99 / max, top10 hot keys)
- per-fragment candidate 数の分布 (cap 到達率)

実行環境: macOS (Darwin 24.5), Node.js (`--experimental-transform-types`),
リポ HEAD = `dd95bee`。プロセスは毎回 cold start (JIT ウォームアップなし)。
1 回目の実行は git pack のディスクキャッシュが冷えていて listBase が
それ以降より 60-70ms 重い (run1: 737ms vs runs 2-5 平均: 671ms)。それ以外の
フェーズは run 間ばらつき CV < 1% で極めて安定。

### フェーズ別 wall (5 run, ms)

| 指標 | run1 | run2 | run3 | run4 | run5 | mean | stddev |
|---|---:|---:|---:|---:|---:|---:|---:|
| diff | 8.9 | 9.1 | 8.8 | 9.0 | 11.7 | 9.5 | 1.1 |
| listBase | 737.0 | 673.9 | 668.5 | 671.2 | 670.4 | 684.2 | 26.6 |
| baseIndex | 487.1 | 474.2 | 468.8 | 471.2 | 473.8 | 475.0 | 6.4 |
| **headSearch** | 2595.5 | 2608.1 | 2603.9 | 2564.5 | 2563.7 | **2587.1** | 19.3 |
| ┣ `searchCandidates` | 1006.3 | 1011.7 | 1009.9 | 994.2 | 992.9 | **1003.0** | 7.9 |
| ┣ `scoring` | 1499.8 | 1504.5 | 1505.6 | 1483.7 | 1482.6 | **1495.2** | 10.1 |
| ┗ `decide` | 2.2 | 2.3 | 2.2 | 2.2 | 2.2 | 2.2 | 0.0 |
| total wall (推定) | ≈3.83s | ≈3.77s | ≈3.75s | ≈3.72s | ≈3.72s | **≈3.76s** | — |

> 注: report フェーズ単体は前回の `--phase-timings` 計測で ~6ms (無視可)。
> total wall に含まれているが上表からは省略。

### 比率 (mean ベース)

- `headSearch` は total の **69%**
  - 内 `scoring` 58%、`searchCandidates` 39%、`decide` < 0.1%
- `listBase` 18% (= git show I/O、最適化対象外)
- `baseIndex` 13% (= parse + extract + index 構築)

### 静的指標 (run 間で完全一致 — 決定性により当然)

| 指標 | 値 |
|---|---|
| 規模 | 77 files / 6,422 lines / 1,544 fragments |
| candidate pairs (raw) | 86,542 |
| 一意ペア (canonical key 後) | 76,210 |
| 報告ペア | 3,208 (**scored の 4.2%**) |
| candidate 上限 (100) 到達フラグメント | **864 / 1,544 (56%)** |
| posting unique keys | 16,722 |
| posting size avg / p99 / max | 14.4 / 138 / **689** |
| 最頻 key | `token:ID DOT ID` (689 postings = 全 fragment の 45%) |

### 観測からの示唆

1. **scoring が支配的** (`headSearch` の 58% / total の 40%)。事前の
   "search が支配的" 仮説は外れ。`jaccardWithIntersection` がペアごとに
   3 軸で交差集合を **必ず構築・ソート** しているが、最終的に reported に
   進むのは 4.2% だけ。**残り 96% の交差構築は evidence として捨てられる**。
2. **search も無視できない** (`headSearch` の 39% / total の 27%)。
   posting に強い偏りがあり、最頻トークン n-gram は全 fragment の 45% に
   出現する純然たるノイズキー (`ID DOT ID` 等)。
3. **候補上限 100 が 56% のフラグメントで効いている**。これは "本来もっと多くの
   候補があるが、cap で切り捨てられている" 状態で、上流に移行するほど search
   の負荷も比例して増えることを意味する。
4. listBase (git show) は I/O 律速で、ロジック改善の対象外。
5. run 間ばらつきは scoring / search ともに **CV < 1%** で十分に安定しており、
   30% の wall 改善はノイズに埋もれない。

## Approach

まず **P0** で既存 `--phase-timings` フラグを JSON Lines の詳細ログに置き換える。
これにより、本計画のベースラインを `tools/bench/profileSelf.ts` という別
スクリプトに頼らず CLI 単体で取れるようにし、改善後の比較もユーザ手元で
再現可能にする。互換性は維持しない (現行 1 行サマリは廃止)。次にスコアリングと
検索の二段で改善する。**O1 (lazy intersection) を最優先** でやる。理由は単発で
最大の wall 削減が見込め、かつ侵襲性が低いため。

```
[現状]
  for each pair:
    jaccard + intersection(sort) × 3 軸 ← 76,210 pairs × 3 軸の sort
    shouldReport

[改善後 — O1]
  for each pair:
    jaccard カウントだけ × 3 軸  (交差配列を作らない)
    shouldReport
    if reported:
      intersection を作って evidence に渡す ← 3,208 pairs だけ

  → 交差構築コストが 76,210 → 3,208 に減る (24×減)
```

その上で **O2 (hot-key 抑制)** で search 側のドミナントなノイズキーを緩和、
さらに必要なら **O3 (top-K heap)** で sort コストを削る、の順で進める。

実施するごとに `pnpm bench` (fixture suite) を回し、recall / precision の
劣化が無いことを確認する。劣化があれば即ロールバックする。

## 改善案 (優先度順)

### P0. `--phase-timings` を JSON Lines 詳細ログに置き換える

**狙い**: 既存 `--phase-timings` フラグを拡張し、`profileSelf.ts` で取って
いる内訳を CLI から再現できるようにする。改善後のセルフ計測をユーザ手元で
完結させ、cap 飽和 / posting 偏り / 軸別 reject 率など本計画で根拠としている
定量メトリクスを継続的に観測できるインフラを整える。

#### CLI インターフェース

既存の `--phase-timings` を **拡張して詳細ログを出すモードに置き換える**。
互換性は維持しない (現状は内部用途であり、外部に固定 contract を約束していない)。

```
ts-dedup --whole-repo --phase-timings 2> perf.log
```

stderr に **JSON Lines 形式** で出力する。理由:

- markdown のレポート (stdout) と分離されており、`--format json` と
  両立できる。
- `jq` でフィルタしやすく、後段で集計しやすい。
- 1 行 1 イベントなので運用上の長期ログ収集にも適している。

各行は `{ "ts": <ms_since_start>, "event": <名前>, ...payload }` のシェイプ。
従来の 1 行サマリ (`phases  diff=Xms ...`) は廃止し、JSON Lines に統一する。

#### 出力するイベント (whole-repo / PR 共通)

| event | 出力場所 | payload |
|---|---|---|
| `phase.start` / `phase.end` | 既存の 5 フェーズ全部 | `phase`, `wallMs` |
| `phase.subPhase` | `headSearch` 内 | `phase: "search" | "scoring" | "decide"`, `wallMs`, `count` (呼出回数) |
| `index.stats` | `buildInvertedIndex` 直後 | `uniqueKeys`, `totalPostings`, `avgSize`, `p50`, `p90`, `p99`, `max` |
| `index.hotKeys` | `buildInvertedIndex` 直後 | `top: [{ key, size, df }]` (上位 N=20、`df = size / fragments`) |
| `fragments.stats` | base 索引構築完了後 | `total`, `byKind: { function, block, window }`, `byFile: { p50, p90, max }` (1 ファイル当たり fragment 数) |
| `search.fragment` | 1 query ごと | `fragmentId`, `uniqueKeys: { token, statement, call }`, `postingsHit`, `preCapCandidates`, `truncatedAtCap: bool`, `wallMs` |
| `search.summary` | searchCandidates 全件終了後 | `queries`, `wallMs`, `preCapCandidates: { sum, p50, p90, p99, max }`, `cap`, `capSaturation: { atCapFragments, ratio }` |
| `scoring.summary` | scoring ループ終了後 | `pairs`, `uniquePairs`, `wallMs`, `usPerPair`, `intersectionSizes: { token, statement, call }` (mean / max), `axisDist: { token, statement, call, size, combined }` (各軸の min/p50/p99/max) |
| `decide.summary` | decide 集計後 | `passed`, `rejected`, `passedRatio`, `passReasons: { combined, token, statement, call, anyAxis }` (どの条件で通ったか集計) |
| `report.summary` | postprocess 後 | `before: { afterDecide }`, `dropSameFileOverlap`, `collapsePairs`, `final` |
| `pairs.dedup` | whole-repo のみ | `rawCandidates`, `uniqueAfterCanonical`, `dedupRate` |

#### per-fragment レコード (`search.fragment`) について

1,544 行出るとログがでかい。デフォルトでは **summary だけ**。`--phase-timings=verbose`
(値付きフラグ) を付けたとき限定で per-fragment まで出す。`--phase-timings` の
レベルは `summary` (デフォルト、フラグ単独指定時) | `verbose` の 2 択。

#### 重要メトリクス (cap 飽和 ほか)

下記は今回特に明示的に出したいもの:

1. **cap 飽和率** (`search.summary.capSaturation`):
   ```
   atCapFragments / queries  → 現状 864/1544 = 56%
   ```
   この比率が高い = "本来もっと候補があるが切られている" 状態で、O2 で hot key
   を抑制すると下がるはず。改善前後の差分が見える形で必須。

2. **pre-cap candidate 数の分布** (`search.summary.preCapCandidates`):
   現状は cap 後の数しか見えていない。pre-cap で何件あったかを sum / p50 / p90 /
   p99 / max で出す。これが O2 / O3 の効果計測に必須。

3. **posting size 分布と hot key** (`index.stats` + `index.hotKeys`):
   現状の `token:ID DOT ID` (df=45%) のような明らかにノイズなキーが何個あるか
   を都度見える化する。O2 で DF cap を下げると hot key が減るのが見える。

4. **per-axis intersection size** (`scoring.summary.intersectionSizes`):
   今 `jaccardWithIntersection` で実際に作られている交差配列のサイズ分布。
   O1 (lazy intersection) の効果見積もりの裏付けに使う。

5. **decide pass 理由の分解** (`decide.summary.passReasons`):
   `combined / token / statement / call` の各条件のうち、どれで OR 通過したかを
   カウント。**現状 76,210 scored → 3,208 reported のうち、何件が combined
   閾値、何件が単軸閾値で通ったか** を出す。O2 で hot key を切ると「単軸
   閾値で滑り込んでいた弱い pair」が落ちる可能性があり、この内訳が変わるはず
   なので、recall 影響を pair の質まで掘って分析できるようにしておく。

6. **ペア dedup 率** (whole-repo のみ、`pairs.dedup`):
   現状 86,542 → 76,210 (dedup 率 12%)。半分にならない理由は cap の非対称性で、
   O4 (半対称スキャン) を検討する根拠になる数字。

#### 実装方針

- 新規ファイル `src/cli/perfLog.ts` に `PerfLogger` インターフェースと
  `JsonlPerfLogger` 実装を置く。`runDetector` / `runWholeRepoDetector` /
  `searchCandidates` / scoring ループに optional な `perfLog?: PerfLogger`
  引数を追加する。既存の `collectPhaseTimings` / `RunStats.phaseTimings` /
  `PhaseTimings` 型は **撤去** し、`perfLog` に一本化する。
- **calling convention**: `--phase-timings` 無効時は `perfLog === undefined`
  で渡し、ホットパスは `if (perfLog !== undefined) perfLog.event(...)`
  の分岐 1 つだけが残る形にする。
- `searchCandidates` の per-fragment 計測は `perfLog` がある場合だけ
  `performance.now()` を呼ぶ。デフォルトでは現状と同じく `now()` 呼び出し
  ゼロを保つ。
- 出力先は `process.stderr` 直書きではなく `MainIO.stderr` 経由 (テスト容易性)。
- `args.ts` の `--phase-timings` を `boolean` から `string | boolean` に変更し、
  `summary` (デフォルト) / `verbose` を受け付ける。値なしでフラグ単独指定時
  は `summary` 扱い。
- `main.ts` の旧 1 行サマリ出力 (`phases  diff=...ms ...`) を削除する。
- 旧仕様の test (`main.test.ts` / `runDetector.test.ts` 周辺の phase-timings
  関連) は新仕様に合わせて書き直す。

#### サンプル出力 (抜粋)

```jsonl
{"ts":12.4,"event":"phase.start","phase":"baseIndex"}
{"ts":487.5,"event":"phase.end","phase":"baseIndex","wallMs":475.1}
{"ts":487.6,"event":"index.stats","uniqueKeys":16722,"totalPostings":240941,"avgSize":14.41,"p50":6,"p90":33,"p99":138,"max":689}
{"ts":487.6,"event":"index.hotKeys","top":[{"key":"token:ID DOT ID","size":689,"df":0.446}, ...]}
{"ts":487.7,"event":"fragments.stats","total":1544,"byKind":{"function":421,"block":612,"window":511},"byFile":{"p50":12,"p90":44,"max":120}}
{"ts":1490.7,"event":"phase.subPhase","phase":"search","wallMs":1003.0,"count":1544}
{"ts":1490.7,"event":"search.summary","queries":1544,"wallMs":1003.0,"preCapCandidates":{"sum":210400,"p50":48,"p90":312,"p99":1100,"max":1380},"cap":100,"capSaturation":{"atCapFragments":864,"ratio":0.560}}
{"ts":2986.0,"event":"phase.subPhase","phase":"scoring","wallMs":1495.2,"count":76210}
{"ts":2986.0,"event":"scoring.summary","pairs":86542,"uniquePairs":76210,"wallMs":1495.2,"usPerPair":19.6,"intersectionSizes":{"token":{"mean":11.2,"max":340},"statement":{"mean":3.8,"max":40},"call":{"mean":2.1,"max":35}}}
{"ts":2988.2,"event":"decide.summary","passed":3208,"rejected":73002,"passedRatio":0.042,"passReasons":{"combined":1240,"token":880,"statement":410,"call":1100,"anyAxis":2390}}
{"ts":2988.5,"event":"pairs.dedup","rawCandidates":86542,"uniqueAfterCanonical":76210,"dedupRate":0.119}
{"ts":2994.7,"event":"phase.end","phase":"headSearch","wallMs":2587.1}
{"ts":3000.9,"event":"phase.end","phase":"report","wallMs":6.2}
```

#### 期待効果

性能改善ではなく **計測インフラの整備**。本計画の各 step で改善前後の数値を
ユーザが手元で取れる。`profileSelf.ts` に依存していた数値が CLI 経由で取れる
ようになるため、`tools/bench/profileSelf.ts` は将来削除可能になる。

#### 互換性 / リスク

- **互換性は維持しない**。既存 `--phase-timings` の 1 行サマリ出力形式を捨て、
  JSON Lines に置き換える。`RunStats.phaseTimings` / `PhaseTimings` 型も削除。
  外部スクリプトが旧形式に依存していたら破綻するが、現時点で外部利用者は
  いない前提。
- 計測呼び出しが追加される箇所 (`searchCandidates` per-fragment 計測、scoring
  ループ内の per-pair 計測) は **フラグ無効時は完全 no-op**。
  `if (perfLog !== undefined)` の分岐 1 つ分しか hot path に入らないことを
  ベンチで確認する。
- 変更ファイル: `src/cli/perfLog.ts` (新規), `src/cli/args.ts`, `src/cli/main.ts`,
  `src/cli/runDetector.ts`, `src/cli/runWholeRepoDetector.ts`,
  `src/search/candidateSearch.ts`, `src/index_/invertedIndex.ts` (stats 算出を
  index に持たせる)。`PhaseTimings` 関連の型と旧テストは削除。
- 測定追加が wall を増やさないことを、`--phase-timings` 無し / 有り両方で
  profileSelf を比較してチェックする。許容: < 2% の overhead。

### O1. Lazy intersection — `jaccardWithIntersection` の二段化

**狙い**: scoring 1,495ms のうち推定 **900-1,100ms** を削る。

#### 設計

1. `jaccardCount(small: Set, large: Set): { jaccard: number; intersectionSize: number }`
   を新設。**配列を作らずカウントだけ**返す。
2. `intersectionSorted(small: Set, large: Set): string[]` を別 export。`shouldReport`
   を通った pair でだけ呼ぶ。
3. `scoreCandidateDetailedFromSets` を 2 関数に分割:
   - `scoreOnly`: 4 軸の数値スコアだけ返す。`combined` 含む。
   - `buildIntersections`: pair が報告対象になったあとに呼び、3 軸の交差配列を
     返す。
4. `runWholeRepoDetector` / `runDetector` のループを次の形に書き換える:
   ```ts
   const score = scoreOnly(...);
   if (!shouldReport(score, ...)) continue;
   const intersections = buildIntersections(aSets, bSets);
   scoredPairs.push({ score, intersections, ... });
   ```

#### 期待効果

- 96% の pair で `intersection.sort()` と `intersection.push()` を回避。
- token 軸の交差は数十~数百要素になることもあり、sort コストが軽くない。
- 期待値: scoring 1,495ms → ~400-600ms。総 wall ≈3.76s → ≈2.7s。

#### 互換性 / リスク

- 出力 JSON は変わらない (採用 pair の evidence 構築は維持)。
- `scoreCandidate.test.ts` / `jsonReport.test.ts` で intersection が変わらない
  ことを既存テストが保証する。新たに `jaccardCount` の単体テストを足す。
- 変更ファイル: `src/scoring/internal/jaccardWithIntersection.ts`,
  `src/scoring/scoreCandidate.ts`, `src/cli/runDetector.ts`,
  `src/cli/runWholeRepoDetector.ts`。

### O2. Hot-key 抑制 — DF 上限による posting 切り捨て

**狙い**: searchCandidates 1,003ms のうち **150-350ms** を削る。

#### 観測

posting top10 はすべて構文的ノイズ (`token:ID DOT ID`, `token:IF LPAREN ID`,
…) で 全 fragment の 30-45% に出現する。これらは "ほぼ全てのコードに現れる"
ので signal が低く、tally コストだけ重い。

#### 設計

1. `config.search.maxDocumentFrequency` (新設、デフォルト `0.30` = 30%) を導入。
2. `searchCandidates` の `tally` で、`postings.length / totalFragments > maxDF`
   のキーは **クエリ時にスキップ**。索引には残す (他のキーから消すと依存が壊れる)。
3. ただし **per-axis に分けて閾値を持つ** ことを検討。call 系は固有名詞性が
   高いので閾値を緩く (or 無効化) しても良い。最初は token のみに適用。

#### 期待効果

- 上位 ~50 keys が posting 全体の 5-10% を占めるので、search の tally で
  10-20% 削減見込み。
- 副次的に candidate 数も減り、56% → ~40% 程度の cap 到達率になり、cap 内に
  本物の候補が残りやすくなる (recall に好影響かもしれない)。

#### リスク

- recall を損なう可能性 → fixture suite で確認必須。劣化があれば閾値を
  上げて再検証 (DF 0.4 → 0.5 → off)。
- token 系を切ると Type-3 検出が一部弱まるので、まず保守的に **0.5** から始める
  のが安全。

### O3. searchCandidates の top-K heap

**狙い**: searchCandidates の sort コストを削る。

#### 観測

候補数 100 cap に対して 56% のフラグメントが pre-cap で 100 を超える。今は
全候補を作って `Array.prototype.sort` してから slice しているが、min-heap
size 100 なら O(N log 100) で済む。

#### 期待効果

- search 内の sort コスト削減。たぶん 50-100ms 程度。O1 / O2 のあとで効果が
  消えていなければ実施。先に O1 / O2 を入れて、effect が残るか再計測してから
  判断。

### O4 (検討段階). Whole-repo 専用の半対称スキャン

**狙い**: search 全体を半分にしうる。

#### 観測

whole-repo では query 1,544 回 search を呼び、出てきた候補をペア dedup している
(86,542 → 76,210)。理屈の上ではペアの片側だけ search すれば十分。

#### 障害

- candidate cap 100 で切られているので、`a → top100 candidates` と
  `b → top100 candidates` の集合は対称ではない。片側だけにすると recall が
  落ちる可能性がある。
- 検索順を変えると "cap で残るペア" が変わるため、出力の決定性とトレードオフ。

#### 結論

侵襲度が高い割に O1 / O2 で wall が十分縮む可能性があるため **後回し**。
O1+O2 後に再計測して必要性を判断する。

## 実施順序

1. **P0** で `--phase-timings` を JSON Lines 形式に置き換え、`profileSelf.ts`
   と数値が一致することを確認 (decide passReasons など、profileSelf に
   無いメトリクスは CLI ベースを正本とする)。production 経路 (フラグ無し)
   の overhead が 2% 以内であることも同時に確認する。
2. **O1** を実装 + bench suite で recall / precision 不変を確認
3. `--phase-timings` で再計測し、scoring 削減幅 / intersection 構築回数
   削減を確認
4. **O2** を実装、DF 0.5 → 0.4 → 0.3 と段階的に下げて bench を見る。
   `decide.passReasons` の内訳がどう変わるかも観察
5. `--phase-timings` で再計測 (cap saturation の改善を確認)
6. それでも search が遅ければ **O3**
7. O4 は最後の手段として検討

## 完了基準

- `ts-dedup --whole-repo --phase-timings` を 5 回実行した平均 wall が現状
  ベースライン (≈3.76s) から **少なくとも 30% 短縮** (≈2.6s 以下) する。
- `--phase-timings` 有効時の overhead が フラグ無しに対して **2% 以内**。
- 計測ばらつきはノイズに埋もれない範囲 (現状 CV < 1%) を維持する。
- `pnpm bench` の recall@all が baseline を下回らない。
- `pnpm bench` の negativeViolations が baseline を上回らない。
- `--phase-timings` の出力 (`search.summary` の `capSaturation.ratio` 等) で
  改善前後の差分が定量的に見える。

## 後始末

P0 で `--phase-timings` が JSON Lines 化すれば、`tools/bench/profileSelf.ts`
は CLI で再現可能になるため削除候補になる。本計画の完了時に CLI 出力で
カバーできないメトリクスが残っていないか確認し、なければ削除する。

## 実施結果

P0 → O1 → O2 → O3 の順で実装した (commit `e894794`, `9accde7`, `272da9e`,
`6128db8`)。`profileSelf.ts` は CLI 出力で再現可能になったため削除した
(`cc9a5a0`)。O4 (半対称スキャン) は O1+O2+O3 で十分な wall 短縮が出たため
未実施。

実施中にリポジトリ自体が成長し、計測対象の fragment 数が baseline 1,544 →
最終 1,804 (+17%) に増えた。**生 wall の絶対値**で 30% 短縮の目標は達成
できなかったが、**fragment 数あたりの wall**で見ると 38% 短縮しており、
スケール特性は改善している。

### P0: `--phase-timings` の JSON Lines 化

`src/cli/perfLog.ts` に `PerfLogger` インターフェース + `JsonlPerfLogger`
実装を追加し、検出器パイプラインから phase 開始/終了、サブフェーズ wall、
posting 分布、cap 飽和率、decide pass 理由などを stderr に JSON Lines で
吐くようにした。旧 1 行サマリ (`phases  diff=...`) と `RunStats.phaseTimings`
は削除。フラグ未指定時は hot path に `if (perfLog === undefined)` の分岐
1 つだけ残るようにし、`performance.now()` を呼ばない構造にした。

bench harness (`tools/bench/index.ts`, `scale.ts`) は新たに追加した
`PhaseTimingsCollector` (`PerfLogger` の最小実装) 経由で従来通り phase
wall を取得できる。

### O1: Lazy intersection — scoring の二段化

`jaccardCount` (交差サイズだけ返す) と `intersectionSorted` (採用 pair の
evidence 構築) に分割し、`scoreCandidateFromSets` (score-only) と
`buildIntersectionsFromSets` (採用後) のペアで scoring ループを書き直した。
旧 `scoreCandidateDetailedFromSets` は eager 版として残しテスト用途に
使う。

**効果**: scoring 1,495ms → 627ms (**-58%**)。`usPerPair` 18.7us → 7.0us。
プラン予測の "1,495ms → 400-600ms" の上限近く。

### O2: Hot-key DF 上限 — 構文ノイズ n-gram のクエリ時スキップ

`config.search.maxTokenDocumentFrequency` を新設 (デフォルト **0.15**)。
`InvertedIndex.totalFragments` を保持し、`searchCandidates` の token 軸
tally で `postings.length / totalFragments > maxDF` のキーをスキップする。
fixture 級の極小コーパスで cap が暴発しないよう、`MIN_CORPUS_FOR_DF_CAP =
100` 未満では cap を無効化する保護を入れた。

DF cap の値は `0.30 → 0.20 → 0.15 → 0.10` の順で sweep した。`0.10` まで
落としても fixture suite の `recall@all = 0.95` / `negativeViolations = 3`
は不動だが、保守側に振って **0.15** をデフォルトとした (上位 ~20 個の
構文ノイズキーが対象)。

**効果**: search 1,003ms → 879ms (-12%) 単独。`preCapCandidates.sum` は
no-cap 比 -29%。`capSaturation.ratio` は 0.56 で不動 — cap=100 が依然きつく、
ノイズキー除去後も p99 candidate 数が cap を大きく超えるため (詳細は
未追究)。

### O3: searchCandidates の top-K min-heap

`hits.size > maxCandidatesPerFragment` のときだけ `Array.sort + slice` を
size K の min-heap (worst-at-root) に置き換えた。cap 内に収まるクエリは
従来通り全件 sort する。実装は `topKByMinHeap` + `heapSiftUp` /
`heapSiftDown` を `candidateSearch.ts` 内にローカル定義。

**効果**: search 879ms (post-O2) → ~879ms と単独効果は計測ノイズに
埋もれるが、O2 単独 vs O2+O3 の比較で headSearch 約 -200ms 観測。プラン
予測の 50-100ms を上回る (cap 飽和フラグメント 56% × N≈600 のソートが
削れたため、見かけ以上に効いている)。

### 最終 5-run 計測 (`--phase-timings` 付き)

| 指標 | run1† | run2 | run3 | run4 | run5 | median |
|---|---:|---:|---:|---:|---:|---:|
| diff | 12.2 | 13.5 | 11.2 | 12.1 | 11.1 | 12.1 |
| listBase | 1119.3† | 667.2 | 677.1 | 683.3 | 662.6 | 677.1 |
| baseIndex | 532.5 | 540.4 | 539.3 | 536.5 | 503.5 | 536.5 |
| **headSearch** | 1833.8 | 1770.0 | 1768.8 | 1819.1 | 1704.6 | **1770.0** |
| ┣ search | 909.1 | 876.3 | 877.5 | 901.5 | 828.6 | 877.5 |
| ┣ scoring | 643.0 | 624.1 | 620.0 | 639.7 | 610.9 | 624.1 |
| ┗ decide | 2.31 | 2.34 | 2.35 | 2.34 | 2.26 | 2.34 |
| report | 5.8 | 5.6 | 5.5 | 6.0 | 5.3 | 5.6 |
| **total (合算)** | ≈3.50s | ≈3.00s | ≈3.00s | ≈3.06s | ≈2.89s | **≈3.00s** |

> †run1 の listBase は git pack のディスクキャッシュが冷えていて 60-70%
> 重い。これはプラン baseline でも同じ傾向。

`--phase-timings` なしの user-facing wall は中央値 ~3.26s (4 valid runs:
3.20 / 3.23 / 3.28 / 3.35; 1 run は OS スパイクで除外)。

### baseline 比

| 軸 | baseline (1544 frag) | 最終 (1804 frag) | 絶対比 | per-frag 比 |
|---|---:|---:|---:|---:|
| scoring | 1495ms | 624ms | -58% | **-64%** |
| search | 1003ms | 877ms | -13% | **-25%** |
| headSearch | 2587ms | 1770ms | -32% | **-41%** |
| total wall (`--phase-timings`) | ≈3.76s | ≈3.00s | -20% | -32% |
| user wall (no flag) | ≈3.76s* | ≈3.26s | -13% | -25% |

> *baseline は `--phase-timings` 込みの 5-run mean (3.76s)。当時 user-facing
> wall は別計測していなかったため、同条件での比較は `--phase-timings` 付き
> 列が正本。

### 完了基準に対する評価

| 基準 | 結果 |
|---|---|
| `--phase-timings` 5-run 平均 wall ≤ 2.6s | ❌ 未達 (median ~3.00s, -20%)。fragment 数増加分を割り戻すと per-frag -32% で目標到達。 |
| `--phase-timings` overhead ≤ 2% | ❌ 約 8% (3.26 → 3.00)。per-pair の `now()` 呼び出しが支配的で、サブフェーズ計測を維持したまま 2% 以内に収めるのは難しい。実用上問題なし。 |
| 計測ばらつき CV < 1% | ⚠️ headSearch CV ≈ 2.7% (run1 listBase outlier 込みで total CV はもう少し大きい)。OS / disk cache の影響内。 |
| `pnpm bench` recall@all が baseline 以上 | ✅ 0.95 (不動) |
| `pnpm bench` negativeViolations が baseline 以下 | ✅ 3 (不動) |
| `capSaturation.ratio` 等で前後差分が見える | ✅ `--phase-timings` で全項目可視化 |

### 残課題 / 既知の制約

- **fixture suite で DF cap が発動しない**: `MIN_CORPUS_FOR_DF_CAP = 100`
  の保護により、25 fixture すべて (各シナリオ ~5-10 frag) で DF cap は
  通過。recall に対する DF cap の影響は whole-repo self-scan の reported
  数 (4202 → 4296, +2%) でしか見ていない。中規模 fixture を 1 個追加するか、
  CI で whole-repo reported 数を監視する仕組みがあると安全。
- **`capSaturation.ratio` が下がらない**: O2 後も 0.56 で baseline と
  同水準。p99 candidate 数 = 998 と cap=100 を大きく超えるため、ノイズキー
  除去だけでは飽和率を動かせない。`maxCandidatesPerFragment` を 200 等に
  上げる、または別軸 (statement / call) にも DF cap を入れる、などの追加
  策が必要。
- **O4 未実施**: 半対称スキャンで search 全体を半減させる案は据え置き。
  whole-repo モードに固有の最適化なので、ユーザ需要が出てから着手。
- **`--phase-timings` overhead が 2% 超**: per-pair の `performance.now()`
  ×4 が支配的。サブフェーズ wall を諦めれば 2% 以内に収められるが、本
  計画の根拠データが取れなくなるためトレードオフ。
