## `arch` monorepo / tsconfig エイリアス対応 計画

> Status: Done (M1-M3 完了)
> Goal: `ts-hotspots architecture` を pnpm / npm / yarn workspaces 構成のモノレポでも実用的に動かす。具体的には (1) 同一パッケージ内の tsconfig `paths` エイリアス、(2) パッケージ名 import (`@scope/foo`, `@scope/foo/sub`)、(3) パッケージごとに分かれた `tsconfig.json` (`extends` チェーンを含む) の 3 つを resolveModule が解像できるようにする。
> 非 Goal: `comp` / `dup` 側の挙動変更 (`comp` は既に tsconfig 非依存、`dup` はもともと tsconfig を読まない)。複数パッケージを **別レポートに分割** する出力形 (集約は単一 ranking を維持)。`node_modules` 内の外部パッケージへのエッジ追加 (スコープ外)。

## 0. Progress

- [x] **M1** — root tsconfig 配線 (現状の dead code を本番経路に通す)
- [x] **M2** — workspace 検出 + `package.json#exports` ベースのクロスパッケージ解像
- [x] **M3** — per-package tsconfig + `extends` チェーン解決

## 1. 経緯

`arch` には `src/architecture/resolve/tsconfigPaths.ts` (`readTsconfigResolution`) と `resolveModule` 内の path-mapping 解像ブランチが既に実装され、単体テストも存在する。しかし `src/architecture/cli/main.ts:210` の `buildGraph({ sources })` 呼び出しで `tsconfig` を渡しておらず、本番経路では一度も呼ばれていない (`grep -r readTsconfigResolution src/` で 1 ヒット = 自身のエクスポート行のみ)。結果として:

- 単一パッケージ TS プロジェクトでも `paths` が効かない。`@/foo` は bare specifier として `null` 扱い → エッジが落ちる。
- workspaces 構成のモノレポでは、パッケージ名で書かれた cross-package import (`@scope/foo`) が 100% 解像不能。`fan-in/fan-out` をはじめ全構造指標がパッケージ境界で大幅に欠損する。
- パッケージごとの `tsconfig.json` (例: `apps/web/tsconfig.json` に置かれた `~/*` alias) も無視される。

`comp` の monorepo 対応計画 (`docs/plans/comp-monorepo-tsconfig-discovery.md`) は最終的に「`comp` から tsconfig 依存自体を撤廃」して superseded になった。`arch` ではグラフ構築のためにエッジ解像が本質的に必要なので同じ撤廃ルートは取れず、解像層を強化する方向で進める。

### 1.1 TS API 利用方針 (ハイブリッド採用)

計画ドラフト時、`extends` チェーン / `${configDir}` 置換 / `paths` 継承 / 条件付き `exports` 等を **手書きで再実装する** 構成を当初検討した。しかし TypeScript はこれらの解像処理を public API として公開している:

- `ts.parseJsonConfigFileContent(...)` — `extends` チェーン (相対 / node_modules / 配列形 TS5+ / `${configDir}` 置換 / paths wholesale 継承) を仕様通り展開して `ParsedCommandLine` を返す。
- `ts.resolveModuleName(specifier, containingFile, options, host)` — specifier → ファイルパス。`moduleResolution: "Bundler"` / `"Node16"` 等で `package.json#exports` (条件付き / ワイルドカード) も解像。

手書きルートは **TS のエッジケースを再発明する** リスクを抱える (G2 / G3 / G5 / G8 がその実例)。とはいえ `ts.resolveModuleName` を全面採用すると `pnpm install` 済みの `node_modules` symlink 前提になり、また `--ref` モードで「ref 時のファイル集合に対して resolve」する制御性が失われる。両立を狙ってハイブリッド構成を採用する:

- **tsconfig 読み込みは `ts.parseJsonConfigFileContent` に委譲** (extends / configDir / paths 継承を TS に任せる)。
- **specifier 解像は手書き** (`knownFiles: Set<string>` との統合と `--ref` 制御性を維持)。`package.json#exports` の lookup table も手書き (M2)。

既存コード (`src/architecture/resolve/tsconfigPaths.ts:5-7`) のコメントに「parser-only だから `ts.parseJsonConfigFileContent` を呼ばない」と書かれているが、この方針は本計画で **撤回する**。撤回スコープは tsconfig 読み込みに限定し、ソース AST のパース (`ts.createSourceFile` 直接 / `ts.Program` も TypeChecker も使わない) は引き続き parser-only で維持する。M3 リリース時に CLAUDE.md と当該ファイルコメントを書き換える (M3 範囲に明記)。

