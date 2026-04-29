# クローン群の出力 (Step 2): Whole-repo モードのグラフクラスタ化

## 背景

Step 1 ([`clone-groups-pr-pivot.md`](./clone-groups-pr-pivot.md)) で、レポートを
`groups: CloneGroup[]` 形式に切り替えた。PR モードでは `changedFragment.id` を anchor として
pivot するだけで自然に「1 変更箇所 ↔ N base 箇所」の群が出る。

一方 Whole-repo モードでは:

- 索引側 = クエリ側 で対称。`(A, B)` ペアは canonical 化で 1 度だけ処理されるが、Step 1 の
  pivot をそのまま適用すると同じクラスタ `{A, B, C}` が `(A→{B, C})` `(B→{A, C})` `(C→{A, B})`
  の 3 群として冗長に出力される。
- 真にやりたいことは「`{A, B, C}` という 1 つのクラスタとして 1 度だけ報告する」。
- `(A, B)` と `(B, C)` がそれぞれ通っても、`(A, C)` は閾値割れの可能性があり、ナイーブな
  連結成分は「鎖伝播で実際には似ていないものが束ねられる」。

本計画は whole-repo モード専用に、報告対象 pair をエッジ・fragment をノードとする無向グラフ
を構築し、十分密な部分集合だけを clone group として抽出する。schema は Step 1 で導入した
`CloneGroup` を再利用 (anchor は whole-repo モードでは `undefined`)。

関連: [docs/algorithms.md](../algorithms.md) §4 (候補検索), §6 (報告判定),
§7.2 (cross-granularity collapse), §8.2 (Whole-repo モード)。

## Approach

**Step 1 のレポート段の入口 (= ペアを group 化する直前) で、whole-repo モードのみ
ペア集合に対してグラフクラスタリングを挟む。** PR モードの pivot 経路には触らない。

```
ScoredPair[]
  → unique
  → dropLowSemanticEvidence
  → collapsePairs (pair 段の cross-granularity collapse)
  → dropThinWrapperPairs
  → sortCandidates / capPerFragmentPairs (pair 段の cap)
  → [PR モード]      buildCloneGroups (anchor = changedFragment.id)
  → [Whole-repo]     clusterPairs → buildCloneGroupsFromClusters
```

クラスタリングのアルゴリズム:

1. **エッジ pruning**: 入力 pair のうち `combined < config.report.cluster.minEdgeCombined`
   (既定 `thresholds.combined`) のものは群形成エッジに使わない。`riskFlags: ["threshold-based"]`
   に該当するエッジ (= 軸単独 OR で滑り込んだ弱マッチ) も群形成からは除外。これらは「クラスタ
   の glue として使うには弱い」シグナルなので。ただし pair 自体は他のクラスタに属する可能性が
   あるので保持しておく (後段の「member 拡張」で利用)。
2. **連結成分**: 残ったエッジで連結成分 (CC) を取る。`Map<fragmentId, Set<fragmentId>>` で
   隣接リスト → BFS。CC のノード入力順は `pair` の入力順 (= ScoredPair[] のソート結果) で固定し、
   BFS 内の遷移順も隣接リストの追加順で固定する (決定性)。
3. **密度フィルタ**: 各 CC について `density = edges / (n*(n-1)/2)` を算出。
   `density >= config.report.cluster.minDensity` (既定 `0.6`) ならそのまま採用。下回るなら
   **greedy quasi-clique 抽出** で分割:
   - 全ノードを「CC 内 degree 降順 → fragmentId 昇順」でソート。
   - 先頭ノード `seed` を取り、その隣接ノード集合 `N(seed)` を `seed` への辺重み
     (`combined`) 降順でソート。
   - `cluster = {seed}` から始め、各候補ノード `v` を順に検査:
     `cluster ∪ {v}` の密度が `minDensity` を維持するなら追加、しないなら捨てる。
   - 抽出された cluster をエッジ・ノードごと CC から除去し、CC 内に 2 ノード以上残っていれば
     残りに対して同じ手続きを再帰。
   - これにより「鎖でぶら下がっているだけ」のノードは clone group から弾かれる。
