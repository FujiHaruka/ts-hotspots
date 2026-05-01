## ts-morph 依存撤廃 計画

> Status: Completed (2026-05-01)
> Goal: `comp` の collector / loader / dismissal が依存している `ts-morph` を取り除き、`typescript` 直接利用 (`ts.createSourceFile` + `ts.forEachChild`) に統一する。`dup` 側の indexer (`src/duplication/indexer/parseSource.ts`) と入力モデルを揃える。
> 非 Goal: `comp` と `dup` の loader / parser モジュールを物理的に **1 本に統合** すること (本計画では parser を共有可能な形に lift するに留め、indexer / collector の合流は別計画)。`comp` の挙動・出力スキーマ・ranking ロジックの変更。`bench` の追加最適化。

## 0. Progress

- [x] **M1** — Bridge: `Declaration` に `tsNode` / `tsSourceFile` を追加 (`.compilerNode` 経由) し、ts-only の walk / parse ヘルパを新設。production 挙動は不変。
- [x] **M2-1** — complexity collectors (cognitive / sloc / parameter-count / max-nesting-depth) を ts-only に書き換え。
- [x] **M2-2** — effects + call-graph collectors (await-count / mutation-count / try-catch-count / callee-count) を ts-only に書き換え。
- [x] **M2-3** — dismissal/hash を ts-only に書き換え + hash.test.ts を `parseFirstFunctionLike` に移行。aggregate.test.ts は `enumerateDeclarations` 経由のため M3 まで Project ベース据置。
- [x] **M3** — ts-morph 撤去: `Declaration.node` 削除 / `loadProject` を `ts.createSourceFile` 直接に書き換え / `enumerate-source-files.ts` を削除 / `package.json` から `ts-morph` を削除 / dogfooding で出力差確認 (untouched file の metrics + bodyHash は bit-identical)。

## 1. 経緯

直前の `comp-drop-callercount.md` 計画で `callerCount` (TypeChecker を要求していた唯一の軸) を削除し、`loadProject` から `getTypeChecker()` 呼び出しが消えた (load-project.ts:30 のコメント "collectors only need ts-morph to wrap the AST, not to type-check anything")。これにより ts-morph は **AST ラッパ以上の仕事をしていない** 状態になった。

一方、`dup` 側の indexer は `ts.createSourceFile` を直接叩いている (`src/duplication/indexer/parseSource.ts`)。同じリポ内に **2 種類の AST API (ts-morph と raw ts)** が共存しているのは保守上のノイズで、片方を倒せるなら倒したい。grep 確認:

- `getType` / `getSymbol` / `TypeChecker` / `.compilerNode` を **ロジックとして** 呼んでいる本文は 0 件 (`load-project.ts:30` のコメントのみヒット)。
- `CollectorContext.project: Project` フィールドは production の collector では参照されておらず (`grep "ctx.project"` 0 件)、`aggregate.ts` が型シグネチャ整合のために渡しているだけのデッドフィールド。
- ts-morph を import している `.ts` は 25 ファイル — collectors / aggregator / dismissal / loader 配下に分散。

機能的な依存はすでに失われており、残っているのは **API ergonomics** (`getKind()` / `forEachDescendant` / `asKindOrThrow` / `getStartLineNumber` 等の便利メソッド) のみ。これを raw `ts` に置き換えても `dup` 側の実装パターンを参考にできる。

## 2. 現状

### 2.1 ts-morph の到達範囲 (production)

```
src/loader/load-project.ts                         # Project 構築 (TypeChecker 呼び出しは無し)
src/collectors/types.ts                            # FunctionLikeNode / Declaration / CollectorContext 型
src/collectors/walk.ts                             # walkBodyExcludingNestedFunctions
src/collectors/enumerate-source-files.ts           # project.getSourceFiles() 経由で SourceFileInfo を返す
src/collectors/enumerate-declarations.ts           # forEachDescendant + getKind / asKindOrThrow
src/collectors/complexity/{cognitive,sloc,max-nesting-depth,parameter-count}.ts
src/collectors/effects/{await-count,mutation-count,try-catch-count}.ts
src/collectors/call-graph/callee-count.ts
src/dismissal/hash.ts                              # node.getText() で body 文字列を hash
```

### 2.2 ts-morph の到達範囲 (test only)

```
src/loader/load-project.test.ts
src/collectors/enumerate-source-files.test.ts      # "SourceFileInfo.sourceFile is the actual ts-morph SourceFile" を assert する
src/collectors/enumerate-declarations.test.ts
src/collectors/complexity/{cognitive,sloc,max-nesting-depth,parameter-count}.test.ts
src/collectors/effects/{await-count,mutation-count,try-catch-count}.test.ts
src/collectors/call-graph/callee-count.test.ts
src/aggregator/aggregate.test.ts
src/dismissal/hash.test.ts
```

各 collector のテストは概ね `Project + addSourceFileAtPath` または `createSourceFile` で fixture を組み、`sourceFile.getFunctions()[0]` 等で対象 `FunctionLikeNode` を取り出すパターン。