## 2. 現状

### 2.1 既にできていること

- 相対 import (`./foo`, `../bar`) の解像 (`src/architecture/resolve/resolveModule.ts:51`)。`.ts` / `.tsx` / `index.ts` / `index.tsx` のフォールバック付き。
- `<repoRoot>/tsconfig.json` の `compilerOptions.baseUrl` + `paths` を読む reader (`tsconfigPaths.ts`)。`extends` は未対応。JSONC コメント剥がしは粗いが monorepo-style tsconfig は通る程度。
- path-mapping 適用ロジック (`applyPathMapping`)。完全一致 + ワイルドカード `*` 1 つ、最長 prefix 優先ソート済み。
- ソース列挙は `git ls-files` ベースなので、モノレポでも全 `.ts/.tsx` が `sources` に乗る (= ノードとしては全パッケージのコンポーネントが既に登場している)。問題は **エッジが繋がらない** こと。

### 2.2 落ちるケース

| パターン | 例 | 現状の挙動 |
|---|---|---|
| 単一パッケージ + tsconfig `paths` | `"@/*": ["./src/*"]` | bare specifier 扱い → null。エッジ全落ち |
| workspaces + パッケージ名 import | `import x from "@scope/db/client"` | 同上。クロスパッケージのエッジ全落ち |
| workspaces + パッケージごとの tsconfig | `apps/web/tsconfig.json` の `~/*` alias | root tsconfig も配線されておらず、配線されても apps/web 局所の alias は読まれない |
| tsconfig `extends` | `"extends": "@scope/tsconfig/base.json"` | 未対応。base 側の `paths` は読まれない |

### 2.3 設計上の制約

- `buildGraph` は既に `tsconfig?: TsconfigResolution` を opt-in で受ける形になっており (`src/architecture/graph/buildGraph.ts:43-46`)、そのまま `resolveModule` と再エクスポート解像 (`makeExportResolver`) に伝搬している。**新しい解像層を足す土台はもう内部 API に揃っている**。
- ノード ID は `makeComponentId(filePath, exportName, exportKind)` で生成され、`filePath` はリポジトリ相対 POSIX。パッケージ名はキーに含まれない。dismissal id (`ArchHotspot.dismissalId`) もこれを基にしているので、**ノード ID 体系は変えずに増えるのはエッジだけ**にすると互換破壊が起きない。
- 現状の `resolveModule` の戻り値はリポジトリ相対パス 1 本。モノレポ対応後もこれは維持する (グラフのキーが `filePath` なので、解像結果がパス 1 本に正規化される必要がある)。
- `loadArchSources` は `ref` モードと working-tree モードで別経路。M2 以降で `package.json` を読む際は両モードで一貫した読み出し方が要る (working-tree は `readFileSync`、ref は `git show`)。

## 3. Approach

3 層を `resolveModule` の解像スタックに **積み増す** 形で組む。新規フラグは原則入れず、ワークスペース検出は **暗黙発火** にする (`comp` の superseded 計画と同じ姿勢)。出力スキーマは現状維持 (集約された単一 ranking)。

```
resolveModule(specifier, fromFile, ctx):
  1. relative          (./, ../)            ← 既存
  2. tsconfig paths    (fromFile が属するパッケージの tsconfig)
                                            ← M1 で root のみ、M3 で per-package
  3. workspace package (パッケージ名 + subpath)
                                            ← M2 で新設
  4. それ以外          → null               ← 既存 (bare 外部パッケージ)
```

**precedence ルール**: 2 (paths) を 3 (workspace) より先に試すのは意図的。`tsconfig.paths` は明示宣言された **ローカルオーバーライド** なので、同じ specifier をキャプチャする workspace package があってもローカル設定を優先する (TS の Bundler resolver も同順)。barrel re-export 解像 (`makeExportResolver` 内の `export { x } from "@scope/foo"` / `export * from "@scope/foo"`) も同じ resolveModule を経由するので、新 `ResolveContext` の workspace ブランチがそのまま効く。

設計上のキー判断:

- **暗黙発火**。`pnpm-workspace.yaml` または ルート `package.json#workspaces` を検出したらワークスペースモードに切り替える。検出 0 件なら今の単一パッケージ動作 + root tsconfig 配線のみ。stderr に 1 行 `ts-hotspots architecture: discovered N workspace packages (mode: pnpm)` を出して透明性を確保。
- **グラフは 1 つに統一**。パッケージごとに分割しない。`buildGraph` は既に全 `sources` を 1 つの `Set` にして処理する設計で、これは変えない。
- **ノード ID 体系は不変** (`(filePath, exportName, exportKind)`)。dismissal 互換と既存 ranking キャッシュへの影響を避ける。パッケージ名を report 側で見せたくなったら `ArchHotspot` に別フィールドで添える別件として扱う。
- **解像コンテキストを `ResolveContext` に集約**。`buildGraph` に `tsconfig?: TsconfigResolution` 1 個渡す現行 API を、`resolveCtx?: ResolveContext` に置き換える。`ResolveContext` は内部に `(a)` パッケージ名 → ファイルパス table、`(b)` 各ファイルが属するパッケージとそのパッケージの `TsconfigResolution`、を保持する不透明型。`resolveModule` のシグネチャ変更を 1 回で済ませる。
- **`package.json#exports` は static lookup 専用に最低限実装**。文字列ターゲット (`"./client": "./src/client.ts"`)、条件付きオブジェクト (`{ default, import, types }`)、ワイルドカード (`"./foo/*": "./src/foo/*.ts"`) の 3 種を扱う。条件解決は **固定順** (`default → import → node → types`) で deterministic に。Node の本物の resolver (sync conditional negotiation) は組まない。
- **`extends` 解決は `ts.parseJsonConfigFileContent` に委譲**。チェーン展開、配列形 (TS5+)、`${configDir}` 置換、`paths` の wholesale 継承は TS が仕様通り処理する。我々は ParseConfigHost を 1 つ書き、ワークスペース内パッケージ名を `extends` で参照されたとき (例: `"extends": "@scope/tsconfig/base.json"`) に M2 の `packageMap` で `tooling/typescript/base.json` のような実パスへ書き換える(これにより `pnpm install` 未実行の checkout でも workspace 内 base config が解像できる)。`<repoRoot>/node_modules` フォールバックは TS のデフォルト挙動に任せる。
- **決定性**。パッケージ列挙は glob 展開後にパスソート、`exports` キーはワイルドカードを最後に、prefix が長い順にソートしてからマッチ判定。`extends` チェーンは深さ優先で固定順。
- **Recall over precision** (CLAUDE.md の dup の方針を踏襲)。解像できるかどうか曖昧な specifier は (a) 解像できれば必ず採用、(b) 解像不能なら null で落とす。`exports` map に書かれていない subpath を heuristic で当てに行く挙動は **入れない** (誤エッジを増やすほうが指標を歪める)。

## 4. 意思決定が必要な点

