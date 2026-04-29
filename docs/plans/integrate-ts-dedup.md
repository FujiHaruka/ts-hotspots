# ts-dedup 統合プラン

`ts-dedup/` 配下にコピーした重複検出 CLI を `ts-hotspots` の機能として取り込む。
最終形は **2 段階**:

- 段階1 (案A): 既存の `ts-hotspots` 分析と並ぶ **サブコマンド** として
  `ts-hotspots dedup` を提供する。コードツリーは1つ、bin は1つ。
- 段階2 (案B): 両者を統合した `ts-hotspots scan` を提供し、単一 JSON で
  「気になる場所一覧」を返す。

本プランは段階1 (M0–M4) を必達のスコープとし、段階2 (M5–M6) は段階1 の
利用フィードバックを受けて着手する。

## コンテキスト

### 現状
- `ts-hotspots/` 直下: 関数/ファイルの "hotspot" を返す CLI。`ts-morph` ベース。
  bin: `ts-hotspots`。サブコマンドは `dismiss` / `list-dismissed` / `undismiss`。
  デフォルト動作 (引数なし) はプロジェクト分析。
- `ts-hotspots/ts-dedup/`: 直前にコピーされた Type-3 重複検出 CLI。`typescript`
  パッケージのみを使い、PR モードと whole-repo モードを持つ。bin: `ts-dedup`。
- 設定はそれぞれ独立: `tsconfig.json`、`biome.json`、`vitest.config.ts`、
  `package.json`。oxlint 設定は親側に1つだけ存在 (`.oxlintrc.json`)。

### 性質
- どちらも「下流のコーディングエージェントに座標を渡すツール」で、判断は
  下流に任せる。recall 寄り。
- どちらも Node 24+ の type stripping で TS 直接実行 (`pnpm start`) する設計。
  `ts-dedup` は strip-only 互換性を `tools/check-strip-only.ts` でガード。
- `ts-hotspots` の内部依存は `ts-morph` / `commander` / `minimatch`。
  `ts-dedup` の内部依存は `typescript` のみ (パーサ直叩き)。
- `ts-dedup` は git 子プロセスを直接呼ぶ (`gitRunner.ts`)。これは
  `ts-hotspots` の churn collector と方式が近い。

### 段階1 のユーザー向け CLI 像

```
ts-hotspots [path]                          # 既存通り (= 関数/ファイル分析)
ts-hotspots dedup [path]                    # whole-repo の重複候補 JSON
ts-hotspots dedup [path] --base X --head Y  # PR 差分の重複候補 JSON
ts-hotspots dismiss <id> --reason ...       # 既存
ts-hotspots list-dismissed                  # 既存
ts-hotspots undismiss <id>                  # 既存
```

`dedup` サブコマンドは ts-dedup の現行 CLI フラグ
(`--format`、`--limit`、`--exclude`、`--phase-timings`、`--no-code` など) を
そのまま引き継ぐ。出力スキーマは段階1 では ts-dedup の `CloneCandidateReport`
を維持する (統合スキーマ設計は段階2 のスコープ)。

## Approach

「コードツリーを1つに統合 → CLI を1つに統合 → ドキュメントを1つに統合」
の順で進める。理由:

- ツリー統合を先にやらないと、CLI 配線で import 解決とテスト走行が二重管理に
  なる。ツリーが先に1本化されていれば、CLI 統合は commander の subcommand 配線
  だけで済む。
- ドキュメントは統合された挙動が固まってから書く。先に書くと「移行直後に
  もう一度書き直す」コストが二重になる。

各マイルストーンは **その段で `pnpm typecheck` / `pnpm test` / `pnpm lint` が
グリーン** であることを完成の最低条件とする。

`ts-dedup/` の元ファイルはマイルストーンの中で順次新しい場所へ移動・削除する。
段階1 完了時点で `ts-dedup/` ディレクトリは消える。

## マイルストーン一覧

| # | 名称 | 主な成果物 |
|---|---|---|
| M0 | ✅ 統合前準備 (oxlint / fixture) | コミットが通る状態 |
| M1 | コードツリー統合 | `ts-dedup/` を `src/dedup/` 等へ移し、テスト/型チェックが両方を網羅 |
| M2 | CLI サブコマンド化 | `ts-hotspots dedup` が PR / whole-repo 両モードで動く |
| M3 | リント・lint-staged・pre-commit の一本化 | `pnpm check:strip-only` を含む CI チェックを統合 |
| M4 | ドキュメント統合とリリース | README / requirements を書き直し、`ts-dedup/` 完全消去、版上げ |
| M5 | 段階2 設計 (`scan` の RFC) | 統合 JSON スキーマと挙動の決定書 |
| M6 | 段階2 実装 (`scan` コマンド) | `ts-hotspots scan` と単一レポート出力 |

