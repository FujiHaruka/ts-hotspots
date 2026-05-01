## `comp` / `dup` の PR スコープ指定インターフェース統一

> Status: Draft
> Goal: `comp` と `dup` の「PR/diff にスコープを絞る」指定方法を完全に揃える。`--diff <revrange>` 一本に統一し、デフォルトは whole-repo。
> 非 Goal: 出力スキーマ全体の再設計、レポート構造の変更、内部アルゴリズムの変更。

## 1. 背景

`comp` と `dup` は両方とも「PR (= 任意の git revrange) にスコープを絞る」機能を持つが、CLI の表現が非対称:

| 観点 | `comp` (現状) | `dup` (現状) |
|---|---|---|
| PR スコープ | `--pr <revrange>` フラグ | 位置引数 `<revrange>` |
| 全体スキャン | デフォルト | `--whole-repo` フラグ必須 |
| ref 指定 | なし | `--ref <ref>` (whole-repo のみ) |

ユーザーから見ると意図は同じ ("この diff に絞る") なのに spelling が違うのは不要な認知負荷。実装上の差 (`comp` の `--pr` は表示フィルタ、`dup` の revrange はアルゴリズム駆動) はユーザーには関係ない。

過去計画 `docs/plans/unify-comp-and-dup.md` の延長線上で、最後に残っていた非対称を解消する。後方互換は要件外 (ユーザー判断)。

## 2. Approach

**フラグ指定一本化 + デフォルト = whole-repo**:

- `--diff <revrange>` をフラグとして両サブコマンドに揃える (`comp` の `--pr` を改名)
- `dup` から位置引数 `<revrange>` と `--whole-repo` を削除
- `dup --ref <ref>` は残す (whole-repo モードの scan ref 指定。`--diff` と排他)
- 内部の `mode: "pr"` / `PrInfo` / `prScope` 等もすべて `diff` 系に改名し、JSON 出力フィールドも `pr` → `diff` にする

「`--pr` ではなく `--diff`」を選ぶ理由:
- 実体は git revrange の diff スコープであって PR 専用ではない (feature branch 比較・任意 SHA 間監査にも使える)
- `git diff <revrange>` の mental model にそのまま乗る
- 「PR 専用ツール」という誤解を生まない

「`--whole-repo` を消す」理由:
- `--diff` 未指定 = 全体スキャン、で意味が一意。フラグの存在自体が冗長
- `dup` の whole-repo は重いので opt-in を強制している現状はあるが、それは可観測性 (stderr で件数・所要時間を出す) で代替できる。インターフェースに不要な分岐を持ち込むより実行時シグナルで対処する方が綺麗

新しいインターフェース:

```
ts-hotspots comp [path] [--diff <revrange>]
ts-hotspots dup  [path] [--diff <revrange>] [--ref <ref>]
```

スキーマ側の変更:

| 旧 | 新 |
|---|---|
| `FunctionReport.pr?: PrInfo` | `FunctionReport.diff?: DiffInfo` |
| `CloneCandidateReport.pr` (内部), `SerializedDupReport.pr?` | `.diff` (内部 + 出力) |
| `interface PrInfo` | `interface DiffInfo` (共通の場所に置けるなら統合検討) |
| `interface DuplicationPrInfo` | `interface DuplicationDiffInfo` |
| `mode: "pr" \| "whole-repo"` | `mode: "diff" \| "whole-repo"` |
| stderr stats line `pr=N changed files` | `diff=N changed files` |
| notice code `PR_SCOPE_EMPTY` | `DIFF_SCOPE_EMPTY` |
| エラー `--pr and --file are mutually exclusive` | `--diff and --file are mutually exclusive` |

## 3. 実装ステップ

### Step 1 — `comp`: `--pr` → `--diff` への改名
- `src/cli.ts`
  - `--pr <revrange>` オプション定義を `--diff <revrange>` に
  - `parsePr` → `parseDiff`
  - `FunctionCliOptions.pr` → `.diff`
  - `prScope` / `prNotice` ローカル変数名を `diffScope` / `diffNotice` に
  - エラー文言: `--pr and --file` → `--diff and --file`
  - help 文を改訂