| ID | 論点 | 案 | 決定 |
|---|---|---|---|
| E1 | workspace discovery のトリガ | (a) `pnpm-workspace.yaml` or `package.json#workspaces` を検出したときだけ (b) (a) + 任意の場所に `package.json#name` が複数あれば (c) 常に try | **確定 (a)**。明示宣言を尊重。(b) は誤検出ノイズが多い (tooling の補助 `package.json` を拾う等) |
| E2 | `package.json#exports` の解析範囲 | (a) 文字列ターゲットのみ (b) (a) + 条件付き object (c) (b) + ワイルドカード `*` (d) Node 本物の resolver | **確定 (c)**。実 monorepo で頻出する 3 形式すべて。(d) は過剰実装 |
| E3 | conditional `exports` の優先順 | (a) `default → import → node → types` (b) `types → import → default` (c) declaration order そのまま | **確定 (a)**。`.ts` ソースを引きたい (parser-only スタンス)、`.d.ts` を先に引かない |
| E4 | `exports` フィールドが無いパッケージ | (a) 解像不能 (b) `package.json#main` のみ (c) (b) + subpath は legacy probing (`<root>/<subpath>.{ts,tsx}` / `<root>/<subpath>/index.{ts,tsx}`) | **確定 (c)**。`exports` 不在パッケージは Node の legacy resolution が subpath 自由なので、`main` だけだと `@scope/foo/util` 等が全滅する。`exports` 宣言ありで subpath 未マッチの厳格挙動 (E12) と棲み分け |
| E5 | per-package tsconfig の発見 | (a) M2 の package map から一括取得 (b) 各 importing file の親ディレクトリを root まで walk (c) 両方併用 | **確定 (a)**。M2 で必ず enumerate するので使い回し。パッケージ外 (例: `scripts/`) のファイルは root tsconfig にフォールバック |
| E6 | `extends` チェーンの解決方法 | (a) 手書き (相対 + node_modules + workspace package) (b) `ts.parseJsonConfigFileContent` に委譲 + workspace package を ParseConfigHost で書き換え (c) 完全に TS 任せ | **確定 (b)**。手書きは G2 (配列形) / G3 (ディレクトリ指定) / G8 (`${configDir}`) の取りこぼしリスクが高い。TS に委譲すれば仕様準拠が自動で得られる。workspace package extends だけは `pnpm install` 未実行時のために我々の packageMap で書き換える |
| E7 | per-package tsconfig 不在時のフォールバック | (a) root tsconfig (b) "no mappings" (c) インポート元の最寄り親 walk | **確定 (a)**。M1 で root tsconfig は常にロードする方針なので一貫する |
| E8 | `--workspace` / `--no-workspace` 明示フラグ | (a) 入れない (自動発見のみ) (b) 入れる (c) (a) + 必要になったら後付け | **確定 (c)**。dogfooding で困ったら足す YAGNI |
| E9 | ノード ID への `packageName` 含有 | (a) `(filePath, exportName, exportKind)` を維持 (b) パッケージ名を含める | **確定 (a)**。dismissal 互換、既存 report 形を維持。表示用に `packageName` を別フィールドで足すのは本計画の射程外 |
| E10 | パッケージ列挙の決定性確保 | (a) glob 結果を `sort()` (b) glob 結果のまま (c) 列挙順を出力に含めて確認 | **確定 (a)**。CLAUDE.md の "Determinism is a hard invariant" を踏襲 |
| E11 | YAML 依存の追加 | (a) 最小手書きパーサで `packages: [...]` だけ取る (b) `js-yaml` を依存追加 (c) ユーザに `package.json#workspaces` への移行を要求 | **確定 (a)**。`comp` の superseded 計画と同方針。pnpm-workspace.yaml の `packages:` は手書きで十分扱える形をしている |
| E12 | サブパス未マッチの `exports` lookup の扱い | (a) null (= エッジ落ち) (b) パッケージルートに fallback (c) heuristics で `./src/<subpath>.ts` を試す | **確定 (a)**。Node 自体が "not exported" でエラーになる挙動と整合。recall より precision を取りたい例外ケース |
| E13 | TS API への委譲範囲 | (a) すべて手書き (b) tsconfig 読み込みのみ TS API、specifier 解像は手書き (ハイブリッド) (c) `ts.resolveModuleName` も含めて全面委譲 | **確定 (b)**。(a) は仕様取りこぼしリスク (G2 / G3 / G8)、(c) は `pnpm install` 必須 + `--ref` 制御性を失う。境界は「extends / paths 継承 / configDir = TS」「specifier → ファイルパス = 手書き (knownFiles 統合維持)」 |

## 5. マイルストーン

### M1 — root tsconfig 配線 (dead code を生かす)

決定: なし (純配線)。

範囲:
- `src/architecture/cli/main.ts:210` の `buildGraph({ sources })` を `buildGraph({ sources, tsconfig: readTsconfigResolution(repoPath) })` に変更。
- 単一パッケージで `paths` を持つリポジトリで、エイリアス経由のエッジが繋がることを e2e で確認。
- workspace 検出はまだ行わない。M1 単独でも単一パッケージユーザーに価値が出るので独立リリース可能。
- `--ref` 経路では `readTsconfigResolution` が working-tree の tsconfig を読む点に注意 (ref 時刻の tsconfig を読まない仕様)。M1 では妥協し、本格対応は M3 で `git show` 経由の読み出しを検討する (現状でも tsconfig は頻繁に変わらないので実害は小さい想定)。

検証:
- 既存 `src/architecture/resolve/resolveModule.test.ts` の path-mapping ケースが本番経路でも刺さることを e2e で確認。
- 単一パッケージで `paths` を持つ inline fixture (in-memory sources) で `buildGraph` が期待エッジ数を出すこと。
- `tsconfig.json` 不在のリポジトリで挙動が変わらないこと (`readTsconfigResolution` は不在時に `EMPTY` を返すので回帰しないはず → これも明示的にテスト)。

### M2 — workspace 検出 + パッケージ名解像

決定: E1 / E2 / E3 / E4 / E8 / E9 / E10 / E11 / E12。

範囲:
- 新規 `src/architecture/workspace/discoverWorkspace.ts`:
  - `<repoRoot>/pnpm-workspace.yaml` の `packages:` を最小手書き YAML パーサで抽出 (E11)。
  - 無ければ `<repoRoot>/package.json#workspaces` (string array / `{ packages: [...] }` 両対応)。
  - 両方無ければ `null` を返す (= 単一パッケージモード)。
  - glob 展開は `fast-glob` 等を増やさず、`src/duplication/diff/internal/globMatch.ts` の流用 or 最小実装を検討 (M2 着手時の判断点)。
