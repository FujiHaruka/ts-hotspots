# 実リポジトリでの精度比較: ts-dedup vs jscpd

対象リポジトリ: `autifyhq/genesis-v2-charlie` @ `b33bbf2`
スキャン範囲: `.jscpd.json` の `ignore` パターンを ts-dedup の `--exclude` にそのまま渡し、対象を揃える。
ts-dedup は `--whole-repo --format json --limit all --no-code` で実行。

## サマリ

| 指標 | jscpd | ts-dedup |
| --- | --- | --- |
| アルゴリズム | トークン列のハッシュ衝突 (verbatim 寄り) | トークン n-gram + statement-kind + call の特徴量 |
| トップ N サンプル | 上位 7 件を抜粋判定 | 上位 10 件を判定 |
| 真陽性 (refactor すべき) | 7 / 7 | 2 / 10 (raw) |
| 偽陽性率 (top 10) | ~0% | 70% (raw) / 約 10–20% (重複クラスタを 1 件にまとめた場合) |
| 検出された候補総数 | （ターミナルに収まる範囲のみ） | 7,265 ペア |

ts-dedup は recall を優先する設計だが、本リポジトリでは「上位 10 件のうち 7 件」という非常に目立つ位置に同一クラスタの偽陽性が固まり、見かけ上の precision を大きく下げた。原因は単純な「ノイジー特徴量」ではなく、**「すでに共通コンポーネント化されたラッパー」を window 単位で個別ペアとして報告してしまう** という構造的な弱点。詳細は後述。

## ts-dedup top 10 の判定

| # | combined | 場所 | 判定 | コメント |
| --- | --- | --- | --- | --- |
| 1 | 0.986 | `project-detail-sidebar.tsx:293-404` ↔ `:419-533` | TP | お気に入りリストと通常リストで `<ConversationItem>` 相当を別々に書いている。明確に抽出すべき。 |
| 2 | 0.977 | `spec-list.tsx:217-345` ↔ `:347-476` | TP | `renderFolderListItem` と `renderFolderGridItem` で DropdownMenu 部分が完全に重複。少なくともメニューだけでも抽出が妥当。 |
| 3 | 0.962 | `assistant-intro-dialog.tsx:1-35` ↔ `codebase-intro-dialog.tsx:1-35` | **FP** | 既に `<IntroDialog>` という共通コンポーネントを呼んでいる "薄いラッパー" 同士。これ以上抽象化する必要はない。 |
| 4 | 0.962 | `assistant` ↔ `files-intro-dialog.tsx:1-35` | **FP** | 同上 |
| 5 | 0.962 | `assistant` ↔ `workflow-list-intro-dialog.tsx:1-35` | **FP** | 同上 |
| 6 | 0.962 | `codebase` ↔ `files-intro-dialog.tsx:1-35` | **FP** | 同上 |
| 7 | 0.962 | `codebase` ↔ `workflow-list-intro-dialog.tsx:1-35` | **FP** | 同上 |
| 8 | 0.962 | `files` ↔ `workflow-list-intro-dialog.tsx:1-35` | **FP** | 同上 |
| 9 | 0.962 | `workflow-run-detail-intro-dialog.tsx` ↔ `workflow-runs-intro-dialog.tsx` | **FP** | 別クラスタだが同型 (ラッパー)。 |
| 10 | 0.945 | `client-helpers.ts:138-224` ↔ `:82-172` | TP* | `WorkflowMetadata` 定義の繰り返しは本物の重複だが、検出は同一ファイル内の **重なり合う window** ペア。`createWorkflowMeta(name, opts)` 系のヘルパー化が定石。 |

ts-dedup の上位 10 は raw で **TP=2 / FP=7 / TP*=1**。ただし FP 7 件はすべて同じ "intro-dialog ラッパー" クラスタの組合せ ($\binom{4}{2}=6$ + 別クラスタ 1)。findings として 1 件にまとめれば **distinct top 10 中 FP=1** と評価できる。

参考までに、もう一段下 (rank 11–16) にはほぼ全件 TP が並ぶ:

| # | combined | 場所 | 判定 |
| --- | --- | --- | --- |
| 11 | 0.943 | `settings/security/page.tsx` ↔ `settings/sso/page.tsx` | weak TP (layout.tsx で吸収可) |
| 12 | 0.930 | `delete-version-dialog.tsx` ↔ `restore-version-dialog.tsx` | TP (ConfirmActionDialog として抽出) |
| 13 | 0.927 | `azure-openai-provider.ts:60-77` ↔ `openai-provider.ts:27-46` | TP (`embed()` のバッチング) |
| 14 | 0.919 | `chat.ts:163-185` ↔ `:188-210` | TP (取得→アクセスチェック→update のパターン) |
| 15 | 0.917 | `workflow-template-builder.tsx:1249-1261` ↔ `:714-726` | TP (キーボードショートカットがコールバックを再実装) |
| 16 | 0.913 | `auth/server.ts:48-59` ↔ `:80-91` | borderline FP (4 行のテンプレ送信ラッパー、抽象化の旨味は薄い) |

## jscpd 上位サンプル (7 件) の判定

ユーザ提供の jscpd トップ ~20 のうち、ts-dedup と被らないものを中心に 7 件サンプリング:

| jscpd # | 場所 | 判定 |
| --- | --- | --- |
| 1 | `azure-openai-provider.ts:57-80` ↔ `google-provider.ts:22-45` | TP (ts-dedup #13 と同等の本物の重複) |
| 2 | `directory.ts:322-341` ↔ `:242-261` | TP (`computeDirectoryPath` 周りの後処理が同一) |
| 9 | `workflow-inspector.tsx:32-55` ↔ `workflow-sidebar.tsx:15-38` | TP (Props 型定義が約 30 フィールド一致、base 型を切り出すべき) |
| 11 | `inspector-conditional-tab.tsx:156-180` ↔ `inspector-details-tab.tsx:141-165` | TP (`onUpdateBlock` 内の "key 検索 or 新規追加" 同型ロジック) |
| 16 | `workflow-execution-graph.tsx:295-325` ↔ `builder-node.tsx:248-278` | TP (React Flow の `<Handle>` レンダリングが完全重複) |
| 18 | `chat-markdown-editor-inner.tsx:98-122` ↔ `workflow-prompt-bar.tsx:113-136` | TP (`useEffect` + "@ keypress でフローティングピッカーを開く" hook を抽出可) |
| 20 | `mcp-connection-wizard.tsx:609-639` ↔ `:546-576` | borderline TP (OAuth 系 FormField 群、`<CredentialField>` への抽出は妥当) |

判定: **TP=7 / FP=0**。jscpd は精度 (precision) という意味では今回サンプル中ではほぼ完全。

## なぜ ts-dedup の上位に偽陽性 (intro-dialog クラスタ) が来たのか

このクラスタの正体は次のような "config-shaped" コードである:

```tsx
"use client";
import { FileText, MessageSquare, Zap } from "lucide-react";
import { useTranslations } from "next-intl";
import { IntroDialog } from "./intro-dialog";

export function AssistantIntroDialog(): React.ReactElement {
  const t = useTranslations("project");
  return (
    <IntroDialog
      storageKey="…"
      title={t("…")}
      features={[
        { icon: …, title: t("…"), description: t("…") },
        …
      ]}
    />
  );
}
```

各ファイルは **共通コンポーネント `<IntroDialog>` を異なるデータで呼ぶラッパー**。すでに DRY 化済みで、これ以上の抽象化は (a) 表示 4 種類を1つの map と enum で潰す、ぐらいしか道がなく、可読性を悪化させる典型的な over-abstraction。

ts-dedup がここで誤検出する原因は次の 4 つが重なっているため:

1. **window kind の特徴がほぼ「ファイル全体のシルエット」になる**
   各ファイルが 35 行と短く、1–35 の window がほぼファイル全体をカバーする。短いファイルは「import 行 + named export 1 つ + JSX」だけでトークン分布が決まり、テンプレ的な "use client" + lucide-react + next-intl + IntroDialog の構成が完全に揃うため、token n-gram 距離はほぼ 0 になる。

2. **statement-kind 類似度がトップになる**
   構造が「import x N + FunctionDeclaration + return JSX」と単純なため `statementKindSimilarity = 1.0`。

3. **call set もほぼ一致する**
   どのファイルも `useTranslations("project")`, `t(...)`, `<IntroDialog .../>` を呼ぶだけなので呼び出し集合は一致 (`callOverlap = 1.0`)。本来は callOverlap が "意味の共有" を表現する軸だが、薄いラッパーでは「**同じヘルパーを呼ぶ**」事実そのものが偽の類似度を作る。

4. **同型クラスタが pairwise に展開される**
   intro-dialog 系が 6 ファイル、workflow-runs 系が 2 ファイル。$\binom{4}{2}+\binom{2}{2}\approx 7$ 件が連続で並び、上位を占有してしまう。

つまり「**特徴量ベースで recall を稼ぐ設計**」と「**同じ共通コンポーネントを呼ぶ薄いラッパーが多いコード**」の組合せは構造的に弱い。jscpd はテンプレ部のトークン列が完全一致しても、しきい値 (`minLines: 15`, `minTokens: 100`) と「同一 import セクションを除外する慣習」で這い上がってこない。今回の `.jscpd.json` でも intro-dialog 系は報告されていない (おそらく minLines を満たさない、もしくは `extends *Props` 系の細かい差異で落ちる)。

### 一方で ts-dedup が拾えていて jscpd が逃したもの

- **#1 `project-detail-sidebar.tsx` 内の `favorites.map` ↔ `conversations.map`**: 同じ `<ConversationItem>` を 2 回手書きしているケース。jscpd の今回の上位には入っていない。jscpd は `aria-label` の有無や handler 名の差で同一 token 列にならず落ちた可能性が高い。
- **#15 `workflow-template-builder.tsx` のキーボードショートカット内インライン実装 ↔ `handleDeleteSelectedBlocks` callback**: 13 行の小さい body、引数名や閉包変数が違うため jscpd の token 一致は厳しい。ts-dedup は statement kind と call set 一致で拾える。
- **#14 `chat.ts` の `updateConversation` と `toggleFavorite`**: `set({...})` のフィールドだけ違う典型的な Type-3 クローン。jscpd 上位には類似の chat.ts ペアがあるが、別箇所で token がより一致する箇所のみ。

## 考察

**1. 単一指標 (FP rate top-N) ではなく recall × precision で評価すべき**
今回の "上位 N" 比較では jscpd が precision で勝つように見える。だがそれは jscpd が **拾えなかったクローン (low recall) を母数に含めない** ためでもある。実際 jscpd の上位 20 にも複数の TP があり、ts-dedup の rank 11–16 にも別系統の TP が並ぶ。両者を「1 リポジトリでの supervised 評価」にするなら、人間が真値集合を作って recall/precision/F1 を計算する必要がある。今回の比較は **同じ TP に到達できるか** + **トップにくるノイズの種類** の質的比較として位置づける。

**2. ts-dedup の現状の弱点は "ラッパークラスタ" の扱い**
特徴量はラッパー越しの semantic similarity を拾ってしまうが、これは「同じヘルパーを呼ぶ薄い変種」の場合、**人間にとっては抽象化のゴールであって出発点ではない**。改善案:
   - **既に共通コンポーネント化されているかを検出する**: 1 つの fragment が単一の named call (`<IntroDialog />` のような) を return しているだけなら down-rank。
   - **ファイル全体に占める fragment 比率** が高い (≈ 1.0) かつ **複数ファイルに同型がある** とき、pairwise でなくクラスタとして 1 件に collapse する。
   - **import 多数 + JSX 1 個 + 単一 export** という "config-shaped" pattern を専用に検出してフィルタするオプション。

**3. window-overlap の collapse 不足**
rank 10 (`client-helpers.ts:138-224` ↔ `:82-172`) は 35 行重なる window。同一ファイル内で start が 56 行ずれただけのスライディングを別 finding として扱っており、人間目線では「このファイルに反復構造がある」という単一の知見である。`dropSameFileOverlap=295,475` の dedup ロジックは効いているがゼロにしきれていない。

**4. jscpd は "見つけたものは正確" だが "見つけられないもの" がある**
今回の上位サンプルだと jscpd は 7/7 が TP で精度は高い。しかし `chat.ts` の `updateConversation` ↔ `toggleFavorite` のように、handler name 差で token 列が壊れる Type-3 クローンは jscpd が落としやすい。本ツールが目指す「コードレビュアーが "これ X と同じじゃない?" と気づく粒度」は **jscpd が原理的に拾いにくい**。トップにノイズが乗っていても recall で勝てれば、レビュー時の補助としての価値はある。

## 結論

- **見かけ上の top-10 precision**: jscpd ≫ ts-dedup (raw 70% FP)。
- **ノイズの質**: ts-dedup の FP は "intro-dialog ラッパー" の 1 クラスタが pairwise 展開されたもの。1 件に collapse すれば top-10 中の distinct FP は 1–2 件で、jscpd と大差ない。
- **得意領域の差**: jscpd は verbatim 重複に強く top に乗ったものは安心して読める。ts-dedup は Type-3 クローン (#1, #14, #15 など) を拾えるが、薄いラッパー系を抑える後処理が足りない。
- **改善の優先度 (ts-dedup 側)**: `recommendationHint` で down-rank する条件として「単一の named JSX/関数呼び出しに return する fragment」「同型クラスタの pairwise 展開」をターゲットにすると、本リポジトリの top-N 体験は劇的に改善する。

## 補足: 実行コマンド

```sh
node /path/to/ts-dedup/dist/index.js \
  --whole-repo \
  --repo /path/to/genesis-v2-charlie \
  --format json --limit all --no-code --phase-timings \
  --exclude '**/node_modules/**' --exclude '**/.next/**' \
  --exclude '**/.turbo/**' --exclude '**/.cache/**' \
  --exclude '**/dist/**' --exclude '**/build/**' \
  --exclude '**/coverage/**' --exclude '**/test-results/**' \
  --exclude '**/playwright-report/**' \
  --exclude '**/*.test.ts' --exclude '**/*.test.tsx' \
  --exclude '**/*.spec.ts' --exclude '**/*.spec.tsx' \
  --exclude '**/__fixtures__/**' --exclude '**/__snapshots__/**' \
  --exclude '**/migrations/**' --exclude '**/migration-scripts/**' \
  --exclude '**/generated/**' \
  --exclude 'packages/ui/**' --exclude 'apps/storybook/**' \
  --exclude '**/vitest.*.ts'
```

サマリ (stderr):
- `repo=774 files / 22,154 fragments`
- `candidatePairs=746,941, reportedPairs=306,121, displayed=7,265`
- 実行時間: 約 44 秒 (M-class macOS)

## 再実行: LSH 経路への同一ファイル overlap skip + ディレクティブ trim 適用後

`docs/plans/lsh-overlap-skip-and-directive-trim.md` の実装後、同じコマンドで
`genesis-v2-charlie` @ `b33bbf2` を再走させた結果。直近のスナップショットは
[`genesis-top15.txt`](./genesis-top15.txt) に保存。

| メトリクス | a603ad8 baseline | a996536 (リグレッション) | 本実装後 |
| --- | ---: | ---: | ---: |
| reported pairs (`displayed`) | 7,265 | 6,658 | 7,220 |
| top-10 中の同一ファイル overlap pair 数 | 1 | 10 | **0** |
| top-30 中の同上 | (測定外) | 30 | **0** |
| 元 eval の TP #1 (`project-detail-sidebar.tsx:293-404 ↔ :419-533`) の rank | 1 | 報告に存在しない (cap で脱落) | **1** |
| 元 eval の TP `spec-list.tsx:217-345 ↔ :347-476` の rank | 2 | (未確認) | **2** |
| 元 eval の TP #14 (`chat.ts:163-185 ↔ :188-210`) の rank | 14 | 152 | **13** |
| `report.summary.dropThinWrapperPairs` | 64,939 | (未確認) | 64,731 |
| intro-dialog 系の `combined ≥ 0.9` ペア数 | (未確認) | 7+ | 7 |

**得られた効果**

- LSH 経路にも同一ファイル overlap スキップが効くようになり、`index-workflow.ts:26-574 ↔ :26-593` のような sliding-window 自己ペアが top-N から完全に消えた。
- `capPerFragmentPairs` が同一ファイル overlap で枯らされなくなり、a996536 で報告から脱落していた TP #1 (project-detail-sidebar) と TP `spec-list` の両方が rank 1, 2 に復帰。
- `"use client"` のディレクティブプロローグを構造的要素として trim できるようになり、SourceFile レベルの「ディレクティブ + import + 関数 1 つ」windows は emit されなくなった。

**残課題: function-kind ラッパーの抑制**

intro-dialog 系の上位占有は減らせなかった (top-3〜top-9)。これらは `kind=function` の fragment (関数本体 7-35 行) であって window ではないため、本計画の trim 対策の射程外。`isThinWrapperFragment` は `return <IntroDialog … />` を JSX として認識するが、実コードでは `return ( <IntroDialog … /> )` のように `ParenthesizedExpression` で包まれており、現在の `isAllowedReturnExpression` は paren を unwrap しないため thin 認定できない。これは別計画 (`isAllowedReturnExpression` 側のパッチ) で扱う。

**実行サマリ (stderr)**

- `repo=774 files / 22,095 fragments`
- `candidatePairs=719,704, reportedPairs=290,503, displayed=7,220`
- 実行時間: 約 36 秒 (M-class macOS)