- `src/schema.ts`
  - `interface PrInfo` → `interface DiffInfo` (export 名変更)
  - `FunctionReport.pr?: PrInfo` → `.diff?: DiffInfo`
- `src/cli.ts` の `applyOptionalReportFields`: `report.pr` → `report.diff`
- stats line: `pr=` → `diff=`
- notice code: `PR_SCOPE_EMPTY` → `DIFF_SCOPE_EMPTY`
- テスト: `src/cli-pr.test.ts` を `src/cli-diff.test.ts` にリネーム + 中身を `--diff` / `report.diff` / `DIFF_SCOPE_EMPTY` に書き換え

### Step 2 — `dup`: `--diff` フラグ追加 + 位置引数 / `--whole-repo` 削除
- `src/duplication/cli/args.ts`
  - `OPTIONS` から `"whole-repo"` を削除、`diff: { type: "string" }` を追加
  - 位置引数のパース: `<revrange>` を受け付けない (`[path]` のみ)
  - 解析ロジック書き換え:
    - `values.diff` があれば `parseRevRange` して PR/diff モード
    - なければ whole-repo モード
    - `--ref` は `--diff` 不在時のみ有効、`--diff` と併用はエラー
  - `USAGE` 全面書き換え
  - `PrModeArgs` → `DiffModeArgs` (`mode: "diff"`)
- `src/duplication/cli/main.ts`: `args.mode === "pr"` 参照を `"diff"` に
- `src/duplication/cli/runDetector.ts`, `runWholeRepoDetector.ts`: 同上、`AnalysisSummary.mode` も連動
- `src/duplication/domain/report.ts`
  - `mode: "pr" | "whole-repo"` → `"diff" | "whole-repo"`
  - `DuplicationPrInfo` → `DuplicationDiffInfo`
  - `CloneCandidateReport.pr` → `.diff`
- `src/duplication/report/serializeReport.ts`
  - フィールド `pr` → `diff`、コメント・条件分岐の名前更新
- テスト: `src/duplication/cli/args.test.ts` を `--diff` ベースに全面書き換え
- 周辺テスト (`main.test.ts`, `runWholeRepoDetector.test.ts`, `serializeReport.test.ts`, `jsonReport.test.ts`, `test/dedup/helpers/stubSummary.ts`, `tools/bench/groupsToPairs.ts`, `test/dedup/suiteDeterminism.test.ts`) の `mode: "pr"` / `pr:` 参照を更新

### Step 3 — エージェント向け文言とドキュメント
- `src/reporter/prompt.ts`: 「PR mode pivots on...」の説明文を新語彙に
- `README.md`:
  - `dup` の Usage ブロックを `--diff` 中心に書き換え
  - `--whole-repo` の説明を削除、「デフォルト = 全体スキャン」へ
  - Examples の `origin/main...` を `--diff origin/main...` に
  - `comp` 側にも `--diff` を Options に追加
- `docs/requirements.md`: PR モード記述を `--diff` 表現に
- `CLAUDE.md`: `--whole-repo` への言及があれば更新

### Step 4 — 検証
- `pnpm test` 全パス
- `pnpm start comp src --diff HEAD~1..HEAD --format json` で `report.diff` が入ることを目視確認
- `pnpm start dup src --diff HEAD~1..HEAD --format json` で `report.diff` 確認
- `pnpm start dup src --format json` (旗無し) で whole-repo として動くこと確認
- `pnpm start dup src --ref release/foo --format json` で `--ref` が単独で効くこと確認
- `tools/check-strip-only.ts` (pre-commit で走る) が通ること

## 4. リスク・落とし穴

- `dup` の出力 JSON で `pr` フィールドを購読しているコンシューマーが壊れる → 後方互換は要件外なので許容
- `mode: "pr"` を文字列リテラルで分岐している箇所 (内部・テスト) を網羅的に拾い切れないと型エラーで気付ける (TypeScript ユニオン更新による)
- `--pr` を消すことで既存ユーザの muscle memory が壊れる → README で目立つ記述、エラー時に「`--diff` を使え」と示す案内は出さない (後方互換捨てる方針)
- `comp` の `PrInfo` と `dup` の `DuplicationPrInfo` を共通化できそうだが、フィールドが微妙に違う (changedFiles の意味) ので別型のまま