### 2.3 dup 側の参考実装

`src/duplication/indexer/parseSource.ts` が `ts.createSourceFile(filePath, text, ts.ScriptTarget.Latest, /* setParentNodes */ true, scriptKind)` で 1 ファイル単位パース。`extractFragments.ts` で `ts.forEachChild` + `ts.getLineAndCharacterOfPosition` ベースの walk を実装。本計画の `comp` 側書き換えでもほぼ同じ API 表面で済む。

### 2.4 collector / dismissal が `Node` に対して呼んでいる主要 API

| ts-morph | ts (置換先) | 備考 |
|---|---|---|
| `node.getKind()` | `node.kind` | `SyntaxKind` の数値は両ライブラリで一致 (ts-morph は ts のラッパ) |
| `node.getChildren()` | `node.getChildren(sourceFile)` または `ts.forEachChild` | 多くの場合 `forEachChild` で十分かつ高速 |
| `forEachDescendant(visit)` | 自前再帰 (`ts.forEachChild`) | 共通ヘルパ化する |
| `node.asKindOrThrow(K)` | 直接 cast (`node as ts.IfStatement` 等) + `if (node.kind !== K) throw` | TypeScript の type narrowing で十分 |
| `node.getText()` | `node.getText(sourceFile)` | SourceFile を引数に取り回す必要あり |
| `node.getStartLineNumber()` | `ts.getLineAndCharacterOfPosition(sourceFile, node.getStart()).line + 1` | 0-based → 1-based 変換 |
| `node.getEndLineNumber()` | 同上 (`node.getEnd()` 起点) | |
| `node.getStart()` | `node.getStart(sourceFile)` または `node.getStart()` | ts.Node でも同 API |
| `node.getParent()` | `node.parent` | `setParentNodes: true` で parse すれば動く (dup 側もそうしている) |
| `(fn).getName()` | `fn.name?.getText(sourceFile)` 等 | declaration 種別ごとに分岐 |

機械的な置換でほぼ済むが、`SourceFile` を collector 内部の visitor まで渡し回す必要がある (ts.Node 単独では `getText` / 位置情報が引けないため)。これは ergonomic な後退で、`Declaration` 型に `tsSourceFile` を持たせて吸収する。

### 2.5 移行の seam

ボトルネックは `Declaration.node: FunctionLikeNode (ts-morph)` 型。これを変更すると **全 collector が同時にビルドエラーになる**。M1 で `Declaration` に **両方の参照** (`node: FunctionLikeNode` と新規 `tsNode: ts.Node`, `tsSourceFile: ts.SourceFile`) を持たせて bridge にし、collector を 1 本ずつ ts-only に切り替える。M3 で旧 `node` を削除する。

`Project` の `addSourceFilesAtPaths` で読み込まれた `SourceFile` は `.compilerNode` 経由で `ts.SourceFile` を取り出せる (ts-morph 自体が ts.SourceFile をラップしている実装)。なので bridge 期間中は **ts-morph が parse した結果をそのまま raw ts として使う** — 二重 parse は不要。

## 3. Approach

「**M1: bridge を貼る → M2: collector を 1 本ずつ ts-only にスワップ → M3: ts-morph を物理削除**」の 3 段階で進める。各段階は production の挙動を変えず、テストが green であれば独立にマージできる。

設計上のキー判断:

- **bridge は `Declaration` に追加するだけ**。`tsNode` / `tsSourceFile` を `enumerate-declarations.ts` で `.compilerNode` 経由でセット。collector は最初は `node` (ts-morph) を見て、移行後は `tsNode` / `tsSourceFile` を見るように切替。bridge 期間中は両方が存在するメモリ二重持ちだが、`compilerNode` は ts-morph が **既に内部に保持している参照** なので追加 allocation は無い。
- **`parseSource` は共有資産に lift**。現在 `src/duplication/indexer/parseSource.ts` にある実装を `src/parser/parseSource.ts` (新設) に上げ、duplication 側からも import するように変える。dup と comp が同じ parser を踏むほうが、将来 indexer 統合する際にも seam が減る。
- **walk ヘルパは ts-only 版を **別ファイル** で書く**。`src/collectors/walk.ts` (ts-morph) は M3 で削除する形にし、新規 `src/collectors/walk-ts.ts` (仮称) で `ts.forEachChild` ベースの実装を提供。M2 の collector 移行中は両方が共存。
- **テスト fixture 用の小さなヘルパ `parseFirstFunctionLike(text, ext?)` を新設**。各 collector のテストが `Project` + `getFunctions()[0]` パターンを再実装している (8 ファイル弱) ので、これを `ts.createSourceFile` + 自前 visitor のヘルパに集約する。テストコードの行数も縮む副次効果。
- **`enumerate-source-files.ts` は M3 で役割縮小**。`SourceFileInfo` の型を `{ path: string; sourceFile: ts.SourceFile }` に置き換え、列挙関数自体は削除して `cli.ts` の `prepare()` が `listRepoSources` + `parseSource` を直接呼ぶ形にする。
- **`CollectorContext.project` フィールドは M3 で削除**。production で参照していないので、テストの fixture 引数を直すだけで済む。
- **ts-morph は最後に dependencies から削除**。M3 で `package.json` から外し、`pnpm install` で lockfile から消えることを確認。

