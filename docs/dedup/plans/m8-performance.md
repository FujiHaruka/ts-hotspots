# M8 (slice 4): 性能計測

[docs/plans/milestones.md](./milestones.md) M8 成果物のうち
「性能計測と、明らかな hotspot の最適化」を満たすためのスライス計画。

## スタンス

**最適化第一ではなく、計測第一**。現時点で速度の苦情は出ておらず、
fixture suite baseline は 25 シナリオ 6.7s (≈ 67ms / run)。
計測して「明らかな hotspot が **無い** こと」を示せれば、それで M8 は閉じられる。

つまりこのスライスの成功条件は **速くすることではなく、
意思決定できるだけの数値を残すこと**。最適化は hotspot が実際に見えたときだけ行う。

## 目的

1. **フェーズ別 wall time** を取る。現状の bench は `runDetector` 全体の
   wall しか見ていないので、parse / index / search / score / report のどれが
   支配的かが分からない。hotspot の有無は per-phase 内訳で判断する。
2. **コードベース規模に対する挙動** を確認する。fixture は小さい (1〜10 ファイル)。
   実ユースケース (大きめの monorepo に対する PR) で線形以上にスケールする処理が
   無いかを 1 回だけ実測して確認する。
3. **baseline スナップショット** を `tools/bench/baseline/` に残し、将来
   「体感で遅くなった」を裏付ける比較軸にする。ただし CI の perf 回帰検知は入れない
   (JIT ウォームアップ / GC タイミングで本質的に flaky)。

## Non-goals

- **マイクロ最適化**: hot path の `for` ループ書き換え、一時配列の排除などは
  計測で必要性が出るまで触らない。
- **perf CI 化**: wallMs を CI で回帰検知するテストは入れない。flaky 過ぎる。
  bench はあくまで on-demand な観測ツールに留める。
- **並列化**: 決定性と引き換えに並列化する判断は M8 の範囲外。
- **別エンジンへの差し替え**: TS compiler API を `@swc/core` 等に差し替える検討は
  しない。hotspot が parse 段に集中したときに M9 以降で検討する選択肢として残すのみ。

## Approach

### 1. フェーズ別計測のための instrumentation

`runDetector` に optional な phase timing 収集を仕込む。出力は `RunStats` に
追加フィールドとして生やす:

```ts
export interface RunStats {
  // ...existing fields
  phaseTimings?: {
    diff: number;       // collectChangedFragments
    listBase: number;   // listBaseSources
    baseIndex: number;  // base loop (parse + extractFragments + extractFeatures) + buildInvertedIndex
    headSearch: number; // head loop (parse + extractFeatures + searchCandidates + score + shouldReport)
    report: number;     // buildJsonReport (collapse + rank + serialise)
  };
}
```

取り方:

- `RunOptions` に `collectPhaseTimings?: boolean` を足す。`true` のときだけ
  `performance.now()` でフェーズ境界を計る。default は false で計測オーバーヘッドを防ぐ。
- フェーズ境界は `runDetector` 内の既存コメント (`// ---- Base side:` 等) に
  合わせる。細分化しすぎると読みづらいので 5 フェーズで十分。
- 決定性を壊さない: `phaseTimings` は `stats` 側のみ、report 本文には載せない。

### 2. bench harness の拡張

`tools/bench/index.ts` に `--phase-timings` フラグを足し、立てたときだけ
`runDetector` に `collectPhaseTimings: true` を渡し、`RunSummary` に
per-phase 平均 / 最大 / 合計の行を追加する。

出力例:

```
## phase breakdown (baseline, 25 fixtures)

| phase       | mean ms | p90 ms | max ms | share |
|-------------|--------:|-------:|-------:|------:|
| diff        |     4.8 |    8.1 |   12.3 |   7%  |
| listBase    |     2.1 |    4.0 |    6.2 |   3%  |
| baseIndex   |    31.2 |   52.4 |   88.0 |  47%  |
| headSearch  |    22.0 |   41.0 |   60.1 |  33%  |
| report      |     6.5 |   11.2 |   15.8 |  10%  |
```

全 variant (baseline + ablation 3) でなく baseline のみに出す
(ablation は feature off の効果を見る用途で、phase breakdown は config 不変部分の議論なので重複する)。

### 3. スケーリングの 1 回実測

fixture suite は入力サイズがどれも小さい (各 base 数ファイル、LOC 数十〜数百)。
実ユースケースの「数百〜数千ファイル規模のリポジトリに対する PR」で
どの phase がどれくらい伸びるかを 1 回だけ測る。

手段:

- **対象**: ts-dedup 自身のリポジトリ。`src/` が 70 ファイル程度あり、fixture より
  1 桁大きい。外部リポジトリを持ち込まずに済むのが利点。