- 新規 `src/architecture/workspace/readPackage.ts`: `package.json` を JSON パースし、`name` / `exports` / `main` を抽出。`exports` は文字列・object・ワイルドカードの 3 形態を扱う AST 化された `ExportsMap` 型に正規化 (E2)。**特殊キー `.`**: パッケージのメインエントリ。specifier === packageName (subpath 無し) のときは `"."` を引きに行く (`""` を `"."` に正規化する一行を resolve 直前に置く)。**ワイルドカード `*` は単一のみサポート** (Node 仕様の複数 `*` は射程外、出てきたら literal 扱い)。
- 新規 `src/architecture/workspace/buildPackageMap.ts`:
  - 入力: パッケージ root の配列。
  - 出力: `PackageMap` = `{ byName: Map<string, PackageInfo>, byFile: Map<string, PackageInfo> }`。`PackageInfo` は `{ name, root, exportsMap, tsconfigPath }`。
  - `byFile` は所属判定用 (`fromFile` がどのパッケージ配下か)。プレフィックスマッチでなく longest-root-prefix 一致で確定 (ネストワークスペース耐性)。
- `src/architecture/resolve/resolveModule.ts` を拡張:
  - 新シグネチャ `resolveModule(specifier, fromFile, ctx: ResolveContext)`。`ResolveContext` は `{ knownFiles, tsconfigByFile, packageMap }`。
  - 第 3 ブランチ `workspace package`: `specifier` を最長 prefix で `packageMap.byName` に当て、subpath を取り出す。
    - パッケージに `exports` 宣言あり → `applyExportsMap()` で resolve、未マッチは null (E12)。`subpath === ""` は `"."` に正規化してから引く (G4)。
    - `exports` 宣言なし + subpath 無し → `package.json#main` を試す (E4)。
    - `exports` 宣言なし + subpath あり → legacy probe: `<root>/<subpath>` を既存 `probe()` に流して `.ts` / `.tsx` / `index.{ts,tsx}` ヒットを得る (E4 拡張、G5)。
  - `applyExportsMap()` ヘルパで条件解決を固定順 (E3) で行う。ワイルドカードは単一 `*` のキャプチャで置換 (複数 `*` は未対応)。
- `src/architecture/graph/buildGraph.ts`:
  - `BuildGraphOptions` を `{ sources, resolveCtx? }` に置き換え (`tsconfig?` は内部で `resolveCtx` に詰め替えて 1 リリース互換維持)。
  - `makeExportResolver` 内の 2 箇所の `resolveModule` 呼び出し (named re-export / star re-export) を **同じ `ResolveContext` で呼ぶ**。クロスパッケージ barrel (`export * from "@scope/foo"`) はこれが無いと辿れない。
- `src/architecture/cli/main.ts`:
  - `loadArchSources` の前後で `discoverWorkspace` → `buildPackageMap` → `ResolveContext` 構築を行う。
  - 検出時 stderr に 1 行 `ts-hotspots architecture: discovered N workspace packages (mode: pnpm-workspace)` を出力 (M3 stats 行と同形)。
  - 未検出時は M1 動作 (root tsconfig のみ) にフォールバック。
- `--phase-timings` 連携 (G9): 新規ステージ `workspace_discover` / `package_map_build` を `perfLog` に乗せる。**`--phase-timings` 無効時は `performance.now()` を呼ばない** 既存契約 (CLAUDE.md の duplication 文脈) を踏襲。

検証:
- 単体: `discoverWorkspace`、`readPackage` (各 `exports` 形態)、`applyExportsMap` (固定優先順、ワイルドカード)、`buildPackageMap` (longest-root-prefix)。
- 単体: `resolveModule` の workspace ブランチ。最低限のケース:
  - `@scope/db` (subpath 無し → `.` キーで resolve)
  - `@scope/db/client` (subpath あり、`exports` 明示)
  - `@scope/db/sub/*` (ワイルドカード)
  - `@scope/no-exports` (main fallback)
  - `@scope/no-exports/util` (legacy probing で `<root>/util.ts` 解像)
  - `@scope/no-exports/missing` (legacy probing もヒットせず null)
  - **自己参照**: `packages/foo/src/x.ts` から `@scope/foo/util` (同一パッケージ内に解像できること)
  - `tsconfig.paths` で `@scope/foo` を上書き (paths 優先確認)
  - `export * from "@scope/foo"` の barrel chase
