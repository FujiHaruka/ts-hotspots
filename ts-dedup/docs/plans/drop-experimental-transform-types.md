# `--experimental-transform-types` を外して strip-only モードで動かす

## 背景

Node 24 (および 23.6+) は TypeScript ソースを直接実行できるが、デフォルトは
**strip-only モード**で、TS 型注釈を空白に置換するだけ — JavaScript として
意味を持つコードは TS 専用構文であっても出力できない。`--experimental-transform-types`
を付けて初めて parameter property / enum / namespace 等が JS にトランスフォーム
される。

現状 `pnpm start` (`node src/index.ts`) は素では失敗する:

```
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]:
TypeScript parameter property is not supported in strip-only mode
  at src/cli/perfLog.ts:27
```

`bench:*` スクリプトはすべて `--experimental-transform-types --disable-warning=ExperimentalWarning`
を明示的に付けて回避している。

このフラグを使い続けるとユーザーが Experimental warning を踏みやすく、また
将来的に Node が strip-only を正式版・transform を experimental のまま据え置く
方針なので、ソース側を strip-only 互換に揃えたほうが長期的に安全。

## 調査結果 (現時点での非互換構文の網羅)

`src/`, `tools/`, `test/` (フィクスチャ除く) を網羅 grep した結果、strip-only
で NG になる構文は **parameter property のみ**で、以下 2 ファイル 4 箇所:

| 場所 | 構文 |
| --- | --- |
| `src/cli/perfLog.ts:27` | `private readonly out: NodeJS.WritableStream` |
| `src/cli/perfLog.ts:28` | `public readonly level: PhaseTimingsLevel` |
| `src/cli/perfLog.ts:42` | `public readonly level: PhaseTimingsLevel = "summary"` |
| `src/indexer/internal/fragmentId.ts:14` | `private readonly filePath: string` |

NG 候補として一緒に確認したが**該当なし**:
- `enum` / `namespace` / `module` ブロック宣言: 0 件
- `import = ` / `export = `: 0 件
- decorator: 0 件 (TS の experimentalDecorators は無効)

つまり、上記 2 ファイルを書き換えるだけで strip-only モード対応は完了する。

## Approach

1. **2 ファイルだけソース修正**: parameter property を「明示フィールド宣言 + コンストラクタ内代入」の標準形に書き換える。挙動は完全に等価で、`isolatedModules` / `verbatimModuleSyntax` 環境でも追加コストはない。
2. **`package.json` のフラグ撤去**: `bench:*` 5 本から `--experimental-transform-types --disable-warning=ExperimentalWarning` を削除。同時に `start` は元々素で書かれているのでそのままで OK。
3. **`engines.node` を `>=24`** に引き上げる: strip-only のデフォルト ON は Node 23.6 以降。但し `--experimental-transform-types` を撤去した瞬間、Node 22 系では parameter property 等が将来追加された場合に不可。`pnpm test` / CI も Node 24 想定なので明示的に縛る。
4. **CLAUDE.md / 関連ドキュメント更新**: 「`--experimental-transform-types` で実行」と書いてある箇所を「Node 24+ で素実行」に書き換え。歴史的記述である `docs/plans/whole-repo-perf.md` 等の旧文書はそのまま (履歴なので)。
5. **検証**: `pnpm start` (= `node src/index.ts`) がフラグなしで CLI ヘルプを出すこと、`pnpm typecheck` / `pnpm test` / `pnpm bench` が回ることを最後に確認。

修正は機械的で、ロジックを一切変えない。`tsc --noEmit` の結果が修正前後で
同一であることが正しさの最終保証になる。

## 別エージェント作業中の注意

現在 `src/domain/report.ts` / `src/domain/cloneGroup.ts` 周辺を別エージェントが
編集しており、`jsonReport.ts` / 各 `.test.ts` で `CloneCandidateReport` 関連の
型エラーが出ている。本タスクはその領域とは**完全に独立**しており、触るのは
`src/cli/perfLog.ts` と `src/indexer/internal/fragmentId.ts` の 2 ファイルだけ。
コンフリクトの心配はない。ただし作業を始める前に最新の `git status` で別
エージェントが本ファイルに来ていないか念のため確認する。

## ファイル別の書き換え

### `src/cli/perfLog.ts`

`JsonlPerfLogger` (現状 L24-37):

```ts
export class JsonlPerfLogger implements PerfLogger {
  private readonly start: number;
  constructor(
    private readonly out: NodeJS.WritableStream,
    public readonly level: PhaseTimingsLevel,
  ) {
    this.start = performance.now();
  }
  emit(name: string, payload: Record<string, unknown>): void {
    const ts = round2(performance.now() - this.start);
    const line = `${JSON.stringify({ ts, event: name, ...payload })}\n`;
    this.out.write(line);
  }
}
```

→

