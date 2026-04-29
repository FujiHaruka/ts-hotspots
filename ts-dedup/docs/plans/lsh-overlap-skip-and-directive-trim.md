# LSH 経路への同一ファイル overlap skip + ディレクティブを含む edge trim

## 背景

`docs/eval/eval-vs-jscpd.md` の評価で出た「intro-dialog ラッパー FP」「同一ファイル
sliding-window overlap」の改善のため、`fa2c25a feat(report): drop both-side thin-wrapper pairs`
と `a996536 feat(search): skip same-file overlapping pairs at search time` を入れた。

しかし `private-eval-repo` @ `b33bbf2` に対して同じコマンドで再走させたところ、結果はむしろ
悪化していた (`/tmp/tsdedup-rerun/result.json`、reported=6,658)。

| 指標 | eval baseline (a603ad8) | 再実行 (a996536) |
| --- | --- | --- |
| reported pairs | 7,265 | 6,658 |
| top-10 中の **同一ファイル overlap pair** 件数 | 1 (rank 10) | **10 (全件)** |
| top-30 中の同上 | (測定外) | **30 (全件)** |
| intro-dialog FP の最高位 | rank 3 | rank 32 (まだ残存) |
| 元 eval の TP #1 (`project-detail-sidebar.tsx:293-404 ↔ :419-533`) | rank 1 | **報告に存在しない** (cap で脱落) |
| 元 eval の TP #14 (`chat.ts:163-185 ↔ :188-210`) | rank 14 | rank 152 |

原因は 2 つ:

### 原因 1: 同一ファイル overlap skip が LSH 経路に未適用

`a996536` のフィルタは `src/search/candidateSearch.ts` (inverted-index path) の `tally`
にしか入っていない。`--whole-repo` モードは `src/cli/runWholeRepoDetector.ts:364-433` の
`runLshCandidateGeneration` 経由で LSH index の `forEachCandidatePair` をそのまま
`scoreOne` に流しているだけで、同一ファイル × 行範囲重なりの判定が無い。結果、
top-N がすべて `index-workflow.ts:26-574 ↔ :26-593` のような sliding-window 自己ペアで
埋まり、本物の TP はそれら騒音に挟まれて `capPerFragmentPairs` で脱落していた。

### 原因 2: window 端の trim が `"use client"` などのディレクティブを取りこぼす

`extractFragments.ts:225` の `isStructuralOnlyStatement` は

- `ImportDeclaration`
- `ExportDeclaration`
- `ImportEqualsDeclaration`
- `ExportAssignment`

のみを「先頭/末尾から削ぎ落とせる構造的要素」と扱う。

ところが React Server Components の `"use client";` や `"use strict";` のようなディレクティブ
プロローグは AST 上は `ExpressionStatement(StringLiteral)` で、上記カテゴリに含まれない。
intro-dialog 系ファイルは

```
"use client";              // ExpressionStatement (NOT trimmed)
import …;                  // ImportDeclaration
import …;                  // ImportDeclaration
import …;                  // ImportDeclaration
export function …(): … {…} // FunctionDeclaration
```

という構造で、先頭 trim ループ `while (structuralOnly[first] === true)` は最初の文
(`"use client"`) で即座に止まり、続く 3 つの import を**一切 trim できない**。結果
window 1-35 が「ディレクティブ + import 3 + 関数 1 = 5 文」として emit され、
`isThinWrapperFragment` の `stmts.length > maxBodyStatements (4)` ガードで thin 認定
されず、両側 thin → drop の経路に乗らない。

## Approach

1. **共通ヘルパー `isSameFileOverlap(a, b)` を `src/search/` に抽出** し、`tally`
   (inverted-index 経路) と `runLshCandidateGeneration` (LSH 経路) の双方から呼ぶ。
   これで「同一ファイル × 行範囲が交わるペアは候補にしない」という方針が 1 箇所で表現される。