- 統合: `buildGraph` レベルで「2 パッケージ間で named export を import → エッジが 1 本繋がる」「`exports` 不明な subpath → エッジ無し」「ワイルドカード `exports` で複数パッケージから同一定義に集約」「クロスパッケージ barrel re-export を辿る」。
- e2e: 既存の `src/architecture/cli/registerCommand.test.ts` 系の **in-memory ハーネスを拡張** して簡易 monorepo を再現。**`tests/fixtures/` ディレクトリは作らない** (リポジトリは co-located test 構成、物理 fixture が要るなら `tmpdir()` に書き出す方針)。`arch` 出力の hotspot にクロスパッケージのエッジが反映されていることを確認。

### M3 — per-package tsconfig + `ts.parseJsonConfigFileContent` 統合

決定: E5 / E6 / E7 / E13。

範囲:
- `src/architecture/resolve/tsconfigPaths.ts` を **書き直す** (現状の手書き JSONC 剥がし + `parseTsconfigResolution` を撤去):
  - 入力: tsconfig 絶対パス + workspace `packageMap` (M2)。
  - 内部で `ts.readConfigFile(path, host.readFile)` → `ts.parseJsonConfigFileContent(json, host, basePath)` を呼び、TS に extends / `${configDir}` / paths 継承 / 配列形 (G2 / G3 / G8) を処理させる。
  - 取り出すのは `ParsedCommandLine.options` のうち `paths` と `baseUrl` のみ。既存 `TsconfigResolution` 型 (`{ baseUrl, mappings }`) はそのまま維持し、外向けインターフェース不変。`mappings` は `paths` を最長 prefix 順にソートした配列に正規化。
  - **ParseConfigHost** を専用に 1 個書く (`src/architecture/resolve/parseConfigHost.ts`):
    - `useCaseSensitiveFileNames` / `readDirectory` / `fileExists` / `readFile` の 4 関数を実装。
    - `extends` のパッケージ名解決を **横取り**: `readFile` 呼び出しで `node_modules/@scope/foo/...` 形式のパスを受けたとき、`packageMap.byName` にヒットすれば実パッケージ root (例: `tooling/typescript/...`) に書き換えてから読む。これで `pnpm install` 未実行のチェックアウトでも workspace 内共有 base config が引ける。
    - workspace 外の通常 `node_modules` 参照はそのまま `ts.sys.readFile` に流す。
- `src/architecture/resolve/resolveExtends.ts` は **作らない** (TS が担当するため不要)。
- `PackageInfo` (M2 で定義) に `tsconfig: TsconfigResolution | null` を追加。各パッケージで `<root>/tsconfig.json` があれば上記関数で読み込み、無ければ `null`。
- `ResolveContext.tsconfigByFile(file)`:
  - `packageMap.byFile.get(file)` でパッケージ特定。
  - パッケージの tsconfig があればそれ、無ければ root tsconfig (E7)、root も無ければ "no mappings"。
- `resolveModule` の path-mapping ブランチを `tsconfigByFile(fromFile)` から取った `TsconfigResolution` に切り替え。**`applyPathMapping` などの specifier 解像ロジックは引き続き手書き** (E13、`knownFiles` 統合と `--ref` 制御性のため)。
- `--ref` モードでの tsconfig 読み出し: working-tree 直読みを維持 (TS 委譲後も `ts.sys` ベースで working tree を読む)。ref 時の `git show` 経由読み出しは将来課題として M3 範囲外に置く。
- `--phase-timings` 連携 (G9): 新規ステージ `tsconfig_load` を `perfLog` に乗せる (M2 と同方針、無効時は計測しない)。
- **ドキュメント更新** (M3 リリース時):
  - `CLAUDE.md` の Overview 段落に「ソース AST のパースは parser-only、tsconfig 読み込みは `ts.parseJsonConfigFileContent` に委譲」の境界を 1 行追記。
  - `src/architecture/resolve/tsconfigPaths.ts` 冒頭コメント (現行 5-7 行目の "We do not invoke `ts.parseJsonConfigFileContent` because..." 部分) を新方針に書き換える。