4. **member 拡張 (任意)**: クラスタ確定後、クラスタ内のいずれかのノードに対して
   `combined >= thresholds.combined` (= step 1 でクラスタ核から除外したエッジも含む) で
   結ばれているノードがあれば、`weak member` として追加して `riskFlags: ["weak-member"]` を
   立てる…のは Step 2 のスコープから外す (下記 Out of scope)。Step 2 では純粋に「core 群」だけ。
5. **群内 cross-granularity collapse**: 1 つの実体 (例: `foo.ts` の `function bar` 全体) が
   function / block / window で別ノードとして潜り込んでいる場合、`(filePath, lineRange)` の
   包含関係でクラスタ内も再縮約する。`collapsePairs` のロジックを **クラスタ単位に** 拡張:
   - クラスタ内ノードを `(endLine - startLine + 1)` 降順 → kind 優先 (function > block > window)
     → fragmentId 昇順 でソート。
   - 先頭から順に「採用済みのいずれかと同じ filePath で行範囲完全包含」になるノードは捨てる。
   - 残ったノードがクラスタの最終 member となる。これにより 1 場所 = 1 ノードが保証される。
6. **CloneGroup への変換**: 各クラスタを `CloneGroup` に変換。anchor は `undefined`。
   `members` は確定ノードを fragmentId 昇順で並べる (whole-repo モードに privileged な
   方向は無いため)。`aggregateScores` はクラスタ内の **全ペア** (= n*(n-1)/2 ペア) の
   combined / 各軸 score を集計して min/median/max。`sharedEvidence` も全ペアの
   `intersections` を全部畳み込んで「全 member 間で共有されているキー」だけ残す。
   `recommendationHint` はクラスタ全体の最弱ペア基準で `deriveHint`。

決定性 (要件 §5.2):

- 入力 `pair` は既に Step 1 までで決定的にソートされている (`sortCandidates`)。
- BFS の遷移順、quasi-clique 抽出の seed 選択、density 同点時のタイブレーカは
  すべて `fragmentId` 昇順で確定する。
- 群内 collapse のソートも完全決定的。

設計判断のメモ:

- **クラスタ判定を完全な MaxClique にしない**: 厳密 MaxClique は NP-hard で実用に乗らない。
  greedy quasi-clique は近似だが、本ツールは recall 優先 + 下流に判断委ねる方針なので
  「群を取りこぼす方が、無駄に大きな群を出すよりマシ」という基準で許容。
- **density 閾値を 1.0 (= 完全クリーク) にしない**: クリーク要求は厳しすぎる。
  `(A,B)` `(B,C)` が両方 combined ≥ 0.7 でも `(A,C)` が 0.55 で
  `thresholds.combined = 0.30` を超えて報告ペアに入っているような場合、`{A,B,C}` を
  群として扱う方が情報量が高い。`minDensity = 0.6` は経験則で、実評価で調整する。
- **member 拡張を Step 2 では入れない**: clone group の core を先に確定させてから、後続で
  「core に弱く繋がるラッパー的ノード」をどう扱うかを検討する。Step 2 では群定義を
  「core クラスタ」に限定して挙動を観察可能にしておく。
- **PR モードに graph cluster を適用しない理由**: PR モードでは「変更側 = 1 ノード、base 側
  = N ノード、changed と各 base の間にエッジしかない」スター構造になり、density は常に
  1.0 (各 base が anchor と接続するだけ) または 0 に近い (base 同士の関係は索引引きしていない)。
  graph cluster を回しても anchor pivot と同じ結果しか出ない。Step 1 の pivot で十分。

## 変更ファイル

### 新規

- `src/report/clusterPairs.ts`
  - `export function clusterPairs(pairs: ScoredPair[], config: Config["report"]["cluster"]): Cluster[]`
  - `Cluster = { fragments: Fragment[]; edges: Map<string, ScoredPair> }` を返す純関数。
  - エッジ pruning → CC → quasi-clique 抽出 → 群内 collapse の順で実装。
- `src/report/clusterPairs.test.ts`
  - 単純三角形 `{A,B,C}` (全エッジ閾値超え) → 1 cluster, size 3。
  - 鎖 `A-B-C-D` (`(A,C)` `(B,D)` 閾値割れ) → density 不足で `{A,B}` `{C,D}` の 2 cluster
    or `{A,B,C}` を抽出して `D` を捨てる、を密度設定で確認。
  - 同一 fragmentId が異なるエッジに登場する正常系。
  - エッジが threshold-based のみ → cluster 形成されない。
  - cross-granularity な 5 ノード (function / block / window) → collapse 後 1 cluster, size 1
    か、あるいは別 file の同型と合わせて 2 cluster, size 2。
  - 決定性: 同じ入力に対して 2 回呼んで bit-identical な cluster 配列。