- **やり方**: 既存の 2 コミット (例: `M7` ↔ `HEAD`) を `baseRef` / `headRef` に使い、
  `tools/bench/scale.ts` (もしくは `bench --scale` モード) で
  `runDetector({ collectPhaseTimings: true })` を 3 回走らせ中央値を取る。
- **ワンショットで十分**: 継続計測ではない。数値を `tools/bench/baseline/scale.md` に
  チェックインして終わり。

### 4. 判定ゲート

計測結果に対する **決定ルールを先に決める** (後付けで解釈しない):

- **hotspot 判定**: 特定の phase が wall の **50% 以上** を占める、または
  base ファイル数に対して線形より悪い (≈ 2 倍超のファイル数で 4 倍超の時間に伸びる)
  スケールを示す。
- **上記に該当しなければ**: 「明らかな hotspot なし」と判定し、最適化スキップで M8 完了。
- **該当した場合**: その phase のみ追加調査 (プロファイラ or コードレビュー) して
  1 回だけ最適化を試みる。2 つ以上の hotspot が出たら M9 送り。

## 成果物

```
docs/plans/m8-performance.md         # 本計画

src/cli/runDetector.ts               # phase timing 収集を option 化
src/cli/runDetector.test.ts          # phase timing が collectPhaseTimings=true でのみ出ることを確認

tools/bench/index.ts                 # --phase-timings フラグ追加
tools/bench/metrics.ts               # per-phase aggregation
tools/bench/formatMarkdown.ts        # phase breakdown テーブル出力
tools/bench/baseline/summary.md      # phase breakdown 行が増える

tools/bench/baseline/scale.md        # ts-dedup 自身に対する 1 回実測の結果
```

## 受け入れ基準

- [x] `runDetector({ collectPhaseTimings: true })` が 5 phase (`diff`, `listBase`,
      `baseIndex`, `headSearch`, `report`) の wall ms を返す。
- [x] `pnpm bench --phase-timings` が 25 fixture の phase breakdown 表を
      summary.md に出力する。
- [x] `tools/bench/baseline/scale.md` に ts-dedup 自身に対する計測結果
      (phase 別 wall + base ファイル数 + 比率) がチェックインされている。
- [x] 判定ゲートに沿った結論が `scale.md` に記述されている。
- [x] `pnpm test` / `pnpm typecheck` / `pnpm lint` 通過。

## 計測結果 (2026-04-25)

- **fixture bench (`pnpm bench --phase-timings`)**: 25 fixture, `diff` 70% /
  `listBase` 22%。小サイズ入力では git サブプロセスの固定コストが支配的で
  計算フェーズの実体を隠してしまう。
- **scale probe (`pnpm bench:scale --base 7c3c7bf`)**: ts-dedup 自身の M7..HEAD
  (base 94 files / 1682 fragments, changed 38 files / 668 fragments, 37k 候補ペア) で
  **`headSearch` が 87% (7.58s / 8.73s)**。判定ゲート発動。
- **結論**: `headSearch` の re-score フェーズが現実サイズで支配的。
  M8 のクローズ条件は「計測して意思決定できる数値を残す」までなので、
  最適化自体は follow-up slice に回す (候補アプローチは `scale.md` 参照)。
  単一 hotspot なので M9 送り条件 (複数 hotspot) には該当しない。

## リスク / 留意点

- **measurement bias**: `performance.now()` 自体の解像度 / オーバーヘッドは
  今回の規模 (ms オーダー) では無視できる。ウォームアップも 3 回中央値で吸収する。
- **hot phase が実は不可避**: TypeScript パーサ (parse 段) が支配的になっても、
  差し替えは M8 スコープ外と最初から決めている。「parse が重い」で止まってよい。
- **フェーズ粒度の選び方**: 5 に切ったのは runDetector のコメント構造に合わせた判断。
  頭の中で「この 5 つのどれが重い?」と即答できる粒度が最適。これ以上細分化すると
  意思決定と無関係なノイズになる。
- **optional にする理由**: instrumentation を常時 on にすると `performance.now()` の
  呼び出しが報告に乗らないレベルでも「常に計測してる感じ」が出て決定性テストの純度が
  下がる (timings がレポートに載らなくても、計測が in-process の副作用に見えるため)。
  opt-in にしておけば既存の決定性テストは一切変更不要。

## フェーズ分け

Phase 1 のみ。最適化が必要になった場合の Phase 2 (実装) は判定後に別計画にする。

1. **instrumentation + bench 拡張** (半日):
   runDetector の timing 収集、bench の `--phase-timings`、summary.md への
   phase breakdown 行の追加。
2. **scale 実測とレポート** (2〜3 時間):
   ts-dedup 自身を対象に 1 ショット計測し `scale.md` にチェックイン。
   結論を書き切って M8 クローズ。

## 依存

- Slice 2 (`m8-fixture-suite.md`): bench harness と 25 fixture を再利用。済。
- Slice 1 / 3 とは独立。