---

## M0. ✅ 統合前準備

### 状態
完了。`oxlint` のエラーをゼロにし、fixture 群を ignore に追加した。

### 成果物 (履歴)
- `.oxlintrc.json`: `ignorePatterns` を `**/test/fixtures/**` に拡大。
  `**/tools/**` override で bench 系ルールを緩和。
  test override に `jest/valid-expect: off` (vitest 互換)。
- `ts-dedup/eslint.config.js` 削除 (親は oxlint へ移行済み)。
- ts-dedup 側の実コード違反 4 件を修正 (`no-await-in-loop` の意図的逐次 I/O は
  inline disable、`new Array<T>(n)` は型付き事前確保で inline disable、
  `replaceAll("\x00", " ")` で `no-control-regex` を解消、
  `"?" + " ..."` の無意味連結を解消)。

---

## M1. コードツリー統合

### 目的
`ts-dedup/` のソース・テスト・ツールを親リポジトリのツリーに取り込み、
ビルド/テスト/型チェックを一本化する。CLI 配線はまだ触らない。

### 成果物
- ファイル移動:
  - `ts-dedup/src/*` → `src/dedup/*`
  - `ts-dedup/test/*` → `test/dedup/*` (fixture を含む)
  - `ts-dedup/tools/*` → `tools/*` (bench / check-strip-only)
  - `ts-dedup/docs/*` → `docs/dedup/*`
- 設定ファイルのマージ:
  - `tsconfig.json`: `include` を `["src/**/*", "test/**/*", "tools/**/*", "vitest.config.ts"]`
    に広げる。`exclude: ["test/**/fixtures/**"]` を追加 (現在の hotspots fixture と
    dedup fixture を一括除外)。
  - `tsconfig.build.json`: `include` から `test/**` と `tools/**` を外し、
    bin に必要な `src/**` のみ。
  - `vitest.config.ts`: `include` に `test/**/*.{test,spec}.{ts,tsx,...}` を追加。
  - `biome.json`: `files.includes` を ts-dedup 側と統一して
    `["**", "!**/test/fixtures/**", "!tools/bench/baseline/**"]`。
  - `package.json`: dependencies は親側を採用 (`ts-morph`, `commander`,
    `minimatch`)。`typescript` を dev → runtime に昇格 (ts-dedup が直接使う)。
    devDependencies は ts-dedup 側の `simple-git-hooks` を取り込む (親には
    まだ無いはず — 要確認)。scripts に `bench:*` と `check:strip-only` を移植。
- `ts-dedup/{package.json, pnpm-lock.yaml, pnpm-workspace.yaml, biome.json, tsconfig*.json, vitest.config.ts, eslint.config.js, README.md, LICENSE, CLAUDE.md}` を削除。
- import パスの追従: `ts-dedup/src/*` 内で相対 import `../../` の階層が変わるため
  全置換が必要 (機械的。ただし `.ts` 拡張子は維持)。

### 受け入れ基準
- `pnpm install` 後に `pnpm typecheck` / `pnpm test` / `pnpm lint` が全てグリーン。
- `ts-dedup/` ディレクトリが消えている。
- `pnpm test` で hotspots 既存テスト + dedup の `src/dedup/**/*.test.ts` と
  `test/dedup/**/*.test.ts` の両方が走る (件数で確認)。
- 既存 `ts-hotspots` CLI (`node src/index.ts`) の動作が変わっていない (smoke run)。

### 依存
M0。

### 検討事項
- `tools/bench/` は名前が衝突しないが、将来 hotspots 側にも bench を置きたく
  なったら `tools/dedup-bench/` への分離を検討。M1 では維持で良い。
- `ts-dedup` の README / CLAUDE.md は段階1 の最終形ではない (旧 ts-dedup の
  視点で書かれている)。M1 では削除し、M4 でまとめて書き直す。
- `simple-git-hooks` を親に追加する場合、現行 husky 等の競合がないか確認。
  現状 `package.json` を見るかぎり親側にも `simple-git-hooks` 設定があるので
  そのまま継承すれば良い。

---

## M2. CLI サブコマンド化

### 目的
`src/dedup/cli/main.ts` を `src/cli.ts` の commander ツリーに subcommand として
取り込み、`ts-hotspots dedup` で動かせるようにする。