## 4. 意思決定が必要な点

| ID | 論点 | 案 | 暫定 |
|---|---|---|---|
| D1 | bridge 期間中の `Declaration` 形 | (a) `node` (ts-morph) はそのまま残し `tsNode` / `tsSourceFile` を追加、M3 で `node` 削除 (b) 最初から `node: ts.Node` に切替し `morphNode` を仮置き (c) parallel struct `DeclarationTs` を別途用意 | **暫定 (a)**。既存 collector への破壊が最小。M3 で `node` を消す時点で全 collector は ts-only になっている前提 |
| D2 | `parseSource` の置き場所 | (a) `src/parser/parseSource.ts` (新設) に lift し dup 側も import (b) dup 側の `src/duplication/indexer/parseSource.ts` をそのまま comp から import (c) duplicate (両側に独立コピー) | **暫定 (a)**。(b) は loader 系が duplication 内部を参照する逆依存になりレイヤ違反。(c) は将来 zinc が二重実装になりやすい |
| D3 | ts-only walk ヘルパの場所 | (a) 新ファイル `src/collectors/walk-ts.ts` を作り M3 で旧 `walk.ts` を削除 (b) `walk.ts` を ts.Node 用に書き換え、M2 中は collectors が互換シム経由で呼ぶ (c) collector 内に inline | **暫定 (a)**。M2 移行中の co-existence を許す。`walk-ts.ts` は M3 で `walk.ts` にリネーム |
| D4 | テスト fixture ヘルパ | (a) 共通ヘルパ `parseFirstFunctionLike(text, ext?)` を新設 (b) 各テストで `ts.createSourceFile` + 自前 visitor を書く (c) ts-morph テストヘルパ (`makeProject`) を残し fixture だけ ts-morph で組む (collector は ts-only) | **暫定 (a)**。テスト 8 ファイルでの重複コードを抑える |
| D5 | `Declaration.node` の最終型 (M3 後) | (a) `ts.Node` (b) `ts.FunctionDeclaration \| ts.MethodDeclaration \| ts.ArrowFunction \| ts.FunctionExpression \| ts.GetAccessorDeclaration \| ts.SetAccessorDeclaration \| ts.ConstructorDeclaration` (c) `ts.SignatureDeclaration` | **暫定 (b)**。現在の `FunctionLikeNode` と同じ specificity を保つ。collector 内の type narrowing が楽 |
| D6 | `setParentNodes` 設定 | (a) `true` (dup と同じ) (b) `false` で `node.parent` 利用箇所を引数渡しにリファクタ | **暫定 (a)**。dup 側との一貫性 + cognitive collector が `parent.kind` を参照しているため。性能差は parse 1 回あたり微小 |
| D7 | `CollectorContext.project` フィールドの扱い | (a) M3 で完全削除 (`SourceFile[]` を引数で持つ) (b) `ts.Program` に置き換える (c) 残置 (型整合のため `undefined` 許容に) | **暫定 (a)**。production で誰も読んでいないデッドフィールド |
| D8 | `enumerate-source-files.ts` の最終形 | (a) 削除し `cli.ts` で `listRepoSources` + `parseSource` を直接呼ぶ (b) ファイル名のまま中身を `listRepoSources` の単純ラッパに (c) 列挙ロジックを `loader/load-project.ts` に吸収 | **暫定 (a)**。M3 までの seam を考えると一旦削除が最小 |
| D9 | リリース戦略 | (a) M1+M2+M3 を 1 メジャーバージョンに乗せる (内部リファクタなので user-facing 破壊は無い) (b) M3 完了時に minor bump | **暫定 (b)**。挙動・出力スキーマは変わらず、依存ツリーが軽くなるだけなので minor で十分 |
| D10 | bench での性能確認 | (a) M3 完了後に `pnpm bench` を 1 回回し、`comp` の wall clock 比較を CHANGELOG/release note に載せる (b) 計測しない | **暫定 (a)**。`Project` 構築コスト (重い処理) が消えるので軽い高速化を期待。逆に劣化していたら原因を追う必要あり |

## 5. マイルストーン

### M1 — Bridge: Declaration に tsNode / tsSourceFile を生やす

決定: D1 / D2 / D3 / D6 / D7 (一部) — `Declaration` のフィールド追加と、ts-only ヘルパの足場のみ。

実装:

- **新規** `src/parser/parseSource.ts` を作成。`src/duplication/indexer/parseSource.ts` の中身をそのまま移し、duplication 側を `export * from "../../parser/parseSource.ts"` の re-export に縮小 (互換 import パスを残すため)。dup 側の他の import も新パスに付け替え可能だが、本 PR では re-export に留める (大規模 rename は別コミット)。
- **新規** `src/collectors/walk-ts.ts` を作成: `walkBodyExcludingNestedFunctionsTs(body: ts.Node, sourceFile: ts.SourceFile, visit: (node: ts.Node) => void)`。ロジックは既存 `walk.ts` の SyntaxKind セット判定を ts.SyntaxKind 値で書き直すだけ。`ts.SyntaxKind.FunctionDeclaration` 等の値は ts-morph 側と完全一致するので比較ロジックは流用可能。
- **新規** `src/collectors/internal/declarationHelpers.ts` (仮): ts.Node 上で関数名 / body / 親 binding を解決するヘルパ群 (既存 `enumerate-declarations.ts:resolveBindingName` 相当)。M2 の collector 移行中に共有される。
- **修正** `src/collectors/types.ts`: `Declaration` に `tsNode: ts.Node` と `tsSourceFile: ts.SourceFile` を追加 (optional ではなく必須。bridge 期間中も常に populate)。`FunctionLikeNode` 型は据え置き。
- **修正** `src/collectors/enumerate-declarations.ts`: 各 declaration を作る際に `tsNode: fn.compilerNode` と `tsSourceFile: fn.getSourceFile().compilerNode` をセット。既存ロジックは触らない。
- **新規 (test)** `src/parser/parseSource.test.ts`: 元の dup 側テストを移動 (re-export なので import 経路だけ変える)。
- **新規 (test)** `src/collectors/walk-ts.test.ts`: 既存 `walk.ts` のテスト (もしあれば) と同じケースで walk-ts 版が動くことを確認。

検証:
- `pnpm test` 全 green。挙動変化が無いので既存スナップショットも無傷。
- `pnpm check:strip-only` green (新規ファイルが strip-only 違反を踏まないことを確認)。
- `pnpm typecheck` green。

非 Goal (M1 では触らない):
- collector の中身 (`cognitive.ts` 等) — M2 で書き換える。
- `loadProject` の中身 — M3 で書き換える。
- `package.json` — M3 で削除する。

### M2-1 — complexity collectors を ts-only に

決定: D5 (内部 narrow に閉じる範囲で) / D4 (テストヘルパ新設)。

実装:

- **新規 (test)** `src/collectors/internal/parseFirstFunctionLike.test-helper.ts` (仮): `parseFirstFunctionLike(text: string, ext?: ".ts" | ".tsx"): { sourceFile: ts.SourceFile; fn: ts.FunctionLikeDeclaration }` を提供。`ts.createSourceFile` + 自前 visitor で 1 つ目の function-like declaration を返す。
- **書き換え** 4 ファイル (production):
  - `src/collectors/complexity/cognitive.ts`: `Node` (ts-morph) → `ts.Node`。`getKind()` → `.kind`、`asKindOrThrow(K)` → `as ts.IfStatement` 等の cast、`getChildren()` → `ts.forEachChild` (順序重要なので array 化が必要な場合は明示)、`getText()` → `node.getText(sourceFile)`。`SyntaxKind.AmpersandAmpersandToken` 等の値は同一なので set 比較はそのまま。`getParent()` → `node.parent`。
  - `src/collectors/complexity/sloc.ts`: 同上。`getStartLineNumber` / `getEndLineNumber` を ts 版位置変換 (`ts.getLineAndCharacterOfPosition` + `+ 1`) に。
  - `src/collectors/complexity/parameter-count.ts`: 関数の `getParameters().length` 相当 → `decl.parameters.length` (ts.SignatureDeclaration の field 直接アクセス)。
  - `src/collectors/complexity/max-nesting-depth.ts`: ロジック単純なので機械的。
- **書き換え** 4 ファイル (test): 各テストの fixture を `parseFirstFunctionLike` 経由に置き換え。`Project` import を消す。
- collector が受け取る `Declaration` から `decl.tsNode` / `decl.tsSourceFile` を使うように切替。`decl.node` (ts-morph) は触らない (まだ他の collector が使っているので残す)。

検証:
- 各 collector のテストファイル単位で `pnpm test <file>` を回し挙動変化なし (cognitive collector は計算順序が複雑なので特に注意して既存テストの全ケースが pass することを確認)。
- 全体 `pnpm test` green。
- 性能: cognitive collector は AST 走査が深いので、`pnpm bench` のシナリオ次第で数 % の差が出る可能性。M3 で総合計測するので M2-1 段階での詳細計測は不要。

リスク:
- `getChildren()` と `forEachChild` の挙動差: 前者は token を含む全子、後者は構造的子のみ。cognitive collector の `BinaryExpression` 走査で operator token を踏んでいる箇所があれば、`forEachChild` だと token を素通りするので意図しない挙動変化が出る。**`getChildren(sourceFile)` を使うか、operator token を `node.operatorToken` で直接参照するように書き換える** ほうが安全。
- `getKind()` の戻り値とフィールド `.kind` の値域は同一だが、TypeScript の narrow が効かない箇所があれば明示 cast を入れる。

