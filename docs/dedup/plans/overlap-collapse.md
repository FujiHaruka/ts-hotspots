# 候補の重なり畳み込み (overlap collapse)

M7 実装後に顕在化したノイズ源 (粒度横断で同一 clone が複数レポートされる問題) を
潰すための追加作業の計画。

## コンテキスト

M7 のスモーク (head に関数 1 件を新規追加しただけの PR) で、候補が 4 件出た:

- function↔function
- block↔block (内側の `if`)
- function↔block (粒度違いの交差)
- block↔function (反対側の粒度違い)

概念的には 1 件の重複。M1 が function / block / window の 3 粒度で fragment を
出すため、1 clone が cross-granularity で複数ペアに展開される。coding agent には
「1 件の重複に対する 4 件の発見」に見え、脳内で畳み直すコストを強いる。

`recommendationHint.riskFlags` は deprioritize のシグナルでしかなく、dedupe には
ならない。レポート段階で「大きいペアが小さいペアを両側で包含している」場合、
小さい方を落とす機構が要る。

milestones.md では M8 (決定性・性能・チューニング) の範疇だが、実コードで
ノイズが出ていることが確認済なのでこのタイミングで切り出して実装する。

## Approach

### 畳み込み条件

ペア P_sub が P_super に畳み込まれるのは次をすべて満たす時:

1. P_sub と P_super が **同一 `(changedFilePath, baseFilePath)` グループ** に属する。
2. `P_super.changedFragment` の行範囲が `P_sub.changedFragment` を **inclusive に包含**する
   (`startLine ≤ && endLine ≥`)。
3. `P_super.baseFragment` の行範囲が `P_sub.baseFragment` を **inclusive に包含**する。
4. P_super ≠ P_sub (同一ペアは除外)。

両側で同時に包含される時だけ畳む。片側だけの包含は別箇所の重複を示唆する可能性が
あり、recall 優先で残す。

### 何を残すか

**大きいペア (super) を残す**。理由:

- coding agent が扱う refactor の単位は多くの場合 function-level。
- 大きい方が閾値を通っている時点で「その範囲全体が clone」の signal は含まれている。
- 小さい方のスコアだけが高く大きい方が薄まって閾値未満 → そもそも `shouldReport` で
  落ちて report されない。つまり「両方採用済 × 包含関係」の時、大きい方の signal は
  十分信頼できる、と扱ってよい。

小さい方を残す派・スコア差で決める派は M8 の fixture チューニングで必要なら切替え可能
にする。まずは単純な「大きい方を残す」で入れる。

### 同値範囲の tie-break

changed/base 範囲が完全一致で kind が違う時:

- kind 優先度: `function` > `block` > `window`
- 同 kind なら `fragment.id` 昇順で残す方を決める

決定性を崩さないため明示的に規定する。

### アルゴリズム

```
collapsePairs(pairs):
  1. (changedFile, baseFile) でグルーピング
  2. 各グループ内で「changed 範囲幅 + base 範囲幅」降順にソート
     (tie-break: kind 優先度 → fragment.id)
  3. 先頭から舐めて、各 P について既に keep 済の K に両側包含されていれば skip、
     なければ keep
  4. 全グループの keep を連結して返す
```

計算量はグループ内 O(n^2)。同一 (changedFile, baseFile) の候補数は `maxCandidatesPerFragment`
と changed fragment 件数の積で頭打ちなので実用上問題なし。

### 差し込み位置

- 新規 `src/report/collapsePairs.ts`。
- `buildJsonReport` (src/report/jsonReport.ts) の現行順序は **dedupe → sort** なので、
  dedupe の後・sort の前に collapse を挟む。
- v1 では常に有効 (config flag は入れない)。方針変更が必要になった時点で追加する。

### 決定性

- グルーピングのキー: `${changedFilePath}|${baseFilePath}` (`\0` 区切りでも可、path に
  `|` が来ないため `|` で十分)。
- グループ列挙順もソートして固定する (将来 Map 反復順に依存しないように)。
- `Set` の反復は使わない。

## 成果物

```
src/report/
  collapsePairs.ts          # collapsePairs(pairs) → ScoredPair[]
  collapsePairs.test.ts
  jsonReport.ts             # 呼び出し差し込み
  index.ts                  # バレル更新
```

### API

```ts
// src/report/collapsePairs.ts
import type { ScoredPair } from "./jsonReport.ts";

export function collapsePairs(pairs: readonly ScoredPair[]): ScoredPair[];
```

## テスト

### unit: src/report/collapsePairs.test.ts

1. **function 内包 block**: function↔function と内側 block↔block → function のみ残る。
2. **3 段ネスト** (function ⊃ block ⊃ window、全て同じ file ペア) → function のみ。
3. **片側だけ包含** (changed は包含、base は非包含) → 両方残る。
4. **異なる (changed, base) ファイルペア** → 互いに畳まれない。
5. **完全同一範囲・異なる kind** → 優先度により function を残す。
6. **空入力** → 空配列。
7. **決定性**: 同一入力 2 回で `JSON.stringify` 完全一致。

### 既存テストの更新

- `jsonReport.test.ts`: 意図的に重ねた入力を使っているテストがあれば件数が減る。
  該当箇所は入力を非包含ケースに調整するか、期待値を collapse 後の件数に更新する。

### E2E / スモーク

- `src/cli/runDetector.test.ts` の copy-pasted function ケース: 候補数の減少を期待値として
  明示 (具体件数は実測して更新)。
- `test/e2e/functionCopy.test.ts`: function-level のペアが残り、より細かい block / window
  ペアが消えていることを確認するアサートを追加。
- `test/e2e/windowCopy.test.ts`: shell (外側 function) が似ていないケースなので
  function-level は閾値未満 → window 系 1 件だけ残る (変化なし、回帰確認)。
- 手動スモーク (M7 で行った `dist/index.js` 実行) を再実施し、4 → 1 or 2 への減少を
  確認する。

## 受け入れ基準

- [ ] unit テストが全て通る。
- [ ] 既存 E2E (functionCopy / renameCopy / windowCopy) が pass し、期待ペアが残る。
- [ ] M7 スモーク repo で候補数が顕著に減る (期待: 4 → 1)。
- [ ] `pnpm typecheck` / `pnpm test` / `pnpm lint` / `pnpm build` が通る。
- [ ] 決定性: 同一入力 → 同一 JSON。

## 依存

M6 (Report Generator) と M7 (パイプライン結線)。

## リスク / 留意点

- **小さい方を優先したくなるケース**: 外側は薄まってスコアが低く、内側だけがクリアな
  clone の時、情報損失の可能性がある。ただし外側も `shouldReport` を通った前提の
  包含関係なので実害は小さい見込み。fixture でノイズ/取りこぼしが見つかれば M8 で
  方針変更 (「小さい方を残す」or 「スコア差 >= X の時は小さい方も残す」)。
- **計算量**: 実 PR で同一ファイルペアに数百候補が来るケースは少ないはずだが、もし
  ボトルネック化すれば interval tree などへの置換を M8 で検討。
- **kind 優先度**: `function > block > window` は経験則。fixture で裏切られれば見直す。
- **base 側 fragment の行範囲**: head の行番号とは独立だが、同一 base file 内での比較なので
  整合する。hunk との交差判定は入らない。
- **既存テストへの波及**: 既存の report / jsonReport テストは collapse 済を期待する
  形に変わる。テストケースを見直す。