- `src/report/internal/quasiClique.ts`
  - greedy quasi-clique 抽出のヘルパー (`extractQuasiClique(nodes, edges, minDensity)`)。
  - 純関数。`clusterPairs.ts` から呼ぶ。
- `src/report/internal/quasiClique.test.ts`
  - density = 1.0 → 完全クリークだけ。
  - density = 0.5 → 半数のエッジで成立する集合まで。
  - 同点タイブレーカの確認。
- `src/report/buildCloneGroupsFromClusters.ts`
  - `export function buildCloneGroupsFromClusters(clusters: Cluster[], pairs: ScoredPair[], config: Config): CloneGroup[]`
  - 各 cluster → `CloneGroup`。anchor 無し。`members` は fragmentId 昇順。
  - aggregateScores は全 cluster 内ペアから min/median/max。
  - sharedEvidence は全ペアの `intersections` を畳み込む (`intersectIntersections`)。
- `src/report/buildCloneGroupsFromClusters.test.ts`
  - 3 ノードクラスタの aggregate / sharedEvidence / 決定性を検証。

### 変更

- `src/domain/cloneGroup.ts`
  - `anchor` は既に Step 1 で `optional` 化されている。変更なし。
  - 群 size = anchor 有無に依存せず `members.length` (PR モードでは anchor + members だが、
    Step 2 での再定義: **すべての member を `members` に入れる**)。
  - schema の整合: PR モードの群も Step 2 完了後は「anchor: changedFragment, members: [base...]」
    のままでも OK だが、whole-repo の群と表現が分岐する。本計画では分岐は許容し、コメントで
    「PR では anchor 必須、whole-repo では anchor なし」を明記する。
- `src/config/config.ts`
  - `report.cluster: { minEdgeCombined: number; minDensity: number; enabled: boolean }`
    を追加。既定: `enabled: true`, `minEdgeCombined: 0.30` (= `thresholds.combined`),
    `minDensity: 0.6`。
- `src/config/index.ts`
  - 上記を re-export。
- `src/report/jsonReport.ts`
  - `input.summary.mode === "whole-repo"` のときに `clusterPairs` →
    `buildCloneGroupsFromClusters` を回す。それ以外 (PR モード) は Step 1 の
    `buildCloneGroups` (pivot) を使う。分岐は `jsonReport.ts` の最後のステップに集約する。
  - perfLog の `report.summary` に
    `cluster: { components: number; clusters: number; droppedByDensity: number }` を追加。
- `src/report/markdownReport.ts`
  - whole-repo の group は anchor が無いので、見出しを「Cluster #i (size N)」に変える。
  - aggregateScores と sharedEvidence の表示は PR モードと共通。
- `src/cli/perfLogEvents.ts`
  - `report.summary` の `cluster` payload を型に追加。

### 既存テストの更新

- `src/report/jsonReport.test.ts`
  - whole-repo モードで `{A,B,C}` の三つ組を含む fixture を追加。
  - 鎖伝播ケース (`{A-B-C-D}` で `(A,D)` 閾値割れ) → 2 cluster に分割される、を assert。
- `src/cli/runWholeRepoDetector.test.ts`
  - 出力が pivot ベースから cluster ベースに変わったことを反映。
- `test/suiteDeterminism.test.ts`
  - whole-repo モードで cluster 出力が決定的であることを assert (大規模 fixture で 2 回実行 →
    JSON 一致)。

### 削除

なし (Step 1 で導入した型・関数を再利用)。

## 実リポジトリ検証 (Done 条件)

`docs/eval/eval-vs-jscpd.md` の評価コマンドと同じ条件で `private-eval-repo` に対して
whole-repo モードを実行する:

| メトリクス | 取得方法 | 合格条件 |
| --- | --- | --- |
| 群サイズ分布 | `jq '.groups \| map(.size) \| group_by(.) \| map({size: .[0], count: length})'` | size 3+ の群が **複数件出る** こと (現状 0) |
| top-10 群の平均サイズ | `jq '.groups[:10] \| map(.size) \| add / length'` | **>= 2.5** (= 何らかのクラスタ化が機能していること) |
| 鎖伝播チェック (定性) | top-10 群の各 member 間の pairwise combined を全て確認 | 全ペアが `>= minDensity` を満たすか、density が `minDensity` を超える |
| 決定性 | 同じコマンドで 2 回実行 → JSON diff | **空 diff** |
| Step 1 で観測できた既存 TP の維持 | `docs/eval/eval-top15.txt` (Step 1 で導入) と top-15 を比較 | 既存 TP がほぼ維持される (= cluster 化で消失していない) |

加えて、`docs/eval/` 配下に `whole-repo-clusters.md` を新規追加し、上記 5 メトリクスを
表で残しておく (将来の改修時の比較用)。

## 受け入れ基準

- [ ] 追加・修正したユニットテストがすべて通る。
- [ ] `pnpm typecheck` / `pnpm test` / `pnpm lint` が通る。
- [ ] 三角形 `{A,B,C}` を含む合成 fixture で、whole-repo レポートに `size: 3` の群が **1 件**
      だけ出る (= pivot 由来の冗長な 3 群が出ない)。
- [ ] 鎖伝播ケース (`(A,B)` `(B,C)` 閾値超え, `(A,C)` 閾値割れ) で density が満たない場合、
      `{A,B,C}` ではなく `{A,B}` と `{B,C}` が **別 cluster** として出ること (or 設定によって
      `{A,B,C}` を許容する場合は density 監査で説明可能であること)。
- [ ] 決定性: `suiteDeterminism` が whole-repo モードでも通る。
- [ ] 実リポジトリ検証 (上記) で **5 メトリクス全て合格**。

## Out of scope

- **Member 拡張 (weak-member の付加)**: 「core に弱く接続する thin wrapper 的ノードを
  hint 付きで取り込む」。Step 2 では core 群のみ。
- **Step 1 の `changedFragment.id` pivot を whole-repo にも適用するハイブリッド**:
  両方式併走で出力を比較する評価モード等。今回は graph cluster 一本に絞る。
- **群間関係の表現**: 「クラスタ A とクラスタ B は近縁」のような meta グラフ。価値が確認
  できてから検討。
- **PR モードへの graph cluster 適用**: PR モードでは pivot で十分 (Approach 参照)。
- **MinHash/LSH によるネイティブ群検出への置き換え**: 既存 LSH 経路は候補生成段で動いている。
  Step 2 はあくまで「scoring 後 pair 集合のクラスタ化」で、LSH を群検出器に昇格させる話とは
  別レイヤ。
- **`capPerFragmentPairs` の cluster 単位化**: 今は pair 単位。実評価で cluster あたりの
  member 数が爆発するようなら別計画で対応する。

## 想定リスク

- **`minDensity` の妥当性**: 既定 0.6 は経験則。本リポでの評価結果に応じて
  0.5 / 0.7 へ寄せる。Done 条件のメトリクスで観察。
- **greedy quasi-clique の局所最適**: seed 選択によって最終 cluster が変わる可能性がある。
  決定的タイブレーカを入れているので「同じ入力なら同じ結果」は担保される。「真に最適な
  cluster を取れているか」は別問題で、recall 優先方針なので許容。
- **群サイズ爆発**: 10 ノードの quasi-clique は内部に 45 ペア。aggregateScores と
  sharedEvidence の計算量は $O(n^2)$ で、極端な巨大クラスタが出ると重い。
  `config.report.cluster.maxClusterSize` (既定 50) で防御的に上限を入れる。
- **collapsePairs と群内 collapse の重複/抜け漏れ**: pair 段で `(changedFile, baseFile)`
  バケット collapse が走った後の cluster 段で再度 collapse する。同一論理を 2 回適用する形に
  なるが、対象が異なる (pair 段は 2 file 間、cluster 段は cluster 内の全 fragment)。テストで
  両ケースを明示的に固定する。
- **threshold-based エッジを群形成から外すことで recall が落ちる**: 「軸単独で滑り込んだ
  弱いマッチ」を群の glue から外す方針なので、本来クラスタになるべきものが孤立 pair として
  残るケースが出る。Step 1 の `groups` schema には pair (size 2 group) として変わらず載るので
  情報は失われない。