### M2-2 — effects + call-graph collectors を ts-only に

決定: D5 / D4 (再利用)。

実装:
- **書き換え** `src/collectors/effects/{await-count,mutation-count,try-catch-count}.ts` + テスト 3 ファイル。
- **書き換え** `src/collectors/call-graph/callee-count.ts` + テスト 1 ファイル。

各 collector は M2-1 と同じ機械的置換で済む。`mutation-count.ts` は `BinaryExpression.operatorToken.kind` で代入演算子判定をしているので、ts.Node でもまったく同じパターンが使える。`await-count` は `SyntaxKind.AwaitExpression` を数えるだけなので最も簡単。

検証:
- 各テスト green。
- `comp` を本リポに対して 1 回回し、出力 (functions セクションの上位 N 件) が M1 後と一致することを diff で確認。

非 Goal: collector ロジック自体の改善 (例えば `mutation-count` の判定漏れ修正等) は混ぜない。挙動変化が無いことを保証するためのリファクタに留める。

### M2-3 — dismissal/hash と aggregator のテスト fixture 移行

決定: D4 (適用範囲)。

実装:
- **書き換え** `src/dismissal/hash.ts`: `computeBodyHash(node: Node)` → `computeBodyHash(node: ts.Node, sourceFile: ts.SourceFile)`。`node.getText()` → `node.getText(sourceFile)`。呼び出し側 (aggregator) は M1 で生やした `decl.tsSourceFile` を渡すように修正。
- **書き換え** `src/dismissal/hash.test.ts`: ts-morph fixture を `parseFirstFunctionLike` ベースに。
- **書き換え** `src/aggregator/aggregate.test.ts`: 同上。`Project` を import している箇所を `parseFirstFunctionLike` または直接 `ts.createSourceFile` に。
- **修正** `src/aggregator/aggregate.ts`: `hash` 呼び出しのシグネチャ変更を反映。collector 経路では `decl` 単位で hash を計算する (現状もそう) ので変更は局所。

検証:
- `pnpm test` 全 green。
- `dismissal/hash.ts` の出力 hash が M2-2 完了時点と bit-identical であること (sha256 入力文字列は変わらない前提)。

リスク:
- `node.getText()` (引数なし) と `node.getText(sourceFile)` は **多くのケースで同じ文字列を返すが**、SourceFile を解決できない `ts.Node` (合成された AST 等) では前者は throw する。collector 経路では SourceFile が常に取れているので影響無し。
- `hashText` の正規化は body 文字列の取得後なので、`getText` が返す文字列さえ同じなら hash も同じ。

### M3 — ts-morph 物理撤去

決定: D1 後半 / D5 / D7 / D8 / D9 / D10。

実装:
- **修正** `src/collectors/types.ts`: `Declaration.node` (ts-morph) を削除し `tsNode` を `node` にリネーム (もしくは `tsNode` のまま据え置き — 命名は実装着手時に決める)。`FunctionLikeNode` の型を ts ベースに再定義 (D5 (b))。`CollectorContext.project` フィールドを削除。
- **修正** `src/collectors/enumerate-declarations.ts`: `forEachDescendant` を自前の `ts.forEachChild` 再帰に書き換え。`asKindOrThrow` を ts narrow に置換。`resolveBindingName` を ts.Node 版に。
- **修正** `src/loader/load-project.ts`: `Project` を完全に外し、`sources: { absolute, relative }[]` から `ts.createSourceFile` で `ts.SourceFile[]` を返す形に。`PROJECT_COMPILER_OPTIONS` は撤去 (もはや意味を持たない)。返り値型を `LoadedProject { sourceFiles: { path: string; sourceFile: ts.SourceFile }[] }` に。
- **削除** `src/collectors/walk.ts` (旧 ts-morph 版)。`walk-ts.ts` は `walk.ts` にリネーム (M2-1 で `walk-ts` に追加した import 経路はすべて `walk.ts` に戻す — `git mv` 1 回で済む)。
- **削除** `src/collectors/enumerate-source-files.ts` (旧 ts-morph 版): `cli.ts` の `prepare()` が `listRepoSources` の結果を直接 `loadProject` に渡し、戻り値 (`{ path, sourceFile: ts.SourceFile }[]`) を `aggregator` に流す。`SourceFileInfo` 型はこの新形 (`{ path: string; sourceFile: ts.SourceFile }`) で `src/loader/types.ts` (新設) に再定義し、collector / aggregator / dismiss CLI からは新パスで import。
- **修正** 全 production / test ファイルの `from "ts-morph"` import を消す (M2 完了時点で残っているのは load-project.ts / enumerate-source-files.ts / load-project.test.ts / enumerate-source-files.test.ts のみのはず)。
- **削除** `package.json` から `"ts-morph": "27.0.2"` 行。`pnpm install` で lockfile から削除されることを確認。
- **修正** dup 側の `src/duplication/indexer/parseSource.ts` を re-export 経由から完全に削除し、import 経路を `src/parser/parseSource.ts` に統一 (M1 では re-export を残していたのを撤去)。

