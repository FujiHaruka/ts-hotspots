# `coch` 出力 honesty 改善 — score・evidence・help text の三点修正

> Status: 計画 (未着手)
> Scope: cochange (`coch`) のみ。`comp` / `dup` / `arch` のスキーマや動作は変えない。

## Context

ts-hotspots を本リポジトリ自身に対して dogfooding (`/tmp/ts-hotspots-dogfooding-self-coch.md`) したところ、`coch` の出力に下流エージェントが誤読しやすい3つの honesty 問題が見つかった。いずれもメトリクスや判定ロジックの問題ではなく、**「出力フィールドが実際の挙動と一致していない」**問題なので、修正範囲は serialization 層と help text に閉じる。

1. **`score` の値が並び順と一致しない。** 各 hotspot は `score = { axis: "confidenceMax", value: confidenceMax }` を返すが、ソートキーは `support × confidenceMax` (`src/cochange/ranking/sort.ts:28-30`)。dogfooding では「score 0.857 の行が score 1.0 の行より上」という見かけの矛盾が生じた。`arch` (`composite`) と `dup` (`combined`) はソートキーをそのまま `score` に出していて、`coch` だけずれている。
2. **`allCoChangeCommits` が `recentCommits` のエイリアスになっている。** verbose schema (`src/cochange/report/schema.ts:53-67`) は "Full SHA list" と謳うが、walker (`src/cochange/walk/walkCochange.ts:41`) が `RECENT_CAP = 5` で打ち切るため、support>5 のペアでは sha 数 < support になる。フィールド名が嘘をついている状態で、verbose を信じて監査しようとした agent は再度 `git log -- A B` を回す必要がある。スキーマコメントも "If a future milestone teaches the walker to keep the full list, this field is the place to surface it" と将来対応を予約している。
3. **`actualWindow < requestedWindow` が説明されていない。** マージ多めの履歴では first-parent 走査が PR を1コミットに畳むため、本リポジトリでは raw 126 → first-parent 84 となる。stderr サマリは `window=84/200` と正直に出すが、ユーザは「200 を頼んだのに 84 しか得られなかった = shallow clone か?」と一拍考えてしまう。`--help` と verbose の `summary.actualWindow` コメントに一文添えれば解消する。

これら3つはどれも単独で出荷可能で、相互に依存しない。1つにまとめる理由は「出力 honesty」というテーマで監査痕跡が残るほうが後追いしやすいから。

dogfooding で見えたもう1つのパターン — **クラスタ形状の冗長性** (collectors のロックステップ移行が C(n,2)=6 行に展開される、CLI ハブが上位の半分を占める) — はこの計画には含めない。これは出力**形状**の話であって honesty ではなく、解決策がまだ確信を持てる段階にない (cluster rollup? anchor mode hint? quota?)。別リポジトリで dogfooding して証拠を増やしてから別計画に分離する。後述の "Deferred" 節で追跡。

## Approach

3つを独立した小さなマイルストーンに分け、`docs/plans/axis-degeneracy-guards.md` と同じ「論理的に独立、順序可換」スタイルで進める。コードの load-bearing は M1 と M2 のみで、いずれも serialization 層 (`src/cochange/report/serializeJson.ts` と `src/cochange/walk/walkCochange.ts`) に閉じる。

- **M1: `score` をソートキーに揃える。** `score.axis` を `confidenceMax` から `supportConfidence` (= `support × confidenceMax`) に変える。`arch`/`dup` の慣行 (sort で使う合成スカラを `score.value` に出す) に揃え、JSON の上下が score の上下と一致するようにする。type の `axis` リテラル、serializer、テストの期待値、Markdown レンダラ (もし score を文字列化していれば) を同時更新。`confidenceMax` 自体は `metrics.confidenceMax` に既に出ているので情報損失はない。
- **M2: `allCoChangeCommits` を本物にする。** walker の `RECENT_CAP = 5` を撤廃して内部では全 SHA を保持。serializer 層で slim 出力時のみ recent 5 件に切り詰める。verbose は `allCoChangeCommits` に全件、`recentCommits` に先頭5件を出す。メモリ予算は「pairsAfterGate × max_support」≦ 「pairsAfterGate × actualWindow」で、現実規模 (gate 後数百ペア × window 数百〜数千) では十分小さい。`coChangeWindow.firstSha/lastSha` も「全件の最初と最後」に意味が変わるので schema コメントを更新。
- **M3: `--help` と schema コメントに first-parent の注記。** `src/cochange/cli/registerCommand.ts` の `LONG_DESCRIPTION` に「`--first-parent` で走査するためマージ経由の PR は1コミットとして数える。`actualWindow < requestedWindow` の差はそれが原因のことが多い」を一文。`schema.ts` の `actualWindow` コメントも同じ趣旨に更新。

