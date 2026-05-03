# `coch` cluster rollup と表示まわりの改善 — 3 マイルストーン

> Status: 計画 (未着手)
> Scope: cochange (`coch`) のみ。`comp` / `dup` / `arch` のスキーマや動作は変えない。
> Antecedent: `docs/plans/coch-improve-output-honesty.md` の Deferred 節で「別リポジトリでの dogfooding を待ってから別計画 (`docs/plans/coch-cluster-rollup.md` 想定) に分ける」と予告されたものの本体。

## Context

`coch-improve-output-honesty.md` (M1〜M3) で score 軸・evidence 全件・first-parent 注記の三点は出荷済み。今回 2 リポ目の dogfooding (private-eval-repo、観察ノートは `/tmp/ts-hotspots-dogfooding-private-eval-repo-coch.md`) を回したところ、出力**形状**側に次の 3 つの問題が確認された。

1. **クラスタが C(N, 2) ペアに展開されて表示枠を食う。** private-eval-repo の上位 20 件のうち、`{conversation-type-config, workflow-prompt, workflow-chat-panel}` の三角クラスタが 3 行を消費。さらに同一ディレクトリ内 sibling のロックステップ移行が 7 行。`schema.ts` と `trpc.ts` がそれぞれ別パートナーと組んで 3 行ずつ。20 件のうち 13 件が「同じ一つの結合実態を別ペアで言い直したもの」になっている。前回計画の Deferred で 1 リポ目 (本リポ自身) でも同パターンが出ていたので、**2 リポ独立で再現**したことになる。pair-only 出力の構造的限界。
2. **表示フィルタが空になったとき soft hint がない。** `--diff` や `--file` がペアを 0 件に絞ったときも JSON は `hotspots: []` を返すだけ。stderr の stats 行に `pairsAfterGate=74, displayed=0` は出るが、これは pipeline の通常出力に紛れていて「フィルタが原因 vs. ゲート後そもそもゼロ」を読み手が一拍考える必要がある。`--verbose` を渡さないと `summary.pairsAfterGate` も読めない。
3. **観察ノート用の FP 分類タクソノミーが docs に書かれていない。** `docs/dogfooding-prompt.md` は `comp` 用に書かれており、cochange 固有の偽陽性カテゴリ (cluster-as-pairs / central-file amplification / same-dir siblings / floor-of-window lift inflation) が前提に入っていない。次の dogfood セッションが分類のブレで観察を再発見するコストを毎回払っている。

これら 3 つはどれも**出力形状と読み手の解釈支援**の問題で、ranking の数値計算自体は変えない (前回計画と同じスタンス)。

## Approach

3 つを独立した小さなマイルストーンに分け、`coch-improve-output-honesty.md` と同じ「論理的に独立、順序可換」スタイルで進める。コードの load-bearing は M2 のみ。

- **M1 (small): 表示フィルタ空のときに stderr soft hint。** `runPipeline` の終端で `finalHotspots.length === 0 && pairsAfterGate > 0` を検知し、stats 行とは別の専用行を 1 本出す。原因 (`--diff` / `--file` / dismissal) を可能な範囲で特定して付記する。CLI 層に閉じる。
- **M2 (load-bearing): cluster rollup を表示層に導入。** ranking とゲートはペア単位のまま (アルゴリズム不変) で、serialize 直前にペア集合を連結成分に分解し、密な部分グラフをひとつの hotspot 行に畳む。pair-only モードと cluster 行が同じ `hotspots[]` 配列に共存する。`size` リテラルが `2` 固定だった制約を `>= 2` に緩める。`--file` 単独アンカーモードでは適用しない (ユーザが明示的にペア視点を要求しているため)。dismissal ID は cluster の member set から派生させる。
- **M3 (docs): cochange 専用の FP 分類タクソノミーを `docs/dogfooding-prompt.md` に追加。** または `docs/dogfooding-prompt-coch.md` を新設。次回以降の dogfood が分類済みの語彙で観察できるようにする。

3 つとも単独で出せる。M2 は schema を緩める変更を含むので、agent コンシューマ側 (`size === 2` を assert している implementer がいたら) に配慮が必要だが、現状 `size` は 2 固定リテラルなので additive な緩和に近い。

