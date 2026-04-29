# Thin-wrapper 検出による上位候補のノイズ削減

## 背景

`docs/eval/eval-vs-jscpd.md` の評価で、ts-dedup の whole-repo 上位 10 件のうち
**7 件**が `*-intro-dialog.tsx` の薄いラッパー (`<IntroDialog ... />` を呼ぶだけのコンポーネント) の組合せだった。

```tsx
// example: assistant-intro-dialog.tsx (35 行のうちほぼ全体)
"use client";
import { ... } from "lucide-react";
import { useTranslations } from "next-intl";
import { IntroDialog } from "./intro-dialog";

export function AssistantIntroDialog(): React.ReactElement {
  const t = useTranslations("project");
  return (
    <IntroDialog storageKey="…" title={t("…")} features={[ ... ]} />
  );
}
```

これらは **すでに共通コンポーネント `<IntroDialog>` に DRY 化済み** で、これ以上抽象化する旨味はない
(over-abstraction)。にもかかわらず ts-dedup は

- `tokenOverlap ≈ 1.0` (テンプレな import 行 + 同型 JSX)
- `statementKindSimilarity = 1.0` (`Import* × N + FunctionDeclaration` で完全一致)
- `callOverlap ≈ 1.0` (`useTranslations`, `t`, `IntroDialog` を呼ぶだけなので一致)

となり combined ≈ 0.96 を獲得して上位を占有してしまう。レポートの結論として、
`recommendationHint` レイヤで「単一の named JSX / 関数呼び出しに return するだけの fragment」を
検出して down-rank するのが top-N 体験に対してもっとも費用対効果が高い改善とされている。

## Approach

**「fragment 単体が thin wrapper か」を AST から判定する純関数を新設し、両側 thin wrapper のペアを
レポートパイプラインで除外する。** ペア単位の scoring/feature ロジックには手を入れない。

具体的には:

1. **検出ロジックは fragment 単位の純関数** (`isThinWrapperFragment(fragment, sourceFile)`) として
   `src/features/internal/` あたりに置く。`locateFragmentNode` で得られる `directStatements` を再利用し、
   "ほぼ単一の named call / JSX を return しているだけ" と読める形を `true` で返す。
2. **fragment id ごとに 1 回だけ評価** する。`buildJsonReport` のパイプライン入口で fragment id →
   `boolean` のキャッシュを構築し、ペアの両側に対してルックアップする。AST パース結果はキャッシュ済みの
   `SourceFile` を `parseSource` 経由で取得 (`buildCodebaseIndex` 側で fragment.text → SourceFile を
   解いている既存の流儀に乗る)。
3. **両側 thin wrapper のペアだけ落とす**。これは新しいフィルタ
   `dropThinWrapperPairs` をパイプラインに追加する形で実現する。挿入位置は
   `dropSameFileOverlap → dropLowSemanticEvidence → collapsePairs` の **直後** とし、
   collapse でクラスタ親が確定したあとに薄いラッパーを除く。
4. **片側のみ thin wrapper のペアは落とさない**。これはたとえば「ラッパー化された片方 ⇄ 古い手書き実装」
   のようなケースで真陽性を取りうるため。代わりに `recommendationHint.riskFlags` に `"thin-wrapper-side"`
   を載せて利用者に通知する。
5. **しきい値や on/off は config で持つ**。既定は on。後続 milestone の評価で false-negative が出たときに
   off にできるようにする (CLI フラグは出さない — config 経由)。

このアプローチにより:

- 上位 10 中 6 件 (intro-dialog クラスタ $\binom{4}{2}$) と rank 9 (workflow-runs ペア) は両側 thin wrapper
  で**消える**。
- rank 10 (`client-helpers.ts` 内の window overlap) は thin wrapper ではないので残る (これは別計画
  `overlap-collapse.md` の射程)。
- rank 1, 2, 11–16 などの真陽性は片側 thin wrapper にすらならないので影響を受けない。

## 検出ルールの詳細

`isThinWrapperFragment(fragment, sourceFile): boolean` の判定:

1. `locateFragmentNode` で `directStatements` を取得する。空なら `false`。
2. `directStatements` から **trivial prelude** (※下記) を頭から消費する。
3. 残りが **ちょうど 1 個の `ReturnStatement`** で、かつその `expression` が
   - 単一の `JsxElement` / `JsxSelfClosingElement` / `JsxFragment`、または
   - 単一の `CallExpression` (引数の中身は問わない)、または
   - 単一の `NewExpression`

   のいずれかであれば `true`。それ以外は `false`。