3つとも単独で出せるので、レビューと commit を別々に切る。M1 と M2 はスキーマの**意味**を変えるが、フィールド名と型は変わらない (M1 は axis literal だけ拡張、M2 は配列内容だけ増える) ので、agent コンシューマ側のコードはほぼ動かない。

## Per-file changes

### M1 — `score` をソートキーに揃える

ゴール: hotspots が JSON で並んでいる順序と `score.value` の単調性が一致する。

#### `src/cochange/report/schema.ts`

`CochangeScore.axis` のリテラルを差し替え:

```ts
// Before
export interface CochangeScore {
  axis: "confidenceMax";
  value: number;
}

// After
export interface CochangeScore {
  /**
   * Sort key surfaced as the headline score. Equals
   * `support × confidenceMax` — the same composite
   * `src/cochange/ranking/sort.ts` orders candidates by, so JSON ordering
   * and `score.value` ordering agree. The component metrics live in
   * `metrics.support` / `metrics.confidenceMax`.
   */
  axis: "supportConfidence";
  value: number;
}
```

#### `src/cochange/report/serializeJson.ts`

`toSlimHotspot` の `score`:

```ts
// Before
score: { axis: "confidenceMax", value: candidate.metrics.confidenceMax },

// After
score: {
  axis: "supportConfidence",
  value: candidate.metrics.support * candidate.metrics.confidenceMax,
},
```

#### `src/cochange/report/serializeJson.test.ts` / `serializeMarkdown.test.ts`

- `score.axis` の期待値 `"confidenceMax"` を `"supportConfidence"` に置換。
- `score.value` 期待値を `support × confidenceMax` に再計算。
- 「JSON の hotspots 配列順と `score.value` 降順が一致する」プロパティ的な assertion を1つ追加 (`hotspots.every((h, i) => i === 0 || h.score.value <= hotspots[i - 1]!.score.value)`)。今後また axis 名がずれた時に検知できる。

#### Markdown レンダラ

`grep -rn "confidenceMax" src/cochange/report/` で残存箇所を確認し、表ヘッダや人間向け文言が `score` に依存していたら追従。

#### `docs/plans/cochange-subcommand.md`

該当箇所 ("output schema" の節があれば) で `score.axis` のリテラルが書かれていれば更新。requirements として明記されているなら同時編集。

### M2 — `allCoChangeCommits` を本物にする

ゴール: verbose 出力の `allCoChangeCommits.length === metrics.support`。

#### `src/cochange/walk/walkCochange.ts`

`RECENT_CAP` を撤廃し、`PairEvidence.recent` を全件保持にする (型名は `commits: string[]` に改名検討、既存呼び出し点に影響あれば後追い):

```ts
// Before
const RECENT_CAP = 5;
...
if (sha !== undefined && entry.recent.length < RECENT_CAP) {
  entry.recent.push(sha);
}

// After
if (sha !== undefined) {
  entry.recent.push(sha);
}
```

メモリ計算メモ: gate は walk **後**に走るので、walk 中は all-pairs (本リポでは 2177) × support (典型 2〜12) のSHAを保持する。最悪ケース pairs × window でも数MB。許容範囲。気になる場合は walk 時点で `support < minSupportCandidate` のペアを枝刈りする最適化が考えられるが、本計画ではやらない。

#### `src/cochange/report/serializeJson.ts`

`toSlimHotspot.evidence.recentCommits` は **先頭5件に切り詰める** (これが slim/verbose の境界):

```ts
const RECENT_DISPLAY_CAP = 5;
...
evidence: {
  recentCommits: candidate.recent.slice(0, RECENT_DISPLAY_CAP),
},
```

`toVerboseHotspot.evidence`:

```ts
evidence: {
  recentCommits: slim.evidence.recentCommits,         // 先頭5件
  allCoChangeCommits: [...candidate.recent],          // 全件 (= support 件)
},
```

`coChangeWindow` の意味:
- 旧: 切り詰められた recent 5件の最初と最後。
- 新: 全 co-change コミットの最初と最後 (= 走査順、新→旧)。
- schema コメントを更新。

#### `src/cochange/report/schema.ts`

`SlimCochangeEvidence.recentCommits` のコメント:

```ts
/**
 * 最大5件の最近の co-change コミット (短い SHA、新→旧)。完全な SHA リスト
 * が必要な agent は `--verbose` で `allCoChangeCommits` を取得する。
 */
recentCommits: string[];
```

`VerboseCochangeEvidence.allCoChangeCommits` のコメント:

```ts
/**
 * このペアが両方とも touched された全コミットの SHA リスト (新→旧)。
 * 件数は `metrics.support` と一致する。
 */
allCoChangeCommits: string[];
```

#### `src/cochange/walk/walkCochange.test.ts`

- 「同一ペアで >5 回 co-change するとき、`pair.recent.length === support`」を assert する新ケース。
- 既存「最初の5件で truncated」期待ケースを「ソート順 (新→旧) が保たれる」に置換。

#### `src/cochange/report/serializeJson.test.ts`

- slim: `evidence.recentCommits.length <= 5` を維持。
- verbose: `evidence.allCoChangeCommits.length === metrics.support`。
- 既存の「`allCoChangeCommits` aliases `recentCommits`」を assert している箇所 (`serializeJson.test.ts:181`) を上記に書き換え。

#### `docs/plans/cochange-subcommand.md`

requirements に "M2's walker only retains the first 5 recent SHAs" の trade-off が書かれていれば、現在の挙動として記録に書き直す (履歴のために削除はしない)。

### M3 — first-parent 注記を help と schema に追加

ゴール: ユーザが `actualWindow=84/200` を見て一拍迷う回数を減らす。コード変更は文字列のみ。

#### `src/cochange/cli/registerCommand.ts`

`LONG_DESCRIPTION` に追記:

```
By default the entire repository is scanned at HEAD over the last 200
commits. Pass --ref to choose a different endpoint, --window to widen
or narrow the walk. Output is written to stdout; redirect it to a file
if you want to keep it.

The walk uses `git log --first-parent`, so PRs that landed via merge
commits count as a single step. Repos with merge-heavy history will
report `actualWindow < requestedWindow`; that is shape, not a shallow
clone.

[path] points at a directory inside a git repository. ...
```

#### `src/cochange/report/schema.ts`

`CochangeSummary.actualWindow` のコメント:

```ts
/**
 * Commits the walk actually saw. May be < `requestedWindow` because
 * (a) shallow clone, or (b) merge-heavy history collapses under
 * `--first-parent`. The latter is the common case.
 */
actualWindow: number;
```

#### `README.md`

cochange セクションがあれば1行追加。なければスキップ (CLAUDE.md の「first-time reader 向けに書く」原則に従って、必要最小限に留める)。

## Validation

- 各マイルストーンで `pnpm test:related` を回す (`src/cochange/` 配下のテストが引っ張られる)。
- 完了後、本リポジトリに対して再度 `node src/index.ts coch --verbose --format json` を流し、出力 (新しい `score` axis、`allCoChangeCommits.length === support`) を目視確認。
- `pnpm test` は M3 マージ後に1回だけ。

## Acceptance

- `score.axis === "supportConfidence"` で `score.value === metrics.support * metrics.confidenceMax`。hotspots[] の並びと `score.value` 降順が一致する。
- verbose 出力で `evidence.allCoChangeCommits.length === metrics.support`。slim は5件上限を維持。
- `coch --help` に first-parent の説明が一文ある。`schema.ts` の `actualWindow` コメントも追従している。

## Deferred (この計画には含めない)

### Cluster rollup / 冗長性圧縮
本リポでの dogfooding では、collectors のロックステップ移行が 6 行、CLI ハブ結合が 6 行と、表示 20 件のうち 12 件が同じ意味の別ペアになっていた。pair-only 出力の構造的限界。候補解:

- 「support N 以上の連結成分」をまず1行で出してから内部のペアを折りたたむ。
- anchor mode に「このパートナー集合は同じ証拠コミット集合に属する」ヒントを足す。
- `--limit` 内で同一ハブ片側のペアに quota をかける。

どれも下流 agent への意味付けが大きく変わるので、本リポ1件の証拠で決め打ちしたくない。別リポでの dogfooding 結果を待ってから別計画 (`docs/plans/coch-cluster-rollup.md` 想定) に分ける。

### `score` を sort key 以外の選択肢にする可能性
`support × confidenceMax` を採用する代わりに、別の合成 (例: `support * lift`、または `confidenceMax + log(support)`) でもよい。コール候補の見え方が変わるので、本計画では「現状の sort key を honest に出す」だけに留め、**ranking ロジック自体の見直し**は分離する。
