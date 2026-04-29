# 7. レポート後処理

`shouldReport` を通ったペアの集合をそのまま並べると、複数粒度フラグメンテーション由来のノイズが多い。レポート段階で複数の後処理を順に適用したのち、最終出力単位である **クローン群 (`CloneGroup`)** に集約する。実装は `src/report/jsonReport.ts` の `buildJsonReport` と、最終段の `src/report/buildCloneGroups.ts` (PR モード) / `src/report/clusterPairs.ts` + `src/report/buildCloneGroupsFromClusters.ts` (Whole-repo モード)。

パイプラインは以下の順:

```
unique → dropLowSemanticEvidence → collapsePairs → dropThinWrapperPairs
       → sortCandidates → capPerFragmentPairs
  → [PR モード]      buildCloneGroups (changedFragment.id pivot)
  → [Whole-repo]     clusterPairs → buildCloneGroupsFromClusters
```

なお、**両側が同じファイルで行範囲が交わるペア** は §4.2 の検索段で既に除外されているため、この段では扱わない。

## 7.1 (changed, base) ペア重複の防御的除去

同一 `(changedFragmentId, baseFragmentId)` の重複を除く。上流で発生しない想定だが、合流地点の防御策として置いている。

## 7.2 cross-granularity collapse

`collapsePairs.ts`。

別ファイル間でも、関数 fragment と、その関数本体の中の window / block fragment が、**同じ別ファイルの fragment** とそれぞれペアを作るとき、ペアが大量に重複する。論理的には 1 個のクローンを 3 通り (function vs function、function vs window、window vs window …) で報告するだけで価値が薄い。

- バケット化: `(changedFile, baseFile)` 単位でペアを束ねる。
- 各バケットを **(両側合計の行数) 降順 → (changed 側の kind 優先順位) → (base 側の kind 優先順位) → id 昇順** で並べ替える (kind の優先度は function > block > window)。
- 先頭から 1 つずつ取り出し、すでに採用したペアのいずれかが **両側ともに行範囲を内包する** なら捨てる。それ以外は採用。
- 結果として「1 つのクローン箇所 = 1 つの最大の包含ペア」が残る。

片側内包だけのケースは残す: changed 側は同じだが、base 側は無関係な別箇所を指している、というのは別のクローンを意味する。

## 7.3 ペアのランキングと cap

`ranking.ts` / `capPerFragmentPairs.ts`。続く group 集約のために、ペア集合をまず決定的に並べ替えてから 1 fragment あたりの associates を上限で絞る。

ペア順:

1. `combined` 降順
2. `max(tokenOverlap, statementKindSimilarity, callOverlap)` 降順 (1 軸でも強いペアを優先)
3. `changedFragment.id` 昇順 (lex)
4. `baseFragment.id` 昇順 (lex)

これにより同一スコアのタイブレーカも完全に決定的。`capPerFragmentPairs` は head の hot file ヘッダーや小さな構造ブロックが大量の弱い相手を引き連れるのを防ぐ。

## 7.4 evidence と per-pair recommendationHint

各ペアごとに以下を組み立て、後段の group 化で member 側に保持する。

- `evidence`: `intersections` (§5.3) を `CALL:` / `AWAIT_CALL:` / `NEW:` → `sharedCalls`、`PROP:` → `sharedProperties` に振り分け、token n-gram は先頭 `tokenNgramSampleSize` 件をサンプル化する。プレフィクスを剥がして人間にも読める形にする。
- `recommendationHint` (`recommendationHint.ts`):
  - `confidence`: `combined` 値で `high` (>=0.7) / `medium` (>=0.4) / `low` の 3 段階。
  - `likelyRefactoring`:
    - `extract-function`: token >= 0.7 ∧ statement >= 0.7 ∧ size >= 0.6
    - `parameterize`: call >= 0.5 ∧ statement >= 0.5
    - 上記に当てはまらない場合: `manual-review`
  - `riskFlags`: `size-mismatch` (サイズ比 < 1/3) / `low-semantic-evidence` (共有 call も property も無い) / `threshold-based` (§6 参照) / `same-file` (両側同ファイル) / `thin-wrapper-side` (XOR で片側のみ thin)。アルファベット順にソート。

## 7.5 PR モードのクローン群 (`CloneGroup`) への集約

`buildCloneGroups.ts`。PR モードでは最終段で残ったペアを `changedFragment.id` でグルーピングし、レポートの最終単位 `CloneGroup` を組み立てる。1 つの「変更箇所」と、それに似た base 側の N 箇所が 1 群にまとまる。

各群の構造:

- `anchor`: 群の起点 = 変更側 fragment。
- `members`: anchor とペアを成した base 側 fragment の配列。各 member は `fragment` (位置・種別・ソース) / `scores` (ペアレベル 6 軸) / `evidence` (ペアレベル) を保持する。
- `size`: anchor + members の合計数 (= 1 + members.length)。
- `aggregateScores`: 群内の全 member について `combined` / `tokenOverlap` / `statementKindSimilarity` / `callOverlap` の `min` / `median` / `max` を集計。偶数 N の median は中央 2 値の平均。
- `sharedEvidence`: 全 member ペアの `intersections` を昇順 2-pointer で逐次交差させ、「群全員に共有されているキーだけ」残した evidence。
- `recommendationHint`: 群レベルの推奨。**最弱メンバ基準**で `deriveHint` を呼ぶ。「群全体に refactor を提案するなら最も似ていない member まで含めて成立すべき」というポリシー。`changedIsThinWrapper` は anchor の thin 判定、`baseIsThinWrapper` は member 側のいずれかが thin なら true、で OR 集約する。