4. `kind === "window"` で window が `directStatements` を返している場合も同じルールを適用。
   ただし window 内の statements 数が `directStatements` 全体の閾値 (`config.report.thinWrapper.maxBodyStatements`,
   既定 4) を超えるなら `false`。

**trivial prelude** とは:

- `VariableStatement` で `declarationList.declarations.length === 1` かつ
  `initializer` が `CallExpression` 1 つだけのもの (例: `const t = useTranslations("project");`)。
- 何個でも許すと wrapper 性が薄まるため、**最大 2 個**まで許可 (config 化)。

ファイル全体長 (`fragmentLineCount`) や `astNodeKind` には依存しない。判定は内容ベース。

## 変更ファイル

### 追加

- `src/features/internal/isThinWrapper.ts`
  - `isThinWrapperFragment(fragment: Fragment, sourceFile: ts.SourceFile, config: Config["report"]["thinWrapper"]): boolean`
- `src/features/internal/isThinWrapper.test.ts`
  - 後述のテスト一式
- `src/report/dropThinWrapperPairs.ts`
  - `dropThinWrapperPairs(pairs, isThinById): ScoredPair[]` — 両側 thin wrapper のペアを除外
  - 純関数。判定マップは事前構築して渡す (パース結果に依存しない単体テストを書きたいので注入)
- `src/report/dropThinWrapperPairs.test.ts`

### 変更

- `src/config/config.ts` / `src/config/index.ts`
  - `report: { thinWrapper: { enabled: boolean; maxPreludeStatements: number; maxBodyStatements: number } }` を追加。既定:
    `enabled: true`, `maxPreludeStatements: 2`, `maxBodyStatements: 4`。
- `src/domain/report.ts`
  - `RecommendationHint.riskFlags` の値域に `"thin-wrapper-side"` を追加 (型は string[] のままなのでコメントのみ更新)。
- `src/report/recommendationHint.ts`
  - `DeriveHintArgs` に `changedIsThinWrapper: boolean`, `baseIsThinWrapper: boolean` を追加。
  - 片側だけ thin wrapper なら `riskFlags` に `"thin-wrapper-side"` を push (両側は `dropThinWrapperPairs` で
    既に消えているので push されない)。
- `src/report/jsonReport.ts`
  - 入口で fragment id → `isThinWrapper` のマップを構築する。SourceFile は
    `parseSource(filePath, text)` を fragment.text から再取得するのでなく、
    呼び出し側 (`runDetector` / `runWholeRepoDetector`) で既にキャッシュしている SourceFile を
    `ReportInput` 経由で受け取れるようにする (`getSourceFile?: (filePath) => ts.SourceFile | undefined`)。
    取れなかったら fallback で `false` 扱い (= フィルタしない、保守的)。
  - `dropThinWrapperPairs` をパイプラインに追加 (`collapsePairs` の直後、`sortCandidates` の前)。
  - `perfLog.emit("report.summary", ...)` に `dropThinWrapperPairs` の件数を追加。
  - `toReportCandidate` で `deriveHint` に thin wrapper フラグを渡す。
- `src/cli/runDetector.ts` / `src/cli/runWholeRepoDetector.ts`
  - 既存のパース結果から fragment.filePath → SourceFile のマップを `buildJsonReport` に渡す。
- `src/report/index.ts`
  - `dropThinWrapperPairs` を re-export (テスト導線の都合)。

### 既存テストの更新

- `src/report/recommendationHint.test.ts`
  - 既存の `mkFragment` ベースのテストは `changedIsThinWrapper / baseIsThinWrapper` の既定 `false` を渡す形に変更。
  - 片側 true / 両側 false / 両側 true のケースを追加。両側 true でも `deriveHint` は riskFlag を push しない
    (`dropThinWrapperPairs` がパイプラインで既に除いている前提) ことを明示するテストを書く。
- `src/report/jsonReport.test.ts`
  - thin wrapper を含む fixture を 1 つ追加し、両側 thin wrapper のペアが落ちることを検証。
  - SourceFile マップを渡さない既存テストは挙動が変わらない (= フィルタが no-op) ことを明示。

## テスト

### `isThinWrapper.test.ts`