```ts
export class JsonlPerfLogger implements PerfLogger {
  private readonly start: number;
  private readonly out: NodeJS.WritableStream;
  readonly level: PhaseTimingsLevel;
  constructor(out: NodeJS.WritableStream, level: PhaseTimingsLevel) {
    this.out = out;
    this.level = level;
    this.start = performance.now();
  }
  emit(name: string, payload: Record<string, unknown>): void {
    const ts = round2(performance.now() - this.start);
    const line = `${JSON.stringify({ ts, event: name, ...payload })}\n`;
    this.out.write(line);
  }
}
```

`RecordingPerfLogger` (現状 L40-46):

```ts
export class RecordingPerfLogger implements PerfLogger {
  readonly events: { name: string; payload: Record<string, unknown> }[] = [];
  constructor(public readonly level: PhaseTimingsLevel = "summary") {}
  emit(name: string, payload: Record<string, unknown>): void {
    this.events.push({ name, payload: { ...payload } });
  }
}
```

→

```ts
export class RecordingPerfLogger implements PerfLogger {
  readonly events: { name: string; payload: Record<string, unknown> }[] = [];
  readonly level: PhaseTimingsLevel;
  constructor(level: PhaseTimingsLevel = "summary") {
    this.level = level;
  }
  emit(name: string, payload: Record<string, unknown>): void {
    this.events.push({ name, payload: { ...payload } });
  }
}
```

呼び出し側 (新規 `JsonlPerfLogger(stream, level)` / `new RecordingPerfLogger()` /
`new RecordingPerfLogger("verbose")`) は引数の位置・順序が変わらないので
影響なし。`PerfLogger` インターフェースの `readonly level` も引き続き満たす。

### `src/indexer/internal/fragmentId.ts`

現状 (L11-30):

```ts
export class FragmentIdAllocator {
  private readonly counts = new Map<string, number>();

  constructor(private readonly filePath: string) {}

  allocate(...) { ... }
}
```

→

```ts
export class FragmentIdAllocator {
  private readonly counts = new Map<string, number>();
  private readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  allocate(...) { ... }
}
```

### `package.json`

`scripts` ブロックの `bench:*` 5 本から
`--experimental-transform-types --disable-warning=ExperimentalWarning` を削除:

```diff
-    "bench": "node --experimental-transform-types --disable-warning=ExperimentalWarning tools/bench/index.ts",
-    "bench:scale": "node --experimental-transform-types --disable-warning=ExperimentalWarning tools/bench/scale.ts",
-    "bench:sweep": "node --experimental-transform-types --disable-warning=ExperimentalWarning tools/bench/sweep.ts",
-    "bench:sweep-self": "node --experimental-transform-types --disable-warning=ExperimentalWarning tools/bench/sweepSelf.ts",
-    "bench:ngram": "node --experimental-transform-types --disable-warning=ExperimentalWarning tools/bench/microNgramBuild.ts",
+    "bench": "node tools/bench/index.ts",
+    "bench:scale": "node tools/bench/scale.ts",
+    "bench:sweep": "node tools/bench/sweep.ts",
+    "bench:sweep-self": "node tools/bench/sweepSelf.ts",
+    "bench:ngram": "node tools/bench/microNgramBuild.ts",
```

`engines`:

```diff
   "engines": {
-    "node": ">=22"
+    "node": ">=24"
   },
```

`vitest` も Node 経由で TS を読むが、Vitest 4 系は内部で esbuild を持っていて
ノードの type-stripping には依存しないので変更不要。

### `CLAUDE.md`

「Conventions」セクション内、

```
- Source runs directly via Node's `--experimental-transform-types`; no compile step is needed for tests or the bench harness.
```

を、

```
- Source runs directly under Node 24+ type stripping; no flags or compile step needed for `pnpm start`, tests, or the bench harness.
```

に書き換える。`docs/plans/npm-publish.md` / `docs/plans/whole-repo-perf.md` の
言及は計画書 (履歴) なので**触らない**。

## 検証手順 (実装後にこの順で実行)

1. `pnpm typecheck` — 型エラーが追加されていないこと。別エージェントが触っている `report.ts` 由来の既存エラーは残るが、それ以外は出ないこと。
2. `node src/index.ts` (フラグなし) — CLI のヘルプメッセージが出ること。`ExperimentalWarning` も出ないこと。
3. `pnpm test` — 既存テストが緑のままであること。`PerfLogger` 系は `cli/perfLog.test.ts` 等でカバーされている想定。
4. `pnpm bench:ngram` (一番軽い) — フラグなしで起動・完走すること。
5. `pnpm build` — `dist/index.js` が出力され、`node dist/index.js` が同じヘルプを出すこと。

## ロールバック

すべて `git revert` 1 回で戻る。挙動を変えていないので、もし何らかの理由で
strip-only モードで再度トラブルが出ても、元のフラグ付き運用に戻すだけで済む。

## やらないこと

- `bench` 用フィクスチャ (`test/fixtures/suite/**`, `tools/bench/baseline/**`) の触り直し: typecheck / Vitest / Biome 全部で除外されており、Node の type-stripping も通らない (= 走らせない) ので無関係。
- TS の `enum` / `namespace` 利用箇所への移行: 元から 0 件なので不要。
- `vitest.config.ts` への手当て: Vitest は esbuild 経由、Node の strip-only モードを通らないため。