優先順は M1 → M3 → M2 を推奨 (リスク順): M1 が即効、M3 が docs だけで議論不要、M2 が一番大きい。順序入れ替えは可能。

## Per-file changes

### M1 — 表示フィルタ空のときに stderr soft hint

ゴール: `coch --diff <small-branch>` のような呼び出しで `displayed=0` になったとき、ユーザが `--verbose` を渡さなくても「ゲート後候補は存在するがフィルタで切り落とされた」ことが 1 行で分かる。

#### `src/cochange/cli/main.ts`

`runPipeline` 末尾、`io.stdout.write(...)` と `renderStatsLine(...)` の間に追加:

```ts
if (
  finalHotspots.length === 0 &&
  reportInput.pairsAfterGate > 0
) {
  const cause = describeEmptyDisplayCause({
    pairsAfterGate: reportInput.pairsAfterGate,
    diffApplied: scope !== undefined,
    anchorApplied: anchor !== undefined,
    dismissedActive: dismissed?.active ?? 0,
  });
  io.stderr.write(
    renderStatsLine(
      "cochange",
      `no displayed pairs (pairsAfterGate=${String(
        reportInput.pairsAfterGate,
      )}; ${cause})`,
    ),
  );
}
```

`describeEmptyDisplayCause` は同ファイル内に小さな helper として置く。優先順位は `diffApplied → anchorApplied → dismissedActive → "all gated pairs trimmed by --limit 0"` (limit 0 は理屈上ありうるがエッジケース)。

#### `src/cochange/cli/main.test.ts`

新規ケース:
- `--diff` 適用後の hotspots 0 件 → 専用 hint 行が stderr に出る、stats 行も従来通り出る (二行両方)。
- `--file` で anchor mode、partner 0 件 → hint 行に `--file filter` を含む。
- `pairsAfterGate === 0` のとき → hint **は出さない** (これは「ゲート後そもそもゼロ」で別の話)。

#### `README.md` / `docs/plans/cochange-subcommand.md`

特に文言変更は不要。新規 stderr 行は補助情報なので requirements 側に登録する義務はない。

### M2 — cluster rollup を表示層に導入

ゴール: 連結成分が k 個以上の dense 関係を持つペア集合を 1 つの hotspot 行に畳む。pair 行と cluster 行が同じ `hotspots[]` 配列に並ぶ。

#### 新規モジュール `src/cochange/report/collapseClusters.ts`

入力: ソート済み `Candidate[]` (whole-repo モードのみ)。
出力: `Array<Candidate | ClusterCandidate>`、ソート順は維持 (cluster の score は構成ペアの max)。

検出ルール (初期値、後で調整可能):

1. ペアの無向グラフを作る (ノード = file path、エッジ = ペア)。
2. 連結成分を取り、`size >= 3` のものをクラスタ候補とする。
3. 候補のうち**密度** `edges / C(nodes, 2) >= 0.5` を満たすものを cluster 行に畳む。0.5 未満は「複数のペアがハブを共有しているだけ」なので畳まずペア行で残す。
4. 畳んだあとは、cluster 行を構成ペアの max score 位置に挿入し、構成ペア行は除外する。

メトリクス集約 (cluster 行に持たせる):
- `support`: 構成ペアの median (max は外れ値に引っ張られる、min は意味が薄い、median が代表値)。
- `confidenceMax`: 構成ペアの max。
- `lift`: 構成ペアの median。
- `score.value`: 構成ペアの max `support × confidenceMax`。
- `members`: クラスタ全 member のソート済みリスト。
- `evidence.recentCommits`: 構成ペアの recent SHA を union → 重複除去 → 新→旧でソート → 先頭 5 件。
- `evidence.allCoChangeCommits` (verbose 時): 同じく union 全件。

設計 trade-off: 「median を代表値にする」「density 0.5 を閾値にする」は本リポと private-eval-repo の 2 サンプルからの暫定値。実装後に同じ 2 リポで before/after を取り、上位 20 件の有用密度 (true signal 比) が改善することを確認する。

#### `src/cochange/report/schema.ts`