2. **`isStructuralOnlyStatement` をディレクティブ対応に拡張**。`ExpressionStatement` で
   かつ式が `StringLiteral` (＝ ECMAScript ディレクティブプロローグの形) であるものを
   structural-only と見なす。これで window 1-35 → window が `"use client"` + import 3 を
   trim してくれて、結果的に「関数 1 つだけ」を含む短い window になり、`isThinWrapperFragment`
   が thin 認定 → 両側 thin → drop されて intro-dialog FP が消える。
3. **修正後に必ず実リポジトリ検証を走らせる**。`private-eval-repo` @ `b33bbf2` への再走で、
   下記の改善メトリクスが観測されることを確認してから merge する (CI ではなく手作業で良いが、
   本計画の "Done" 条件として明示する)。

設計判断のメモ:

- ヘルパーは `src/search/sameFileOverlap.ts` に新規追加し、`candidateSearch.ts` も
  そこから import する。LSH 層自体には file path を渡さない (LSH index は token 集合だけを
  扱う抽象で、file 情報を持ち込むと依存関係が膨らむ)。代わりに **LSH の生 candidate を
  fragmentId で受けた直後に CLI 層で `fragmentById` を引いて判定する**。
- 「重なり」の定義は `a996536` の `candidateSearch.ts` と完全に揃える: `endLine >= startLine`
  かつ `endLine >= startLine` の双方向交差 (touch を含む)。`max(Jaccard, containment)` の
  闍値方式は採らない (検索段では「1 行でも交わるなら捨てる」の方が説明可能)。
- ディレクティブ判定は `ts.isExpressionStatement(stmt) && ts.isStringLiteral(stmt.expression)`。
  位置は問わない (現実の TS では prologue 以外に `"use client"` が来ることはまず無い)。

## 変更ファイル

### 新規

- `src/search/sameFileOverlap.ts`
  - `export function isSameFileOverlap(a: { filePath, startLine, endLine }, b: same): boolean`
  - 単純な交差判定 (`a.filePath === b.filePath && a.endLine >= b.startLine && b.endLine >= a.startLine`)。
  - JSDoc に「`a996536` で導入した検索段スキップの判定式と同一」を明記。
- `src/search/sameFileOverlap.test.ts`
  - 異ファイル → false
  - 同一ファイル × 完全重なり → true
  - 同一ファイル × 完全包含 → true
  - 同一ファイル × 1 行 touch → true
  - 同一ファイル × 完全 disjoint → false
  - 同一ファイル × 隣接 (gap 1) → false

### 変更

- `src/search/candidateSearch.ts`
  - `tally` 内のインライン同一ファイル overlap 判定 (line 330-336) を
    `isSameFileOverlap` 呼び出しに置換。挙動は不変。
- `src/cli/runWholeRepoDetector.ts`
  - `runLshCandidateGeneration` の `lsh.forEachCandidatePair((a, b) => …)` 内で、
    `scoreOne(a, b)` を呼ぶ前に `fragmentById.get(a)` / `.get(b)` を引いて
    `isSameFileOverlap` で同一ファイル overlap なら早期 `return`。
  - 弾かれたペアは `unionPairs` にもカウントしない (= 検索段で「無かった」扱い)。
  - inverted-index 経路には影響なし (そちらは既に `tally` 内で同じ判定が効いている)。
- `src/cli/runWholeRepoDetector.test.ts`
  - LSH モードで「同一ファイル overlap pair が `seenPairs` / `scoredPairs` に
    入らない」テストを追加。
- `src/indexer/extractFragments.ts`
  - `isStructuralOnlyStatement` に **directive prologue 分岐** を追加:
    ```
    case ts.SyntaxKind.ExpressionStatement: {
      const expr = (stmt as ts.ExpressionStatement).expression;
      return ts.isStringLiteral(expr);
    }
    ```
- `src/indexer/extractFragments.test.ts`
  - 既存の trim テストに **`"use client"` を含む leading edge** のケースを追加:
    `["\"use client\";", import x4, real x4]` で window が `"use client"` も import も
    含まないことを assert。
  - "use client" + 真に意味のあるコードしか無い (import の無い) ケースで、ディレクティブ
    だけが trim されることも確認。

