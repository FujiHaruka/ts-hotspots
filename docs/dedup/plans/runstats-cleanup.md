# RunStats 中立化計画

## 目的

`RunStats` (`src/cli/runDetector.ts:56`) が PR モード前提のフィールド名 (`changedFiles` / `changedFragments`) を抱えており、whole-repo モードでは base 側と同値で埋めるだけの「死んだ書き込み」になっている。命名と実体のミスマッチを解消し、scope 情報のソースオブトゥルースを `report.summary.scope` に一本化する。

ReportCandidate の `left`/`right` 改名 (commit `685d349`) で出力スキーマは中立化済み。本計画はその際の気づきを別タスクとして切り出したもの。

## 現状認識

`RunStats` は `runDetector` / `runWholeRepoDetector` の戻り値型で、**`main.ts` の stderr サマリ行 (`ts-dedup: …`) を組み立てるためだけ** に使われている。JSON / Markdown 出力には現れない。

- `src/cli/runDetector.ts:56-65` — `RunStats` 定義 (`baseFiles` / `baseFragments` / `changedFiles` / `changedFragments` / `candidatePairs` / `reportedPairs`)
- `src/cli/runDetector.ts:326-332` — PR モードでセット。`changedFiles = diff.files.length` で意味あり
- `src/cli/runWholeRepoDetector.ts:342-352` — whole-repo モードでセット。`changedFiles: sources.length, changedFragments: entries.length` と base 側と同値で埋める死んだ書き込み (コメントで言及あり)
- `src/cli/main.ts:108-114` — 唯一の消費点。PR モードのみ `changedFiles` / `changedFragments` を読み、whole-repo モードでは `baseFiles` / `baseFragments` だけ
- `src/cli/main.ts:120-122` — `candidatePairs` / `reportedPairs` は両モードで使う

scope 情報は `report.summary.scope` (`src/domain/report.ts:60-79`) に既に正しい形 (`base` 必須 / `changed` は PR モードのみ) で入っている。**`RunStats` はその情報を平坦化したコピー**。

## Approach

2 案ある。

### 案 A: フィールドをモード非対称な optional に分割

`RunStats` を以下に整理:

```ts
export interface RunStats {
  files: number;          // PR: baseFiles, whole-repo: 全 files
  fragments: number;      // 同上
  changedFiles?: number;  // PR モードのみ
  changedFragments?: number; // 同上
  candidatePairs: number;
  reportedPairs: number;
}
```

`main.ts` は `stats.changedFiles !== undefined` で分岐 (実質モード判定と同じ)。

**メリット**: 既存構造を最小変更。`RunStats` を引き続き main.ts で直接使える。
**デメリット**: scope 情報の重複は残る (`summary.scope` と `RunStats` の両方に同じ数字)。フィールド名も結局 `files` の意味がモードごとに違う。

### 案 B: scope を RunStats から削除し、`summary.scope` を SSoT にする (推奨)

`RunStats` を pipeline カウンタだけに削る:

```ts
export interface RunStats {
  candidatePairs: number;
  reportedPairs: number;
}
```

`main.ts` のサマリ行は `result.report.summary.scope` から組み立てる。

**メリット**:
- scope のソースオブトゥルースが `summary.scope` に一本化。重複ゼロ
- whole-repo モードの「死んだ書き込み」を構造的に消せる
- `RunStats` の責務が明確 (pipeline カウンタのみ) になる

**デメリット**: `main.ts` のサマリ行ロジックがやや長くなる (scope オブジェクトを開く)。ただし `report.summary` は既にメモリ上にあり、追加コストはない。

### 推奨

**案 B** で進める。理由: ts-dedup の出力契約 (`CloneCandidateReport`) はすでに scope を `summary.scope` で正規化していて、`RunStats` の scope 系フィールドはその古い平坦化レイヤの残滓。`main.ts` の表示が唯一の利用者である以上、表示層で `summary` を直接読んだほうが構造の重複が消える。

CLAUDE.md「Ignore backward compatibility」に従い、`RunStats` の旧フィールドは削除する (移行期間なし)。

## 設計詳細 (案 B)

### 変更ファイル

- `src/cli/runDetector.ts:56-65` — `RunStats` から `baseFiles` / `baseFragments` / `changedFiles` / `changedFragments` を削除
- `src/cli/runDetector.ts:326-332` — `RunStats` の組み立てから scope 系フィールドを削除
- `src/cli/runWholeRepoDetector.ts:342-352` — 同上、コメント (`// No "changed" side in whole-repo mode; …`) も削除
- `src/cli/main.ts:108-114` — `sizeLine` を `result.report.summary.scope` から組み立てる:
  - PR モード: `base=${scope.base.files} files/${scope.base.fragments} fragments, changed=${scope.changed.files} files/${scope.changed.fragments} fragments`
  - whole-repo モード: `repo=${scope.base.files} files/${scope.base.fragments} fragments`
  - モード判定は `result.report.summary.mode === "pr"`
- `src/cli/runDetector.test.ts:38` — `result.stats.changedFiles` の assert を削除 or `result.report.summary.scope.changed.files` に移植
- `src/cli/main.test.ts` — stderr マッチが `repo=\d+ files/\d+ fragments` なら不変。PR モード側の assert があれば確認

### 完了基準

- `pnpm test` 緑
- `pnpm typecheck` 緑
- ts-dedup を PR モード / whole-repo モードそれぞれで手動実行し、stderr サマリ行が以下の形を保つ:
  - PR: `ts-dedup: base=N files/M fragments, changed=N files/M fragments, candidates=…, reported=…, displayed=…`
  - whole-repo: `ts-dedup: repo=N files/M fragments, candidates=…, reported=…, displayed=…`
- `RunStats` の grep で `baseFiles` / `baseFragments` / `changedFiles` / `changedFragments` の参照が main.ts と test 以外に残っていないこと

## リスク / 既知の制約

- **下流ツールへの影響**: `tools/bench/*` は `RunResult` を消費しているが、scope 系フィールドを読んでいるかは未確認。`grep` で確認 → 使っていなければ何もしない、使っていれば `summary.scope` 経由に切り替える。
- **stderr サマリの文言保持**: `main.test.ts` が `^ts-dedup: repo=\d+ files/\d+ fragments/` 等の正規表現マッチをしているので、フォーマットを 1 字でも変えると壊れる。文言を完全に保つ。
- **PR モード時に `summary.scope.changed` が undefined の可能性**: 型上は optional だが、PR モードでは `runDetector.ts:314` で必ずセットしている。`main.ts` で `result.report.summary.mode === "pr"` で分岐するので safe。assertion でアクセスする場合は `!` 演算子ではなく明示的な undefined チェック (lint 規則の `non-nullable-type-assertion-style` を避けるため) で書く。

## 後続候補 (本計画の範囲外)

- `RunStats` をさらに削って `RunResult.report.summary.pipeline` から読ませる案。`candidatePairs` / `reportedPairs` も `summary.pipeline` に既にあるので、案 B 完了後は `RunStats` 自体を撤廃できる。今回の主目的 (命名と実体の整合) からはずれるので別タスク。