member 順:

1. `combined` 降順
2. `baseFragment.id` 昇順 (lex)

群順:

1. `aggregateScores.combined.max` 降順
2. `members.length` 降順 (大きな群を上に)
3. `anchor` の fragmentId 昇順 (lex)

群サイズが 1 (anchor だけ) の出力は無い: `shouldReport` を通ったペアは最低 1 件の base member を持つので、群は最小でも `size = 2`。

## 7.6 Whole-repo モードのグラフクラスタ集約

Whole-repo モードでは「変更側 / base 側」の区別が無く、同じクラスタ `{A, B, C}` を anchor pivot で表現すると `(A→{B,C})` `(B→{A,C})` `(C→{A,B})` の 3 群が冗長に並ぶ。実装はペア集合をエッジ・fragment をノードとする無向グラフに変換し、十分密な部分集合だけを 1 つのクローン群として抽出する: `src/report/clusterPairs.ts` + `src/report/buildCloneGroupsFromClusters.ts`。

手順:

1. **エッジ pruning**: ペアのうち `combined < config.report.cluster.minEdgeCombined` (既定 `0.30`) のものは群形成エッジに使わない。`riskFlags: ["threshold-based"]` 相当 (combined < 0.3 で軸 OR 単独で滑り込んだ弱マッチ) は閾値で同時に弾かれる。
2. **連結成分**: 残ったエッジで連結成分 (CC) を取る。BFS は隣接リスト (=入力ペアの追加順) に従う。
3. **密度ゲート**: `density = edges / (n*(n-1)/2)` を算出。`density >= config.report.cluster.minDensity` (既定 `0.6`) かつ `n <= maxClusterSize` (既定 `50`) ならその CC をそのまま 1 クラスタとして採用。下回るなら **greedy quasi-clique 抽出** (`internal/quasiClique.ts`) で 1 クラスタ取り出し → 残りに対して再帰。
   - 抽出のシード: CC 内 degree 降順 → fragmentId 昇順。
   - シードの隣接ノードを「シードへの辺重み (`combined`) 降順 → fragmentId 昇順」で並べ、cluster ∪ {v} の密度が `minDensity` を維持するなら追加する貪欲ループ。
4. **群内 cross-granularity collapse**: クラスタ内のノードを `(行数) 降順 → kind 優先 (function > block > window) → fragmentId 昇順` で並べ、採用済みのいずれかと同じ filePath で行範囲完全包含なら捨てる。`collapsePairs` (§7.2) を pair バケット単位ではなくクラスタ単位に拡張したもの。
5. **CloneGroup への変換**: 各クラスタを `CloneGroup` に変換。`anchor` は `undefined`、`members` は確定ノードを fragmentId 昇順で並べる。`size` は `members.length` (anchor を含まない)。`aggregateScores` / `sharedEvidence` / `recommendationHint` は PR モードと同じく群内の全ペアから集計し、`recommendationHint` は最弱ペア基準で `deriveHint` を呼ぶ。`changedIsThinWrapper` / `baseIsThinWrapper` はクラスタ内のいずれかの member が thin なら両方 true で OR 集約 (Whole-repo に方向性は無いため)。

per-member の `scores` / `evidence` は「クラスタ内でその member が最も強くペアしている相手」のスコア / evidence を採る (タイブレーカは partner id 昇順)。これにより member 単位の代表値が決定的に決まり、cluster 全体の俯瞰は `aggregateScores` / `sharedEvidence` が担う。

群順:

1. `aggregateScores.combined.max` 降順
2. `size` 降順
3. クラスタ先頭 (= 最小 fragmentId) 昇順 (lex)

設計判断:

- **完全クリーク (`density = 1.0`) は要求しない**: `(A,B)` `(B,C)` が両方 combined ≥ 0.7 でも `(A,C)` が 0.55 で `thresholds.combined = 0.3` を超えて報告ペアに入っているとき、`{A,B,C}` を群として扱う方が情報量が高い。`minDensity = 0.6` は経験則。
- **MaxClique にしない**: 厳密 MaxClique は NP-hard。greedy quasi-clique は近似だが、本ツールは recall 優先で下流に判断委ねる方針。「群を取りこぼす方が、無駄に大きな群を出すよりマシ」を許容。
- **PR モードに graph cluster を適用しない**: PR モードは「変更側 = 1 ノード、base 側 = N ノード、changed と各 base にしかエッジが無い」スター構造なので、cluster の結果は anchor pivot と同じ。Step 1 の pivot で十分。
- **`maxClusterSize` 上限**: `aggregateScores` / `sharedEvidence` の計算量は $O(n^2)$。極端な巨大クラスタが出てもレポートが過剰に重くならないよう、`maxClusterSize` (既定 `50`) で防御的に上限を入れる。超えた場合は quasi-clique 抽出のステップで分割される。