検証:
- 単体: 新 `tsconfigPaths.ts` の TS 委譲で「相対 (ファイル / ディレクトリ)」「ワークスペース内パッケージ名 (`pnpm install` 不要で引けることを ParseConfigHost を介して確認)」「node_modules フォールバック」「配列形 extends (TS5+)」「`${configDir}` 置換」「子の `paths` が親の `paths` を wholesale 置換」が TS 仕様通りに展開されることを確認。各ケースを TS の振る舞いと突き合わせる goldenファイル系のテストにする (= 我々の wrapper のリグレッション検出)。
- 単体: `tsconfigByFile` で「per-package tsconfig がある」「ない (root にフォールバック)」「root も無い (no mappings)」。
- 単体: ParseConfigHost の `extends` 横取り: workspace package 名 → 実パッケージ root への書き換え、workspace 外 `node_modules` はそのまま素通し。
- 統合: `apps/web` 相当の fixture に `~/*` alias を仕込み、`apps/web/src/x.ts` から `~/y` を import → エッジが繋がる。同 alias は他パッケージから見えないことも確認。
- e2e: M2 の in-memory monorepo ハーネスに per-package tsconfig + extends を足し、`arch` 出力に変化が出ることを確認。**物理 fixture を作る場合は `tmpdir()` 経由** (M2 と同方針、`tests/fixtures/` は作らない)。

## 6. リスク / 横断論点

- **依存追加の誘惑**: `js-yaml` / `fast-glob` 等を追加したくなる場面はあるが、最小手書きで十分扱える形に絞る (E11 と同方針)。`extends` 系はもう手書きしない (E13 で TS API 委譲)。`enhanced-resolve` 相当も TS の resolver があるので不要。依存を 1 つでも増やすかは M2 着手時に明示判断。
- **発見ノイズ**: workspace glob が `node_modules` 配下まで拾うと壊滅的に重くなる。`src/duplication` の `DEFAULT_EXCLUDE_GLOBS` 系を再利用するか専用除外リストを持つかは M2 で決定。最低でも `node_modules` / `dist` / `build` / `.next` / `out` / `.cache` は除外必須。
- **決定性**: workspace glob 展開、`exports` キーの順序、`extends` チェーンの merge 順、すべて中間結果を `sort()` または固定順序で正規化する。CLAUDE.md の "Determinism is a hard invariant" は dup 文脈だが arch にも同方針で適用。
- **dismissal 互換**: ノード ID は `(filePath, exportName, exportKind)` 維持 (E9) なので dismissal 登録済みの hotspot は引き続き効く。ただし「いままで解像できなかったエッジが繋がる」ことで metric 値・ランキング順位が変動し、結果として composite score の閾値前後にいた hotspot が dismissal 範囲を抜けたり入ったりする可能性はある。これは正常挙動として許容。
- **`--diff` / `--ref` との相互作用**:
  - `--diff` は display filter なので影響なし (rankings は full ref に対して計算)。
  - `--ref` で過去の commit を読むときの tsconfig と `package.json` の読み出しは M1/M2 では working-tree 固定でスタートし、ref 整合は M3 までに対応の要否を確認。実害は小さい想定だが、long-running monorepo の `--ref HEAD~100` 等で挙動がズレる可能性は残る。
- **`exports` のワイルドカード爆発**: `"./*": "./src/*.ts"` 等の包括的ワイルドカードがあると、`packageMap.byName` 経由で解像対象のファイルセットが膨らむ。ただし最終的には `knownFiles` ヒット時のみエッジ化されるので、I/O 増は無い (resolve はオンデマンド)。テストでは想定以上のエッジ数が出ないことを確認するゴールデンファイルを 1 個入れる。
- **既存 `tsconfig?` API の互換**: `BuildGraphOptions.tsconfig` を即削除すると外部利用 (テストや tooling) が割れる。M2 で `resolveCtx` を追加、`tsconfig` は deprecated として 1 リリース残し、M3 で削除する段階的撤去にする。
- **TS API 利用の副作用** (E13): `ts.parseJsonConfigFileContent` は内部で `ts.sys` 経由のディスク I/O を行う (extends 先の読み込みなど)。これは parser-only スタンスからの逸脱だが、tsconfig 読み込みに **限定** している。テスト純度を保つため ParseConfigHost を独立コンポーネントに切り出し、テストでは in-memory モックを差し替えられる形にする。`--ref` モードでは引き続き working-tree の tsconfig を読む点は M3 でも変わらず (M2 と同様の妥協)。
- **stderr 行のスパム**: workspace 検出ログを毎回出すと CI ログが増える。`--quiet` 系フラグは現状 arch にないので、まずは `discovered N workspace packages` を 1 行だけ出して様子見。`comp`/`dup` の stats 行と同形なので吸収される想定。
- **M1 と M2 のリリース粒度**: M1 だけだと「単一パッケージ + paths は動くがモノレポは依然壊れたまま」という中途半端な状態になる。ただし M1 は文字通り 2 行程度の配線で、M2 完成を待つ理由が無いので独立リリース可。M2/M3 は同一セッション or 連続リリースが望ましい (M2 後の状態は「クロスパッケージは動くが per-package alias が動かない」)。
- **ts-hotspots 自身は単一パッケージ**: dogfooding ループに workspace 依存のテストが入らないので、必ず合成 fixture で検証する。回帰検出は CI 上の e2e が担う。
- **pnpm hoisted vs 非 hoisted**: `extends` の node_modules 解像は TS のデフォルト挙動 (consuming tsconfig の dir から親方向に walk) に任せるので、hoisted / 非 hoisted 両方に対応できる。**workspace 内 base config への extends は ParseConfigHost が `pnpm install` 未実行でも書き換えで解像する** ので、CI 上の浅いチェックアウトでも動く。`<repoRoot>/node_modules` のみを見ていた手書きルートの限界は解消される。
- **テスト fixture は物理ファイルを作らない**: `tests/fixtures/` ディレクトリは作らず、in-memory ハーネス (既存の registerCommand.test.ts 系) を拡張するか、物理ファイルが要る場合のみ `os.tmpdir()` に書き出して afterEach で掃除。これは co-located test + 自動 cleanup の既存スタイルを崩さないため。

