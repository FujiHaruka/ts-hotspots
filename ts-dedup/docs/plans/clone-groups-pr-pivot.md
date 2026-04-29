# クローン群の出力 (Step 1): PR モードの pivot 集約

## 背景

ts-dedup のレポートは現在、変更ペア `(changedFragment, baseFragment)` の配列
(`candidates: ReportCandidate[]`) を出している。だが Type-3 重複検出の本来の関心事は
「同じパターンが何箇所に出ているか」であり、ペア表現のままでは:

- 1 つの `changedFragment` が base 側で N 箇所に重複しているとき、N 個の独立 pair として並ぶ。
  「変更したコードが N 箇所にコピペで存在する」という本質的な情報が散らばる。
- 下流の coding agent / レビュアーが「3 箇所以上に出ている強いシグナル」を識別しにくい。

PR モードに限れば、必要なデータは既にパイプライン内に揃っている: `searchCandidates` →
`shouldReport` を通過した pair 集合を `changedFragment.id` でグループ化すれば、それが
そのまま「変更パターンと、そのパターンに合致する base 側の N 箇所」を表す clone group に
なる。

本計画はその pivot 集約をレポート段に追加し、出力を pair から group ベースに切り替える。
Whole-repo モードでの真の多重度検出 (グラフクラスタリング) は別計画
[`clone-groups-whole-repo-clusters.md`](./clone-groups-whole-repo-clusters.md) で扱う。

関連: [docs/algorithms.md](../algorithms.md) §7 (レポート後処理), §6 (報告判定)。

## Approach

**レポート段の最終アセンブル直前で、`ScoredPair[]` を `changedFragment.id` ごとに groupBy
し、`CloneGroup[]` として出力する。** scoring・候補検索・collapse・cap 等の上流ステージは
無改変。schema は backward compat を考慮せず、`candidates: ReportCandidate[]` を
`groups: CloneGroup[]` に置き換える (CLAUDE.md「ignore backward compatibility」)。

群の構造:

- **anchor**: PR モードでは `changedFragment` を anchor として保持する (whole-repo モードの
  Step 2 で `undefined` も許す形に拡張する前提で `optional` 型にしておく)。
- **members**: `baseFragment` × ペアごとのスコア × ペアごとの evidence の配列。最低 1 件。
- **size**: anchor + members 数 (= 1 + members.length)。
- **aggregateScores**: members を全部スキャンして combined / tokenOverlap / statementKindSimilarity
  / callOverlap の `min` / `median` / `max` を集計。
- **sharedEvidence**: 全 pair の `intersections` を `intersect` した結果。「群の全メンバが
  共有しているシグナル」だけが残る。これが空 (= 全員に共通する強い根拠が無い) なら、群レベルの
  recommendationHint を `manual-review` に倒す材料になる。
- **recommendationHint**: 群の **最弱メンバ基準** (= aggregateScores の min) で `deriveHint` を
  呼ぶ。「群全体に refactor を提案するなら、最も似ていないメンバまで含めて成立しないと意味が
  無い」というポリシー。

ペア重複除外・低意味証拠ドロップ・cross-granularity collapse・thin-wrapper drop はすべて
**pair 段階で**従来どおり走らせる。group 化はその出力を入力として取る。これにより既存の
ノイズ抑制ロジックは流用でき、新規導入ポイントは「group 構築」と「group ranking」のみ。

groups の並び順 (要件 §5.2 の決定性):

1. `aggregateScores.combined.max` 降順
2. `members.length` 降順 (= 群サイズが大きいほど上)
3. `anchor.id` 昇順 (lex)

設計判断のメモ:

- **「群サイズ 1 の group」は出力しない**。`shouldReport` を通った pair は最低 1 つの
  baseFragment を持つので、group は最小でも `1 anchor + 1 member` で size 2。これは
  従来の単純ペアと等価で、schema 上の歪みは無い。
- **PR モードの whole-repo 同居**: 同じ `runDetector` パイプラインだが、whole-repo モードは
  Step 2 でクラスタ化する。Step 1 では whole-repo モードも `changedFragment.id` で pivot
  する暫定実装にしておく (= 1 fragment が複数群の anchor になり、`(A→{B,C})` `(B→{A,C})`
  `(C→{A,B})` のように冗長な groups が出る)。Step 2 で graph cluster に置き換える前提なので
  この冗長は許容する。CLI には warning も出さない (内部段階のため)。
- **member ペアの cross-granularity は pair 段で既に解決済み**。`collapsePairs` が
  `(changedFile, baseFile)` バケットで最大包含だけを残しているので、1 つの changedFragment が
  同じ baseFile に対して複数 base 粒度を持つことは無い。したがって 1 群の `members` は
  baseFile ごとに高々 1 件。
