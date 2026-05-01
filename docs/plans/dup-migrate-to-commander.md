# dup を commander に移行する計画

## ゴール

`comp` と `dup` のヘルプ表示・引数解析の "ガワ" を統一する。具体的には:

- `ts-hotspots --help` のサブコマンド一覧で、`dup` の行が `[args...]` ではなく
  `[options] [path]` で表示される。
- `ts-hotspots dup --help` が commander の自動整形ヘルプになり、`comp --help`
  と並べて見たときにフォーマットが揃って見える。
- 内部のパーサが `node:util.parseArgs` から commander へ一本化され、
  CLAUDE.md の "Keep `comp` and `dup` flag surfaces in sync" 規律が
  「2 つのパーサを並走させる規律」から「1 つのパーサに揃った状態を維持する規律」へ
  軽くなる。

## 背景

現状は二段構えになっている:

- 外側 (`src/cli.ts:303-314`) は commander の `duplication [args...]` を
  `.helpOption(false).allowUnknownOption(true)` で透過させ、argv を素のまま
  内側へ転送している。
- 内側 (`src/duplication/cli/args.ts`) は `node:util.parseArgs` で argv を
  解釈し、ヘルプは手書きの `USAGE` 定数 (97-166行) を stderr に流している。

過去の判断記録は `docs/plans/unify-comp-and-dup.md:78,105,195`:
- 「CLI パーサは統一しない (表面挙動が一致していれば実装の足並みを揃える価値は薄い)」
- 「commander vs parseArgs はそれぞれ選択理由がある (commander は dismissal subcommands を扱いやすい、parseArgs は依存ゼロで dup 単体テスト容易)」
- 「ヘルプの見た目が違うので "ツールの一体感" を損なう。本格的な統一は本計画のスコープ外」

このスコープ外と置かれた "本格的な統一" を今回やる、というのが本計画の位置づけ。

ts-hotspots の文脈では parseArgs を選んだ理由のうち「依存ゼロ」はもう成立しない
(commander は `comp` 側ですでに使っている)。残る理由は単体テストの容易さだけだが、
これは commander 側でも `program.exitOverride()` + `program.configureOutput()`
で同等に確保できる (実際 `src/cli.ts:892-897` でやっている)。

## 影響範囲の調査結果

`dup` 側 CLI で commander 化が必要な要素:

| 機能                              | 現実装                                           | commander での扱い                                               |
| --------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------- |
| `[path]` 位置引数                 | `parseArgs` の positional                        | `.argument("[path]")`                                            |
| `--diff <revrange>`               | string + `parseRevRange` 後処理                  | `.option("--diff <revrange>", ..., parseRevRangeOrThrow)`        |
| `--ref <ref>`                     | string                                           | `.option("--ref <ref>", ...)` + 後処理で `--diff` と排他検証     |
| `--format markdown\|json`         | string + `parseFormat`                           | `.option("--format <markdown\|json>", ..., parseFormat)`         |
| `-e, --exclude <glob>` (反復)     | `multiple: true`                                 | `comp` と同じ `collectExcludeGlob` collector を再利用            |
| `--phase-timings[=LEVEL]`         | argv プリ正規化 (`normalizePhaseTimings`) + string | `.option("--phase-timings [level]", ...)` で optional value 表現 |
| `--limit <N\|all>`                | string + `parseLimit`                            | `comp` の `parseLimit` をそのまま使い回す                        |
| `--verbose`                       | boolean                                          | `.option("--verbose", ...)`                                      |
| `--churn-window <N>`              | string + `parseChurnWindow`                      | `.option("--churn-window <N>", ..., parseChurnWindow)`           |
| `--churn-ref <ref>`               | string                                           | `.option("--churn-ref <ref>", ...)`                              |
| `--no-churn`                      | `"no-churn": { type: "boolean" }`                | commander ネイティブの `.option("--no-churn", ...)`              |
| `-h, --help`                      | `parseCliArgs` が `{ kind: "help" }` を返す      | commander の自動 help (`exitOverride` で `commander.helpDisplayed` を捕捉) |

設計判断が必要なポイント:

1. **`USAGE` 定数の扱い**。commander の auto help はオプション説明が中心で、
   現在の `USAGE` にある narrative (冒頭 4 行の "By default the entire repository
   ..." と revrange 4 形式の解説、Examples セクション、末尾の dismissalId 説明)
   をどう保持するか。`program.description()` と `program.addHelpText("after", ...)`
   に分割して全文残せる。
2. **`--help` の出力先**。現在 dup は USAGE を **stderr** に書いている
   (`main.ts:273`)。commander の既定は **stdout**。`comp` は commander 既定なので
   `comp --help` は stdout に出ている。揃える先は stdout (Unix の慣行: 明示的
   `--help` は stdout、エラー時のヒントは stderr) とする。`main.test.ts:67-75`
   が stderr を assert しているので併せて修正。
3. **`parseCliArgs` の公開 API**。`args.test.ts` の 30+ テストが `parseCliArgs`
   を直接呼んでいる。実装を commander に乗せ替えても、戻り値の形
   (`ArgsResult = ParsedArgs | { kind: "help" }`) と `ArgParseError` の throw
   契約は保てる。テスト書き換えはなしで済む方針。
4. **`main(argv, io)` のテスト面**。M7 で確立した "process.exit を呼ばずに
   exit code を返す" 契約 (`main.ts:223-245` の docstring) は維持必須。
   commander 化しても `program.exitOverride()` で同じ振る舞いを作れる。
5. **外側 cli.ts との関係**。dup を commander のサブコマンドとして
   ルートプログラムに直接登録すると、`ts-hotspots --help` のサブコマンド一覧で
   `[args...]` ではなく `[options] [path]` がそのまま表示される (今回のゴールの
   1 つ)。一方で `main(argv, io)` 経由のテストでも同じ surface を使いたいので、
   サブコマンド登録のロジックは関数化して 2 箇所から呼ぶ。

## Approach

**dup の commander option 設定を 1 つの登録関数 (`addDuplicationCommand`) に
切り出し、ルートプログラムと dup 単体テスト用の private program の両方から
同じ関数を呼ぶ**。これにより:

- 1 つの設定が事実上の "single source of truth" になる (parseArgs と USAGE が
  分かれていた状態が、1 関数に集約される)。
- ルートプログラム経由の本番呼び出しでは `[args...]` 透過が消え、
  `ts-hotspots --help` でも `dup --help` でも commander のヘルプ整形がそのまま
  使われる → ヘルプ表示が `comp` と揃う。
- `main(argv, io)` は `addDuplicationCommand` を private program に呼んで
  parseAsync する薄いラッパに縮む。テストの surface は変えずに維持。
- `parseCliArgs` は内部実装を commander に置き換えるが、公開シグネチャは保つ。
  `args.test.ts` は無変更で動き続ける。

`USAGE` 定数は廃止し、narrative は `program.description()` と
`program.addHelpText("after", ...)` に分割移植。Examples も `addHelpText` で残す。

CLI invocation の `PendingInvocation` (src/cli.ts) からは
`{ kind: "duplication", argv }` discriminant を削除できる
(action handler が dup ランナーを直接呼ぶようになるため)。

## ファイル別の変更

### 新規: `src/duplication/cli/registerCommand.ts`

```ts
export interface DuplicationHandlers {
  io: MainIO;
  // action handler が parseCliArgs 後の ParsedArgs を受け取り
  // detector pipeline を回して exit code を返す。run() は main.ts から
  // 移植 (現 main.ts 250-372 行のパイプライン本体)。
  run: (args: ParsedArgs, io: MainIO) => Promise<number>;
}

export function addDuplicationCommand(
  parent: Command,
  handlers: DuplicationHandlers,
): Command;
```

責務:
- `parent.command("duplication").alias("dup")` を生やす。
- すべての option (`--diff`, `--ref`, `--format`, `--exclude`, `--phase-timings`,
  `--limit`, `--verbose`, `--churn-window`, `--churn-ref`, `--no-churn`) を登録。
  custom value parser は既存の `parseRevRange` / `parseLimit` /
  `parseChurnWindow` / `parseFormat` をそのまま使い、`comp` と共有できるものは
  共有する (`collectExcludeGlob` は既存)。
- `description()` と `addHelpText("after", ...)` で narrative + Examples を保持。
- `.action()` で commander 由来の `opts` から `ParsedArgs` を組み立て、
  `--diff` と `--ref` の排他検証 / `--churn-ref` の空文字検証 / 位置引数の
  個数検証を実施し、エラーは `ArgParseError` を throw → commander の
  exitOverride で捕捉される。OK パスは `handlers.run(parsed, handlers.io)`。

### 変更: `src/duplication/cli/args.ts`

- `OPTIONS` / `ParsedValues` / `normalizePhaseTimings` / `parseChurnConfig` /
  `parseExcludeGlobs` を削除。
- `parseFormat` / `parseLimit` / `parseChurnWindow` / `parsePhaseTimingsLevel`
  / `parseRevRange` 呼び出しを `registerCommand.ts` に移し、必要なものは export
  しておく。
- `parseCliArgs(argv)` は内部で private な `Command` を作って
  `addDuplicationCommand` を呼んで parseAsync し、エラーを `ArgParseError` に
  ラップする実装に書き換え (公開シグネチャ維持)。`{ kind: "help" }` は
  exitOverride 例外の `code === "commander.helpDisplayed"` を検知して返す。
- `USAGE` は削除 (narrative は registerCommand.ts に移動済み)。
- `ArgParseError` クラスは残す (テスト依存)。
- `args.test.ts` の動作は維持される想定 (要確認)。

### 変更: `src/duplication/cli/main.ts`

- `main(argv, io)` は private program を作り、`addDuplicationCommand(program,
  { io, run: runPipeline })` を呼んで `program.parseAsync(["node", "dup", ...argv])`
  するだけのラッパに縮める。
- 現 `main` 関数本体 (250-372 行) のパイプライン実行部分は `runPipeline(args,
  io)` に切り出し、`addDuplicationCommand` の handler から呼ばれる。
- `--help` 系の handling は不要 (commander が処理)。USAGE import も不要。
- `sniffFormat` は残す (commander の parse エラーでも `--format json` を尊重
  したいので、exitOverride で捕まえた段階で argv から sniff する)。
- `--help` 出力先を stdout へ。`writeError` 系は引き続き stderr。

### 変更: `src/cli.ts`

- `program.command("duplication")` の現行 18 行 (303-314 行) を、
  `addDuplicationCommand(program, { io: { stdout, stderr, cwd: ... }, run:
  runPipeline })` の呼び出し 1 行に置換。`.helpOption(false)` /
  `.allowUnknownOption(true)` / `.argument("[args...]")` は不要。
- `PendingInvocation` から `{ kind: "duplication"; argv: string[] }`
  discriminant を削除。
- `run()` 内 `if (invocation.kind === "duplication")` 分岐 (931-937 行) を削除。
  dup の action handler が直接 `runPipeline` を呼ぶ。

### 変更: `src/duplication/cli/main.test.ts`

- `it("prints usage on --help and returns 0")` (67-75 行) を **stdout** assert
  に変更。`Usage:` の文字列も commander フォーマット (`Usage: ts-hotspots
  duplication [options] [path]`) に揃える。
- 他のテストは原則無変更で通る想定 (e2e)。

### 変更: `CLAUDE.md`

- "CLI flag conventions" 節を書き換え:
  - 「2 つの parser は独立している」前提が消える。
  - `comp` / `dup` で commander option 設定を別々に書く前提のもとで
    「mirror it, document a justified asymmetry, or align the spelling」という
    規律はそのまま有効。
  - `--phase-timings` の dup-only 性、`--ref` の dup-only 性などの
    structural asymmetries の列挙は維持。

### 変更: `docs/plans/unify-comp-and-dup.md`

- 末尾に "M-post: parser 統一" 節を追記し、本計画でクローズしたことと、
  `M1 bullet 5` で残した "ヘルプ形の目視一致" がコードレベルで揃ったことを
  記録。

## 動作確認

- 既存 763 テスト全パス。`args.test.ts` は無変更で通ること、`main.test.ts:67`
  の help test は stderr → stdout に変えて通ること。
- 手で `pnpm start --help` / `pnpm start dup --help` を打って、`comp --help`
  と並べたときにフォーマット (列幅、`Usage:` 行、`Options:` セクション、
  description の出方) が揃って見えることを目視確認。
- `pnpm start dup --phase-timings` / `dup --phase-timings=verbose` /
  `dup --phase-timings verbose` の 3 形式が引き続き受理されること。
- `pnpm start dup --ref main --diff main..feature` が排他エラーで exit 1
  すること。
- `pnpm start dup --format json --no-such-flag` が JSON 形式のエラー envelope
  を stdout に、ヒントを stderr に書いて exit 1 すること (= 現状を維持)。

## 残るリスク

- **commander の help format がコミット間で微妙に変わる可能性**。固定バージョン
  (`commander@14.0.3`) でロックされているので、依存更新時にヘルプスナップショット
  に diff が出る可能性はある。今回テストはスナップショットを取らない方針
  (実装詳細に縛られすぎる) なので、依存更新時に目視確認すれば足りる。
- **`--phase-timings` の optional value**。commander の `[value]` 構文は
  「次の引数が flag っぽくなければ値として食べる」挙動。`dup --phase-timings
  src/foo.ts` のように後続が positional だと `phase-timings = "src/foo.ts"`
  として誤って吸い込まれる懸念がある。実装時に Examples のケース 3 形式
  (`--phase-timings`, `--phase-timings=verbose`, `--phase-timings verbose`) と
  positional 同居時の挙動をテストで pin する。
- **`USAGE` を読みに来る外部参照**。現状 `USAGE` を export していて
  `src/duplication/cli/main.ts:26` でしか参照されていないが、ユーザーが
  プログラム的に読むケースは想定外。削除して問題ない。
- **dismissalId の help 末尾説明**。USAGE の最終段落 (162-165 行) は
  `addHelpText("after", ...)` で残す。`comp` 側にも dismissalId の説明があるので
  並びを揃えてもよい (今回のスコープ外)。