## 7. 決定済み事項

E1-E12 すべてを §4 推奨案で確定。以下に短縮形で再掲する。M1-M3 実装はこの確定内容に従う。

- **E1**: workspace discovery のトリガは `pnpm-workspace.yaml` または `package.json#workspaces` の検出時のみ。両方不在なら単一パッケージモード。
- **E2**: `package.json#exports` は文字列ターゲット / 条件付き object / ワイルドカード `*` の 3 形態をサポート。
- **E3**: 条件付き `exports` の優先順は **`default → import → node → types`** 固定。`.ts` ソースを引きたい parser-only スタンスに合わせ `types` を最後にする。
- **E4**: `exports` 不在パッケージは (a) subpath 無しなら `package.json#main` を試す、(b) subpath ありなら legacy probing で `<root>/<subpath>` を `.ts` / `.tsx` / `index.{ts,tsx}` 順に probe。`exports` 宣言ありで subpath 未マッチは別ルール (E12 の null) で厳格扱い。
- **E5**: per-package tsconfig は M2 の `packageMap` から取得 (`PackageInfo.tsconfigPath`)。
- **E6**: `extends` チェーン解決は `ts.parseJsonConfigFileContent` に委譲 (E13 ハイブリッド方針の一部)。配列形 (TS5+) / `${configDir}` (TS 5.5+) / `paths` 継承の wholesale 置換 / ディレクトリ指定はすべて TS 仕様通りに処理される。workspace 内パッケージ名 extends は ParseConfigHost で `packageMap.byName` を介して書き換え、`pnpm install` 未実行の checkout でも解像可能にする。
- **E7**: per-package tsconfig 不在時は root tsconfig にフォールバック。それも無ければ "no mappings"。
- **E8**: `--workspace` / `--no-workspace` 明示フラグは入れない (YAGNI)。発見ロジックでは足りない監視ケースが具体化したら後付けする。
- **E9**: ノード ID は `(filePath, exportName, exportKind)` のまま維持。`packageName` は ID に含めない (dismissal 互換 + 既存 report 互換のため)。`ArchHotspot` への `packageName` フィールド追加は本計画の射程外、別件として扱う。
- **E10**: パッケージ列挙は glob 展開後に必ず `sort()`。`exports` キーはワイルドカードを最後にしつつ prefix が長い順、`extends` チェーンは深さ優先で固定順。
- **E11**: `pnpm-workspace.yaml` 解析は最小手書きパーサ (`packages:` ブロック直下のリスト項目のみサポート)。`js-yaml` 依存は追加しない。parse 失敗時はワークスペース未検出にフォールバックして単一パッケージ動作。
- **E12**: `exports` **宣言あり** のパッケージで subpath 未マッチは null (= エッジ落ち)。Node 自体の "not exported" エラーと整合。precision 寄り。`exports` 不在パッケージの subpath は E4 (b) の legacy probing 経路に乗るので別ルール。
- **E13**: TS API 委譲の境界はハイブリッド構成。**tsconfig 読み込み (extends / `${configDir}` / paths 継承) は `ts.parseJsonConfigFileContent` に委譲**、**specifier 解像 (relative / paths / workspace package / `package.json#exports` lookup) は手書き** (`knownFiles` 統合と `--ref` 制御性のため)。`ts.resolveModuleName` の全面採用は `pnpm install` 必須化のため不採用。M3 リリース時に `CLAUDE.md` と `tsconfigPaths.ts` 冒頭コメントを新方針に書き換える。