検証:
- `pnpm test` 全 green。
- `pnpm typecheck` green (`ts-morph` を import している残骸が無いこと)。
- `pnpm check:strip-only` green。
- `pnpm bench` を本リポに対して回し、M1 開始前との wall clock 差を計測。`Project` 構築 + ファイル投入のコストが消えるので軽い高速化を期待。**期待**: `comp` 全体で 5-15% の高速化、または無変化 (悪化していたら原因を追う)。
- `pnpm start comp` の出力 envelope が M1 開始前と差分 0 (functions 配列の順序・metric 値・hash が完全一致) — 実装期間中の dogfooding で何度かサンプリング。
- `node_modules` から ts-morph と推移依存 (`@ts-morph/common` 等) が消えていることを確認。

リスク:
- `ts.forEachChild` と `forEachDescendant` の **訪問順** はほぼ同じだが、token / trivia の扱いが違う場合がある。enumerate-declarations の出力順 (= `Declaration[]` の順序) が変わると `id` (= `${file}:${start}`) は変わらないが、`functions` の表示順が動く可能性。aggregator が最終的に sort しているので問題ないはずだが念のため `comp` 出力を bit-identical 確認。
- `compilerOptions` を完全に外すと、`.tsx` ファイルの parse は `ScriptKind.TSX` 指定が必要になる。`parseSource.ts` (lift 済) で拡張子から決めているので影響なし。
- registry / dismissal の `bodyHash` は M2-3 で sha256 入力が変わらないことを確認済み。M3 でも `node.getText(sourceFile)` の出力文字列は変わらないので互換維持。

## 6. リスク / 横断論点

- **AST 訪問順の差**: `forEachDescendant` (ts-morph) と自前 `ts.forEachChild` 再帰は順序が一致するはずだが、SyntaxList 等の "ノード" 扱いが違う。collector の出力が node 順序に依存していないか (cognitive collector の `BinaryExpression` の "logical operator run の先頭だけカウント" などは parent 参照で判定しているので順序依存なし、確認済み) — 各 collector で再確認しながら進める。

- **`getText()` のコメント / trivia の扱い**: ts-morph の `getText()` (引数なし) と ts の `getText(sourceFile)` は同じ実装に行き着くので差はない。ただし `getFullText()` を使っていた箇所があれば leading trivia が付くので別物 — grep で要確認 (今のところ見当たらず)。

- **dup 側との parseSource 統合**: M1 で re-export、M3 で物理統合。dup 側のテスト (`src/duplication/indexer/parseSource.test.ts`) が `src/parser/parseSource.ts` の同じ実装を経由することになるので、テストを移動するかパスを更新する。

- **strip-only 制約**: 新規追加コード (parser, walk-ts, declarationHelpers 等) は `enum` / `namespace` / parameter properties を踏まない。`tools/check-strip-only.ts` で自動検証されるので CI で拾える。

- **`@ts-morph/common` の推移依存**: ts-morph を消すと自動的に外れるはずだが、念のため `pnpm why @ts-morph/common` で確認。lockfile diff で `ts-morph` 関連エントリが完全に消えていれば OK。

- **collector 単体テストの ergonomic 後退**: `Project` ベースの fixture は `sourceFile.getFunctions()[0]` のような chain で fluent に書けたが、ts.Node ベースだと自前 visitor が必要。`parseFirstFunctionLike` ヘルパで吸収するが、複数関数を持つ fixture では index アクセスが必要になる。テストの可読性が極端に落ちないよう、ヘルパに `parseAllFunctionLikes(text)` のバリエーションも用意する。

- **将来の拡張余地**: 本計画後、`comp` と `dup` は parser を共有しつつも fragment 抽出 / declaration 抽出は別経路。将来 "1 ファイルを 1 回だけ parse して両者で使う" 統合を入れるなら、`prepare()` レイヤで parsed source を共有キャッシュするフックを足せばよい。本計画ではそこまで踏み込まない。

## 7. 決定済み事項

### M1 (2026-05-01)

- **D1**: Bridge は `Declaration` に `tsNode` / `tsSourceFile` を **追加** する形 (案 a)。`node` (ts-morph) は M3 まで残置。
- **D2**: `parseSource` は `src/parser/parseSource.ts` に新設し、dup 側は re-export に縮小 (案 a)。
- **D3**: ts-only walk ヘルパは新ファイル `src/collectors/walk-ts.ts` で提供 (案 a)。M3 で旧 `walk.ts` を削除し `walk-ts.ts` を `walk.ts` にリネーム予定。
- **D6**: `setParentNodes: true` のまま (案 a) — dup 側と一致、cognitive collector の parent 参照に必要。

実装メモ:

- `src/collectors/internal/declarationHelpers.ts` は M1 では作らず、具体の consumer が出る M2-1 で導入する (YAGNI)。
- `parseSource.test.ts` は dup 側に既存テストが無かったので新規作成。`scriptKind` / `parseDiagnostics` は public API ではなかったため、AST 構造 (`JsxSelfClosingElement` の有無) で TSX/TS の振る舞いを assert している。
- `walk-ts` の挙動: nested function declaration に到達した時点で **その関数自身を visit せず** に return する (旧 `walk.ts` と同一)。テストもこの挙動を assert。

### M2-1 (2026-05-01)

- **D4**: テスト fixture ヘルパは `src/collectors/internal/parseFirstFunctionLike.test-helper.ts` に新設 (案 a)。`parseFirstFunctionLike(text, ext?)` と `parseAllFunctionLikes(text, ext?)` の 2 関数を提供 (nested function を扱う既存テストのため後者も用意)。
- **D5 (部分)**: `compute*` ヘルパのシグネチャを `(node: FunctionLikeTsNode, sourceFile: ts.SourceFile)` (parameter-count のみ sourceFile 不要) に変更。collector からは `decl.tsNode` / `decl.tsSourceFile` を渡す。

実装メモ:

- `declarationHelpers.ts` は M2-1 でも作らなかった。complexity collectors では `getBody` / `getOwnName` のヘルパが各 collector ローカルで足り (cognitive と max-nesting-depth が共通の `getBody` を持つ程度の重複)、共有ヘルパを切り出す YAGNI 判定。M2-2 / M2-3 で他 collector が同様のヘルパを欲しがった時点で再評価する。
- `BinaryExpression` の `getChildren()` ループは `ts.forEachChild` に置換。tokens (`operatorToken`) は構造的子ではないため `forEachChild` でスキップされるが、collector はトークンをカウントしないので score に影響なし (cognitive.test.ts 全 22 ケース pass で確認)。
- 出力 dogfood: `node src/index.ts comp --format json --limit all --verbose` を pre/post で取得。`src/collectors/complexity/` 配下を除く 54 関数中 50 関数 (jq で除外) の metrics は **bit-identical**。complexity 配下の 4 ファイルは自身を書き換えたので metrics と bodyHash が変わる (期待動作)。
- 副次効果: 書き直した cognitive.ts の `visit` arrow が `cognitiveComplexity 44 → 26`, `calleeCount 54 → 16` に低下 (ts-morph の chained method calls が直接 field access に置き換わったため)。挙動変化ではなく実装の slimming。

### M3 (2026-05-01)

- **D1 後半**: `Declaration.node` (ts-morph) を削除し、`tsNode` → `node`、`tsSourceFile` → `sourceFile` にリネーム。`FunctionLikeTsNode` も `FunctionLikeNode` にリネームして旧 ts-morph 名と入れ替え。
- **D5 (b)**: `Declaration.node` の最終型は `ts.FunctionDeclaration | ts.MethodDeclaration | ts.ArrowFunction | ts.FunctionExpression | ts.GetAccessorDeclaration | ts.SetAccessorDeclaration | ts.ConstructorDeclaration` の union (M2-1 で導入した specificity を維持)。
- **D7**: `CollectorContext.project` を完全削除。`AggregateContext` から `project` を渡す呼び出し側 (cli.ts の `prepare()`、aggregate.test.ts の fixture) も同期して削除。
- **D8**: `enumerate-source-files.ts` 物理削除 + `cli.ts` の `prepare()` が `loadProject` の戻り値 (`SourceFileInfo[]`) を直接 `enumerateDeclarations` / `aggregate` に渡す形へ。`SourceFileInfo` 型は `src/loader/types.ts` (新設) に再定義し、collector / aggregator / churn / dismiss CLI の import 経路を新パスに付け替え。
- **`enumerateDeclarations` のシグネチャ簡素化**: `(project, rootDir, options)` から `(files, options?)` に縮約。`rootDir` は実装内で使われなくなったので落とした (filter は `info.path` の文字列照合のみ)。
- **`loadProject`**: `Project` インスタンスを返す形から、`{ files: SourceFileInfo[] }` を返す形に変更。`sources` (absolute / relative ペア) を受け取り、`fs.readFileSync` + `parseSource` で各ファイルを 1 回ずつ parse する。読み込み失敗 (削除済み等) は silently skip。
- **walk.ts 物理統合**: 旧 `walk.ts` (ts-morph) を `git rm`、`walk-ts.ts` を `git mv walk.ts` にリネーム。すべての collector の import を `../walk-ts.ts` → `../walk.ts` に戻した。`walk-ts.test.ts` も `walk.test.ts` にリネーム。
- **dup 側 parseSource 統合**: `src/duplication/indexer/parseSource.ts` (re-export shim) を物理削除し、dup 内の 11 ファイルの import 経路を `../../parser/parseSource.ts` (もしくは相対深度合わせ) に直接付け替え。`src/duplication/indexer/index.ts` の re-export 行も同じ src を指すよう更新。
- **package.json**: `dependencies.ts-morph` 行削除 → `pnpm install` で lockfile から `ts-morph` および推移依存 (`@ts-morph/common`, `code-block-writer`, `mitt`) が消えることを確認。