`SlimCochangeHotspot.size` を `2` 固定から `number` (実質 `>= 2`) に緩める:

```ts
// Before
export interface SlimCochangeHotspot {
  ...
  /** `(anchor ? 1 : 0) + members.length`. Always `2` for a pair. */
  size: 2;
  ...
}

// After
export interface SlimCochangeHotspot {
  ...
  /**
   * `(anchor ? 1 : 0) + members.length`. `2` for a pair (default and
   * `--file` mode), `>= 3` for a cluster row collapsed by
   * `collapseClusters`.
   */
  size: number;
  ...
  /** `2` のときペア。`>= 3` のとき cluster で、members は集約された全 file。 */
  members: { ref: CochangeHotspotRef }[];
  ...
}
```

新規ヘルパ用に `CochangeRowKind = "pair" | "cluster"` フィールドを足すことも検討するが、`size` で判別できるので冗長。コンシューマには `size === 2` でブランチさせる。

#### `src/cochange/report/serializeJson.ts`

`serializeReport` 内で whole-repo モード判定 (`anchor === undefined`) のとき `collapseClusters` を呼んでから map する。anchor mode (`--file`) は呼ばない。

```ts
const sortedRows =
  anchor === undefined
    ? collapseClusters(input.candidates)
    : input.candidates;

return {
  ...
  hotspots: sortedRows.map((row) =>
    row.kind === "cluster"
      ? toClusterHotspot(row, input)
      : toSlimHotspot(row),
  ),
  ...
};
```

`toClusterHotspot` は新規。verbose 版も同様に分岐。

#### `src/cochange/report/dismissalId.ts`

`computeCochangeClusterDismissalId(memberPaths: readonly string[])` を新規追加。member paths をソート → join → SHA-256 → 先頭 16 hex。出力 prefix は `coch:` のまま (CLAUDE.md の dismissal ID プレフィクスルール) で、ペアと衝突しないことは入力空間が違うので統計的に保証される。

#### `src/cochange/report/serializeMarkdown.ts`

cluster 行用のレンダリング:
- ヘッダ: `Cluster (N files)` のような表示。
- members は箇条書き、N が 5 を超えたら `... and M more` 表示と verbose で全件アクセス可能の旨。
- メトリクスは "median support / max confidence / median lift" と注釈付きで出す (集約方法が pair 行と違うため)。

#### `src/cochange/report/collapseClusters.test.ts`

- 三角クラスタ (3 nodes, 3 edges, density 1.0) → 1 cluster 行。
- 4 nodes 4 edges (square, density 4/6=0.67) → 1 cluster 行。
- 4 nodes 3 edges (path, density 0.5) → 閾値ぎり。設計判断としては畳まない (「path-like は本当に密ではない」)、なので pair 行 3 本のまま。
- 4 nodes 2 edges (V 字、共通 hub、density 0.33) → 畳まずペア行のまま。これが central-file amplification の正しい扱い (cluster ではなくハブ)。
- 単独ペア → そのままペア行。
- evidence union: 同じ SHA が複数ペアに出る (ロックステップ移行の典型) → 重複除去されている。

#### `src/cochange/report/serializeJson.test.ts` / `serializeMarkdown.test.ts`

- `size === 2` の従来 hotspot 形状は不変であること。
- cluster 行が `size >= 3` を持ち、members に全 file が入っていること。
- ソート順 (`hotspots[i].score.value` 降順) は cluster 混在でも維持されること。
- anchor mode (`--file`) では cluster 行が一切出ないこと。

#### `docs/plans/cochange-subcommand.md`

「output schema」節があれば `size: 2` 固定の記述を `size >= 2` に書き換え。cluster 行のメトリクス集約方法を 1 段落で要約。

### M3 — cochange 専用 FP 分類を docs に固定化

ゴール: 次回以降の dogfooding が「cluster-as-pairs」「central-file amplification」を毎回再発見しない。

#### `docs/dogfooding-prompt.md`

末尾 (現状の `## Out of scope` の前) に subcommand 別 FP セクションを追加:

```markdown
## Subcommand-specific false-positive categories

### `comp` (existing)
- Structural FP / Idiomatic FP / Boundary FP / Barrel-or-shared-types high fan-in
  (defined in step 2 above).

### `coch` cochange-specific
- **Same-dir sibling lockstep**: files in the same directory that import
  each other and naturally co-evolve. True coupling but trivially
  derivable from the import graph; does little to accelerate exploration.
- **Central-file amplification**: a hub file (DB schema, root tRPC
  router, top-level `index.ts`) appears in N displayed pairs with N
  different partners. Each pair is individually defensible but the
  agent learns the same fact N times.
- **Cluster-as-pairs**: when M files mutually co-change, C(M, 2) pairs
  compete for top-N display. One logical insight occupies multiple rows.
  (Mitigated by the cluster-rollup display, but residual N=2 cases
  still surface.)
- **Floor-of-window lift inflation**: pairs at `support === minSupport`
  whose constituent files barely change at all (`min(chA, chB) === support`)
  produce mathematically-correct but evidence-thin lift values that
  look impressive in isolation. The score sort already deprioritises
  them; reader-side caveat only.

### `arch` / `dup`
(none recorded yet; add as future dogfooding sessions surface stable patterns.)
```

これで dogfood 担当が classification を一貫させやすくなる。

#### `docs/plans/coch-cluster-rollup.md`

(本ファイル) — M3 完了後、上記タクソノミーの「Cluster-as-pairs」項に「(M2 で表示層が rollup するようになったため、残るのは cluster 化されなかった単独ペアのみ)」を補記する。M2 と M3 の merge 順次第で順序が変わる点に注意。

## Validation

- 各マイルストーンで `pnpm test:related` を回す。
- M2 完了後、本リポと private-eval-repo の両方で `node src/index.ts coch --format json --limit all` を取り、before/after で:
  - 上位 20 件の hotspot 数 (cluster 化で減る想定)
  - 上位 20 件の uniq member file 数 (増える想定)
  - cluster 行 1 つあたりの member 数の分布
  を観察ノートに記録。改善できていなければ density 閾値や集約値を再検討して再計測。
- `pnpm test` は M2 マージ後に 1 回だけ。

## Acceptance

- **M1**: `--diff` でペアが全滅する小ケース (テスト用 fixture) で stderr に `no displayed pairs (pairsAfterGate=N; --diff filter)` の行が出る。`pairsAfterGate=0` のときは出ない。
- **M2**: 三角・四角クラスタが cluster 行 1 つに畳まれる。anchor mode と `size === 2` 既存ケースは挙動不変。serializer の 既存 snapshot test は cluster 関連だけ更新差分が出る。
- **M3**: `docs/dogfooding-prompt.md` に上記の cochange セクションが入っており、文言が観察ノート (`/tmp/ts-hotspots-dogfooding-private-eval-repo-coch.md`) の "Categories" 表と整合する。

## Deferred (本計画には含めない)

### Floor-of-window lift inflation の sort 側調整

観察ノートの R2 として上がった「`min(chA, chB)` を sort key に混ぜて floor pair をさらに下げる」案。
理由: 現行の `support × confidenceMax` 軸で floor pair はすでに 17〜20 位に沈んでおり、誤って top に来てはいない。残る問題は「行を見たとき lift = 66.7 が目立つ」だけで、これは表示の問題。
M3 のタクソノミーに「reader-side caveat only」と明記して、ロジック変更は dogfood 結果が "floor pair が top に来てしまった" 事例を出してから検討する。

### Central-file amplification を top-N 選択時に多様化する quota

例: 「上位 20 件のうち同じ file を含む行は最大 2 行まで」。
理由: M2 の cluster rollup を入れると central-file amplification の半分は自動で解消する (hub と密な周辺がクラスタ化される) はず。残る "純粋な central file 結合" は別問題で、quota は agent の attention budget を歪める副作用がある (本物の重要結合を切り落とす可能性)。M2 後に再評価。

### cluster 検出ルールの調整 (density 閾値、集約値の選択)

本計画では密度 0.5 / median 集約を初期値とする。M2 後に 2 リポで before/after を取り、有用性が下がっていれば 0.6 に上げる、median を min に変える等の調整を別ミニ計画で扱う。