### 成果物
- `src/cli.ts` に `dedup` subcommand を追加:
  - 第1引数 `[path]` (省略時 cwd) を `repoPath` に渡す。
  - `--base <ref>` と `--head <ref>` の両方が指定された場合は PR モード
    (`runDetector`) に分岐。それ以外 (片方のみ・両方なし) は whole-repo モード
    (`runWholeRepoDetector`) に `--ref` (または HEAD) を渡す。両方指定されつつ
    `--ref` も来た場合はエラー。
  - 既存 `--format` / `--limit` / `--exclude` / `--phase-timings` / `--no-code` /
    `--three-dot` を移植 (ts-dedup の `args.ts` をリファレンスにする)。
- `src/dedup/cli/main.ts` の `parseCliArgs` 部分は使わず、commander に置換。
  `runDetector` / `runWholeRepoDetector` への呼び出しと出力処理 (Markdown/JSON
  レンダリング、stats line、phase timings の JSONL 出力) は維持する。
- `src/index.ts` (bin entry) は変更不要 — `cli.run(process.argv, ...)` 経由で
  subcommand が分岐する。

### 受け入れ基準
- `node src/index.ts dedup --help` で dedup の usage が表示される。
- `node src/index.ts dedup ./test/dedup/fixtures/<small-suite> --base X --head Y`
  で JSON / Markdown が出る (E2E テストを追加)。
- `node src/index.ts dedup ./<repo>` で whole-repo 結果が出る。
- 既存 `ts-hotspots [path]` / `dismiss` 系のテストが回帰していない。
- 終了コード: 候補 0 件でも 0 (検出はツールの責務、CI 失敗判定はユーザー側)。

### 依存
M1。

### 検討事項
- ts-hotspots 既存の引数なしデフォルト挙動 (= 関数分析) は維持する。
  サブコマンド未指定時のデフォルトを変更すると既存ユーザーが壊れる。
- `--format` のデフォルトは ts-dedup が Markdown、ts-hotspots は JSON 寄り。
  `dedup` 側は ts-dedup の慣習 (Markdown デフォルト) を引き継ぐが、要レビュー。
- `dismiss` は ts-hotspots 専用で、dedup の出力には適用しない。M2 では
  `dedup` 結果の dismissal は対象外と明記。M5 以降で再検討。

---

## M3. リント・lint-staged・pre-commit の一本化

### 目的
M1 で取り込んだ `tools/check-strip-only.ts` と `bench` 系を CI / pre-commit に
組み込み、両方のルールを満たす状態を維持できるようにする。

### 成果物
- `package.json` の `simple-git-hooks.pre-commit` を
  `pnpm lint-staged && pnpm typecheck && pnpm check:strip-only` に更新。
- `lint-staged` ルールを oxlint ベースで再定義 (eslint は使わない):
  - `*.{ts,js}`: `biome check --write` → `oxlint --fix`
  - `*.{json,jsonc}`: `biome check --write`
- `tools/check-strip-only.ts` を `src/**` 全体 (hotspots + dedup) に対して
  走るよう確認。hotspots 既存コードが strip-only 違反をしていないかを
  M3 で初めて検証する。違反があれば修正 (likely zero、要 dry-run)。
- `package.json` の `engines.node` を `>=24` に揃える (ts-dedup 由来の制約)。

### 受け入れ基準
- `pnpm check:strip-only` がグリーン。
- 任意の `.ts` を編集してコミットすると lint-staged が走り、oxlint でブロック
  されることが確認できる。
- pre-commit hook 全体の所要時間が許容範囲 (実測で <30s 程度を目安)。

### 依存
M2。

### 検討事項
- hotspots 側に strip-only 違反が見つかった場合、修正するか override するかを
  M3 内で判断。原則は「修正」。違反が多ければ M3 を blocker としてスコープ拡大。

---

## M4. ドキュメント統合とリリース

### 目的
ユーザーから見て「1つの CLI、2つのコマンド」と読めるドキュメント状態にし、
段階1 を版上げしてリリースする。

### 成果物
- `README.md` を全面書き直し:
  - 冒頭で「TypeScript プロジェクトを静的解析して、コーディングエージェントが
    最初に読むべき場所を JSON で返す CLI」と位置付ける。
  - `ts-hotspots` (関数/ファイルランキング) と `ts-hotspots dedup` (重複候補)
    の2機能を並列に紹介する。共通の入出力契約 (TypeScript プロジェクト → JSON)
    と棲み分け (静的指標 vs 重複検出) を1段落で示す。
  - インストール / クイックスタート / 出力例 / よくあるオプション。
  - CLAUDE.md ポリシー (差分ではなく現状を書く) を踏襲。
- `docs/requirements.md` を「hotspots 機能」と「dedup 機能」の2章構成に
  リファクタ。dedup 章は ts-dedup の `requirements.md` を要約・移植する
  (詳細仕様は `docs/dedup/` 配下に残す)。