- **sharedEvidence 計算の効率**: 各 pair の `intersections` は既に `Intersections` 型の
  ソート済みキー配列。N 個の pair について順に `intersect` を取る ($O(N \cdot k)$、k は
  最大集合サイズ) で十分速い。fragment 単位の特徴量集合を再構築する必要は無い。

## 変更ファイル

### 新規

- `src/report/buildCloneGroups.ts`
  - `export function buildCloneGroups(pairs: ScoredPair[], config: Config): CloneGroup[]`
  - 入力 pair 配列を `changedFragment.id` で groupBy し、各群の `aggregateScores` /
    `sharedEvidence` / `recommendationHint` を構築する純関数。
  - 群の並び順 (上記) を内部で確定。
- `src/report/buildCloneGroups.test.ts`
  - 単一 pair → size 2 group。
  - 同 anchor の 3 pair → size 4 group、members は base 側 evidence/score でソート (combined 降順 → id 昇順)。
  - 異なる anchor の pair が混在 → 異なる group が複数。
  - sharedEvidence: 全員に共通するキーだけが残ること。
  - aggregateScores: min/median/max が正しいこと。
  - 偶数 N の median: 中央 2 値の平均で良い (集計目的のため)。
- `src/report/internal/intersectIntersections.ts`
  - `Intersections` 配列を 2 個ずつ畳み込んで「全 pair で共有された交差キー」だけを返す。
  - ソート済みキー配列同士の交差なので 2 ポインタ法で線形時間。
- `src/report/internal/intersectIntersections.test.ts`
  - 通常ケース、空 pair 配列 (空集合返却)、1 pair (そのまま返却)、片方空、ぶつからない 2 集合。
- `src/domain/cloneGroup.ts` (`src/domain/index.ts` で re-export)
  - 下記 schema 型を定義。

```ts
export interface FragmentView {
  filePath: string;
  startLine: number;
  endLine: number;
  kind: string;
  code?: string; // includeCode=false で省略
}

export interface GroupMember {
  fragment: FragmentView;
  /** anchor とこの member の間のペアレベルスコア。 */
  scores: {
    combined: number;
    tokenOverlap: number;
    statementKindSimilarity: number;
    callOverlap: number;
    sizeCompatibility: number;
    lengthScore: number;
  };
  /** anchor とこの member の間のペアレベル根拠。 */
  evidence: Evidence;
}

export interface AggregateScores {
  combined: { min: number; median: number; max: number };
  tokenOverlap: { min: number; median: number; max: number };
  statementKindSimilarity: { min: number; median: number; max: number };
  callOverlap: { min: number; median: number; max: number };
}

export interface CloneGroup {
  /** Stable id: `g-` + zero-padded index in deterministic group order. */
  groupId: string;
  /**
   * PR モードでは変更側 fragment。Whole-repo の Step 2 では undefined に
   * なる可能性があるため optional。
   */
  anchor?: FragmentView;
  /** anchor 以外のメンバ。最低 1 件。 */
  members: GroupMember[];
  /** anchor + members の総数。 */
  size: number;
  aggregateScores: AggregateScores;
  /** 全 member が共有しているキーだけ残した evidence。 */
  sharedEvidence: Evidence;
  /** 群全体に対する推奨 (最弱ペア基準で計算)。 */
  recommendationHint: RecommendationHint;
}
```

### 変更

- `src/domain/report.ts`
  - `CloneCandidateReport.candidates: ReportCandidate[]` を
    `groups: CloneGroup[]` に置き換える。
  - `ReportCandidate` 型は内部で再利用しないなら削除 (Markdown レポーター等が直接使っていないか確認)。
  - `pipeline` summary: `reportedPairs` はそのまま残し、`reportedGroups` を追加 (= groups.length)。
- `src/report/jsonReport.ts`
  - 既存パイプラインを変更:
    `unique → dropLowSemanticEvidence → collapsePairs → dropThinWrapperPairs → sortCandidates → capPerFragmentPairs → buildCloneGroups`
    最後に `buildCloneGroups` を追加。`toReportCandidate` は廃止し、group 構築側で
    `fragmentView` を組む。
  - `perfLog.emit("report.summary", ...)` に `reportedGroups` を追加。
  - `getSourceFile` は引き続き `buildThinWrapperMap` 経由で thin wrapper 判定に使う (変更なし)。
- `src/report/markdownReport.ts`
  - groups ベースに書き換え。各 group を 1 セクションで表示し、anchor を見出し、members を
    リストにする。aggregateScores と sharedEvidence をブロックで添える。
  - サンプル出力を test に固定する (markdownReport.test.ts)。
- `src/report/recommendationHint.ts`
  - `deriveHint` の引数は変更なし。ただし group 構築側からは「最弱ペア」(aggregateScores の
    min)の score で呼ぶ。`changedIsThinWrapper` / `baseIsThinWrapper` は anchor / 任意の
    member について 1 つでも thin なら true、というポリシーで集約 (`reduce(or)`)。