### 削除

なし。

## テスト計画

1. **ユニットテスト** (上記の追加分すべて)。
2. **既存スイート**: `pnpm test` をフルで通す。`extractFragments` 系の既存 trim
   テストが新ロジックでも通ることを確認 (ディレクティブを含まない既存ケースの挙動は不変)。
3. **実リポジトリ検証** (本計画の Done 条件)。

## 実リポジトリ検証 (Done 条件)

修正後、`docs/eval/eval-vs-jscpd.md` と同じコマンドで `private-eval-repo` @ `b33bbf2`
を再走させる:

```sh
node /Users/haruka/dev/src/github.com/FujiHaruka/ts-dedup/dist/index.js \
  --whole-repo \
  --repo /Users/haruka/dev/src/github.com/private-eval-repo \
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
  --exclude '**/vitest.*.ts' \
  > /tmp/tsdedup-rerun-after/result.json 2> /tmp/tsdedup-rerun-after/stderr.log
```

下記すべてを満たすこと:

| メトリクス | 取得方法 | 合格条件 |
| --- | --- | --- |
| top-10 中の同一ファイル overlap pair 数 | `jq '.candidates[:10] \| [.[] \| select(.left.filePath == .right.filePath and (.left.endLine >= .right.startLine and .right.endLine >= .left.startLine))] \| length'` | **0** |
| top-30 中の同上 | top-30 で同 jq | **0** |
| intro-dialog 系の `combined ≥ 0.9` ペア数 | `jq '[.candidates[] \| select(.left.filePath \| test("intro-dialog")) \| select(.scores.combined >= 0.9)] \| length'` | **0** (現状 7) |
| 元 eval の TP が top-20 に入るか | `jq '.candidates[:20] \| .[] \| .left.filePath + ":" + (.left.startLine\|tostring) + "-" + (.left.endLine\|tostring) + " <-> " + .right.filePath + ":" + (.right.startLine\|tostring) + "-" + (.right.endLine\|tostring)'` で目視 | **`project-detail-sidebar.tsx:293-404 ↔ :419-533` または `spec-list.tsx:217-345 ↔ :347-476` のうち少なくとも 1 件が top-20 に存在** |
| `report.summary.dropThinWrapperPairs` (stderr) | `grep dropThinWrapperPairs stderr.log` | 64,939 → **減少** が想定 (window 経路で thin 認定されなかった分が消えるので、本来狙う「DRY 済みラッパー間ペア」だけ残る) |

加えて、改善が確認できた段階で `docs/eval/eval-vs-jscpd.md` の **「再実行」セクション**
を新規追加する (現行ドキュメントは a603ad8 時点のスナップショットなので上書きしない)。
最低限、上の 5 メトリクスを表で残しておけば十分。

### リグレッション防止

- 上記 5 メトリクスの**いずれか 1 つでも合格条件を外したら** merge しない。
- 同時にスナップショット的に「top-15 のファイルパス+行範囲」を `docs/eval/` 配下に
  テキストで保存しておき、次回の改修時に diff で目視差分を取れるようにする
  (`docs/eval/eval-top15.txt` 等)。これは将来の「数値メトリクスは合格しているのに
  上位の質が変わってしまった」を捕まえる安価な砦。

## Out of scope

- `capPerFragmentPairs` の値や挙動の見直し。今回の TP 脱落は同一ファイル overlap が
  cap を食いつぶしたことが本質で、上の修正で自動的に解消されるはず。
  もし検証で TP が依然として top-20 に出てこないようなら別計画で対応する。
- `isThinWrapperFragment` を window 経路で再帰的に評価するアイデア (前回提案 2 に相当)。
  ディレクティブ trim で window がそもそも thin に classify されるようになれば不要。
  検証で intro-dialog FP が消えなければ、この計画では追わずに後続計画で扱う。
- LSH パラメータ調整やスコアリング側の変更。