- `CLAUDE.md` (親): dedup の存在を反映。`ts-dedup/CLAUDE.md` の
  Architecture 節 (パイプライン、`index_/` 命名、決定性、`perfLog` 設計) のうち
  保守者が知るべき要点を移植。
- `package.json`: version を `0.2.0` に。`bin` から `ts-dedup` は最初から無いので
  追加なし。`description` / `keywords` を更新。
- 旧 `ts-dedup/README.md` / `ts-dedup/CLAUDE.md` は M1 で削除済み (再確認)。

### 受け入れ基準
- README を初見の人が読み、5 分以内に `pnpm install` → `ts-hotspots` /
  `ts-hotspots dedup` の両方を走らせられる。
- `docs/requirements.md` 内に「ts-dedup」の表記が残っていない (= 旧プロジェクト
  名の参照漏れがない)。dedup 機能を指すときは「dedup コマンド」「重複検出」
  と書く。
- `pnpm publish --dry-run` が想定ファイル (`dist/`、README、LICENSE) のみ含む。

### 依存
M2、M3。

---

## M5. 段階2 設計 (`scan` の RFC)

### 目的
段階1 のリリース後、利用感を見たうえで `ts-hotspots scan` の挙動と JSON スキーマ
を決める。実装はしない。

### 成果物
- `docs/plans/scan-command.md` (このファイルの兄弟):
  - 想定ユースケース (エージェントへの初期コンテキスト投入、CI レポート、
    手動レビュー前準備など) を列挙。
  - 統合スキーマ案: `{ project, hotspots[], duplications[], dismissed? }`
    の形を spike し、score 軸の正規化、座標表現の統一 (`file:line` か
    `{file, startLine, endLine}` か) を決める。
  - デフォルト挙動の決定: whole-repo dedup は重いため `--include-dedup` が
    必要、PR モード (`--pr X..Y`) のときは dedup を含めるか、など。
  - `--only hotspots|dedup` のセマンティクス。
  - 既存の `ts-hotspots [path]` / `ts-hotspots dedup [path]` との関係
    (alias なのか、scan が新たな第一級なのか)。
- `dogfooding-prompt.md` 相当の「scan を使うエージェントへの誘導文」サンプル。

### 受け入れ基準
- ドキュメントだけで完結。実装変更なし。
- 主要ユースケース3つに対し、スキーマ案で過不足なく応えられることを示す
  例示が含まれる。

### 依存
M4 リリース後の利用フィードバック (本人 dogfooding を含む)。

---

## M6. 段階2 実装 (`scan` コマンド)

### 目的
M5 で決めた仕様に沿って `ts-hotspots scan` を実装する。

### 成果物
- `src/cli.ts` に `scan` subcommand を追加。
- 統合レポートビルダー: `src/scan/buildReport.ts` (仮) が hotspots と dedup の
  内部 API を呼んで単一 JSON を返す。
- Markdown 版 (人間向け概要) と JSON 版の両出力。
- E2E テスト: 小さな fixture リポジトリで `scan --include-dedup --pr X..Y`
  が両軸を含むレポートを返すことを確認。

### 受け入れ基準
- `pnpm typecheck` / `pnpm test` / `pnpm lint` グリーン。
- 既存 `hotspots` / `dedup` サブコマンドの挙動が回帰していない。
- README に scan の節が追加され、「迷ったら `scan` を使う」と読み取れる。

### 依存
M5。

---

## リスクと留意点

- **strip-only 違反**: hotspots 側で `enum` / `namespace` / parameter properties
  などを使っていると M3 で blocker になる。M1 完了直後に
  `node tools/check-strip-only.ts` を試走し、件数を見てから M3 のスコープを
  決める。
- **テスト名衝突**: 両プロジェクトに `e2e` や `fixtures` があるため、ディレクトリ
  名衝突を避けて `test/dedup/` 配下に閉じ込める (M1)。
- **依存重複**: `typescript` を runtime dep に昇格すると `ts-morph` (peer) と
  バージョンがずれて型不整合を起こす可能性がある。M1 で `ts-morph` が要求する
  `typescript` 範囲を確認し、固定する。
- **bin 名前空間**: 旧 `ts-dedup` バイナリはどこにも公開していない前提で M1 から
  消す。もし利用者がいるなら段階1 のリリースノートで明示。
- **dedup 出力の dismissal**: hotspots の dismissal レジストリは body hash ベース。
  dedup の clone group には自然な単一 ID がないため、安易に流用できない。
  M5 で「scan の出力に対する dismissal」を改めて設計する。