- `src/cli/runDetector.ts` / `src/cli/runWholeRepoDetector.ts`
  - `CloneCandidateReport.candidates` を参照している箇所 (CLI 出力件数の計算など) を
    `groups` に切り替え。`reportedPairs` は summary に残るので件数表示は併記可能。
- `src/cli/main.ts`
  - 表示する件数 (`Found N candidates`) を `Found N groups (M pairs across them)` に変更。
- `src/report/index.ts`
  - `buildCloneGroups` を re-export。
- `src/cli/perfLogEvents.ts`
  - `report.summary` イベントの payload 型に `reportedGroups: number` を追加。

### 既存テストの更新

- `src/report/jsonReport.test.ts`
  - `candidates` を期待していたアサーションを `groups` に書き換え。
  - 既存テストの fixtures は単一 pair が多いので、ほぼ size 2 group になる想定。
  - 「同じ changedFragment が複数 baseFragment にマッチする scenario」を新規追加し、
    1 つの group に複数 members が入ることを検証。
- `src/report/markdownReport.test.ts`
  - 出力フォーマットの snapshot を groups ベースで更新。
- `src/cli/runDetector.test.ts` / `src/cli/runWholeRepoDetector.test.ts`
  - レポート構造アサーションを更新。
- `src/cli/main.test.ts`
  - 出力文字列の期待値を更新。
- `test/suiteDeterminism.test.ts`
  - 群の並び順も決定的であること (2 回実行して JSON 一致) を確認。

### 削除

- `src/domain/report.ts` の `ReportCandidate` (groups schema に置き換え) — 他で参照されていなければ。

## テスト計画

1. **新規ユニットテスト** (上記)。
2. **`pnpm test` フル**。決定性スイートが落ちないこと。
3. **CLI smoke**: `pnpm build && node dist/index.js --revrange ...` で実 PR を 1 つ走らせ、
   JSON 出力が新スキーマになっていること、`groups[].members` が期待どおりに集約されていることを目視確認。
4. **whole-repo smoke**: `--whole-repo` でも JSON が壊れないこと (Step 1 では冗長な
   groups が出る前提で、count が極端に増えていないかを観測)。

## 受け入れ基準

- [ ] 追加・修正したユニットテストがすべて通る。
- [ ] `pnpm typecheck` / `pnpm test` / `pnpm lint` が通る。
- [ ] PR モードで「同じ changedFragment が base 側 3+ 箇所にマッチする入力」を流した時、
      レポートに 1 つの group が `size >= 4` で出ること (スモーク fixture)。
- [ ] `aggregateScores.combined.max` 降順 → `members.length` 降順 → `anchor.id` 昇順 で
      groups がソートされていること。
- [ ] 同入力に対して 2 回レポートを生成して bit-identical (`suiteDeterminism`)。
- [ ] Markdown レポートが新スキーマで生成され、`docs/eval/` 配下の手元観察用に 1 件貼れること。

## Out of scope

- **Whole-repo モードの真のクラスタ化**: [`clone-groups-whole-repo-clusters.md`](./clone-groups-whole-repo-clusters.md) で扱う。
  Step 1 では whole-repo も同じ pivot ロジックを通すので、`{A,B,C}` のような三つ組は
  3 つの群として重複出力される。Step 2 でグラフ縮約する前提。
- **base 側 fragment を anchor とする pivot** (= 「PR で 1 つの base パターンが N 箇所に
  追加された」)。本計画では `changedFragment` を anchor 固定。両側 pivot は需要が確認できて
  から検討する。
- **Group 内の cross-granularity 再縮約**: pair 段の `collapsePairs` が
  `(changedFile, baseFile)` バケットで縮約済みのため Step 1 では追加不要。Step 2 では
  クラスタ全体で再評価が必要になる (別計画で扱う)。
- **CLI フラグでの group/pair 切替**: schema を完全に置き換えるので不要。
- **件数 cap の group 単位化**: `capPerFragmentPairs` は pair 段でかかったまま。group 段の
  cap が必要かは Step 2 後の運用評価で判断する。

## 想定リスク

- **既存下流 (coding agent prompt 等) との非互換**: 本リポは未公開なので無視。CLAUDE.md
  の Technical decisions に従う。
- **Markdown レポートの肥大化**: 群あたり member が多いと縦に伸びる。member は最大 N 件で
  truncate するオプションを将来追加する余地を残す (Step 1 では truncate 無し)。
- **`recommendationHint` の最弱ペア基準が悲観的すぎる**: 群サイズが大きいほど 1 つの弱い
  member で全体が `manual-review` に落ちる。実運用で頻発するなら「中央値ベース」「member
  ごと個別 hint も保持」等の選択肢を後続で検討する。Step 1 では最弱基準で固定して
  recall/precision の体感値を見る。