### M3 (2026-05-01) - 実装メモ

- **テスト fixture ヘルパ追加**: `src/collectors/internal/mkSourceFiles.test-helper.ts` を新設。`mkSourceFiles({ "src/a.ts": "...", ... })` で `SourceFileInfo[]` を返す。`Project + createSourceFile` パターンが残っていた 8 collectors の "...Collector" describe ブロックすべてをこれに付け替え。aggregate.test.ts も同じヘルパに統一。
- **enumerate-declarations.test.ts のリファクタ**: 旧テストは `/proj/src/a.ts` のような absolute-style key に rootDir filtering を期待していたが、新 API では `info.path` ベースのフィルタリングなので `src/a.ts` 形式のキーに置き換え。"skips files outside rootDir" ケースは新 API のスコープ外 (caller 責務) になったので削除。`node_modules` ケースは `node_modules/lib/index.ts` 形式で再構成。
- **dogfood 結果**: pre/post の `comp` 出力を比較し、**29 個ある analyze 対象ファイルすべて** で `metrics` + `bodyHash` + 出力順序が **bit-identical**。`sourceFileCount` 130 → 127 と `functionCount` 615 → 612 の差は、本 commit が削除した 3 ファイル (`enumerate-source-files.ts`、旧 `walk.ts`、dup `parseSource.ts` shim) と、まだ untracked のため `git ls-files` に拾われていない 2 ファイル (`loader/types.ts`、`mkSourceFiles.test-helper.ts`) の足し引き。挙動変化ではなく、リポジトリの構造変化。
- **strip-only**: `pnpm check:strip-only` green。新規ファイル (`loader/types.ts`、`mkSourceFiles.test-helper.ts`) は `enum` / `namespace` / parameter properties を踏まず。
- **bench (D10)**: 本コミットでは未計測。Project 構築コストが消えた分だけ軽くなっているはずだが、CHANGELOG 値がほしくなった時点で `pnpm bench` を回す方針に倒した (本計画の bottleneck ではない)。

### M2-2 (2026-05-01)

- 4 collector (`await-count` / `mutation-count` / `try-catch-count` / `callee-count`) を機械的に ts-only に置換。共通点として全て `walkBodyExcludingNestedFunctions` に依存していたので、import 元を `../walk.ts` → `../walk-ts.ts` に切替。
- `await-count` の `forOf.isAwaited()` → `(forOf as ts.ForOfStatement).awaitModifier !== undefined` に置換。
- `mutation-count` の prefix/postfix unary は ts-morph で `getOperatorToken()` が直接 SyntaxKind を返す API だった (BinaryExpression の `getOperatorToken()` は token node を返す API と非対称)。ts では `(node as ts.PrefixUnaryExpression).operator` が SyntaxKind なので、対称性は raw ts のほうが綺麗。
- 出力 dogfood: `src/collectors/effects/` と `src/collectors/call-graph/` を除いた 50 関数で metrics bit-identical を確認。

実装メモ:

- `getBody` ヘルパが今や 6 collector (cognitive, max-nesting-depth, await-count, mutation-count, try-catch-count, callee-count) で重複。M3 で `Declaration` から ts-morph `node` を消す段階で `decl.tsBody` を生やすか、`internal/getBody.ts` を切り出す判断に持ち越し。本 M2-2 では機械的置換に集中し、共通化は後回し。

### M2-3 (2026-05-01)

- `computeBodyHash(node: ts.Node, sourceFile: ts.SourceFile)` にシグネチャ変更し、`node.getText()` → `node.getText(sourceFile)`。collector / aggregator 経路では sourceFile が常に取れるので runtime には影響しない。
- 呼び出し側 2 箇所を更新: `src/aggregator/aggregate.ts` (`d.tsNode, d.tsSourceFile` 渡し)、`src/cli/dismiss.ts` (同上)。
- `hash.test.ts` を `parseFirstFunctionLike` ベースに置換。`Project + getFirstDescendantByKindOrThrow(FunctionDeclaration)` パターンを `parseFirstFunctionLike` の 1 行に集約 (テスト 6 件)。
- `aggregate.test.ts` は **意図的に Project ベースのまま据置**。`enumerateDeclarations` が依然 ts-morph `Project` を要求するため、ここを書き換えるなら M3 で `enumerateDeclarations` ごと移行する必要がある。M2-3 のスコープ越え。
- 出力 dogfood: pre/post の `comp` 出力を全 54 関数で diff。修正したファイル `src/cli/dismiss.ts` の 1 関数 (3 行追加) 以外は **bodyHash bit-identical**。`getText()` ↔ `getText(sourceFile)` の置換が無害であることを確認。

実装メモ:

- `computeBodyHash` の引数追加は API breaking だが、本 repo 内の caller (aggregate / dismiss CLI / テスト) のみで完結するので破壊範囲は閉じている。外部 SDK ではない。