| # | 入力 | 期待 |
| --- | --- | --- |
| 1 | `function F() { return <X />; }` | true |
| 2 | `function F() { return <X a={1} b={fn(2)} />; }` (引数が複雑な JSX) | true |
| 3 | `function F() { const t = useT("k"); return <X t={t} />; }` (prelude 1 個) | true |
| 4 | `function F() { const a = 1; const b = 2; return <X a={a} b={b} />; }` (prelude 2 個) | true (上限ぎりぎり) |
| 5 | `function F() { const a = 1; const b = 2; const c = 3; return <X />; }` (prelude 3 個) | false |
| 6 | `function F() { return foo(bar()); }` (CallExpression) | true |
| 7 | `function F() { return new Foo(); }` (NewExpression) | true |
| 8 | `function F() { if (x) return <A />; return <B />; }` (return が 2 個) | false |
| 9 | `function F() { return <><A /><B /></>; }` (Fragment 内に複数子要素) | true (Fragment 1 個自体は単一式扱い — 仕様として許容) |
| 10 | `function F() { foo(); return <X />; }` (prelude が ExpressionStatement) | false (許可するのは VariableStatement のみ) |
| 11 | window kind で statements 数が `maxBodyStatements` 超 | false |
| 12 | expression-bodied arrow `() => <X />` (directStatements 空) | false (現在の `locateFragmentNode` は arrow expression body を空として返すため。改善は別計画) |
| 13 | `function F(): JSX.Element { return; }` (return の expression が undefined) | false |

### `dropThinWrapperPairs.test.ts`

1. 両側 thin wrapper → 落ちる。
2. 片側だけ thin wrapper → 残る。
3. 両側とも thin wrapper でない → 残る。
4. 入力 0 件 → 出力 0 件。
5. 同一 fragmentId が複数ペアに登場するときに判定が再評価されない (事前マップで 1 回)。
6. `enabled: false` の config では一切落ちない (関数自体に `enabled` を渡さない場合は呼び出し側で制御するので、
   こちらは jsonReport.test.ts でカバー)。

### `recommendationHint.test.ts` 追加

- `changedIsThinWrapper: true, baseIsThinWrapper: false` → riskFlags に `"thin-wrapper-side"`。
- 両側 false → 含まれない。
- riskFlags 全部入りソート確認に `"thin-wrapper-side"` を追加した辞書順並びを expect。

### `jsonReport.test.ts` 追加

- 入力ペア (両側 thin wrapper) を含む scenario で、SourceFile マップ有り → 当該ペアが消える。
- 同 scenario で SourceFile マップ未提供 → 全ペアが残る (保守的 fallback)。
- `perfLog` 出力に `dropThinWrapperPairs` の件数が現れる。

### `eval-vs-jscpd` フィクスチャ的な smoke

可能なら `test/` 配下に小さい合成リポジトリ (intro-dialog ライクな 3 ファイル) を置いて
`runWholeRepoDetector` レベルで「上位 10 件の中に同型ラッパーペアが現れない」ことを検証。
ただしこれは acceptance 外 (任意)。

## 受け入れ基準

- [ ] 追加・修正した unit test がすべて通る。
- [ ] `pnpm typecheck` / `pnpm test` / `pnpm lint` が通る。
- [ ] `private-eval-repo` で評価コマンドを再実行したとき、上位 10 件から `*-intro-dialog.tsx` の
      pairwise 展開が消える (定性確認)。
- [ ] 上位 10 件のうち TP (rank 1 / 2 / 10) は維持される (定性確認)。
- [ ] 既定が on でも、対象フィクスチャ (`test/`) のリグレッションが発生しない。

## 非対象 (out of scope)

- **同型クラスタの pairwise 展開を 1 件に collapse する**: 別計画。本計画ではフィルタで「両側 thin wrapper」
  のみ落とすため、片側ラッパー越しの真クローンや非 JSX のクラスタには手当てしない。
- **window-overlap の強化** (rank 10 の自己重なり): `overlap-collapse.md` の射程。
- **arrow function の expression body 対応** (テスト #12): `locateFragmentNode` の拡張が必要で、変更範囲が
  広がる。今回は false で扱う (= フィルタしない側に倒す = 保守的) のままで進める。
- **CLI フラグの追加**: 必要になってから足す。config (`defaultConfig`) で既定 on。

## 想定リスク

- **保守的すぎる場合**: 両側 thin wrapper でも本当に refactor すべきケース (例: 6 ファイルが 6 通りに手書き
  していて IntroDialog 化すべきとき) を消してしまう。── 既に共通化されている前提で評価するので、
  本リポでは現実的に問題にならない。出てきたら `enabled: false` にできる。
- **誤検出 (thin wrapper 過剰判定)**: prelude 上限 2 と body return 1 で十分タイト。テスト #4/#5 が
  境界を固定する。
- **AST パース性能**: 既存の SourceFile を再利用するので追加パースは発生しない。判定自体は
  `directStatements` 走査で O(1) 相当。
