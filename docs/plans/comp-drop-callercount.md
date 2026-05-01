## `comp` の callerCount 削除 + tsconfig 依存撤廃 計画

> Status: Shipped (2026-05-01)
> Goal: `comp` から `callerCount` 軸を削除し、付随して TypeChecker / tsconfig 依存を落とす。`comp` の入力モデルを `dup` と揃える (git ls-files + 1 ファイル単位の `ts` パース)。
> 非 Goal: 他の軸 (cognitiveComplexity / sloc / commitCount 等) の削除や挙動変更。`dup` 側の挙動変更。`comp` と `dup` の単一コマンド化。

## 0. Progress

- [x] **M1** — `callerCount` 削除 + TypeChecker 無効化 (依然 ts-morph + tsconfig は使う)
- [x] **M2** — tsconfig 依存撤廃 + ソース列挙を git ls-files に切替
- [x] **M3** — ドキュメント書き直し (README / requirements.md / dogfooding) + `comp-monorepo-tsconfig-discovery.md` の supersede

実装メモ:

- D1 (a) を採用 — `callerCount` を schema / collector / test / CLI 受理から完全削除。`--metrics callerCount` は既存の `parseFunctionAxes` が `INVALID_METRIC` で弾く (追加実装不要)。
- D5 を「(a) repo 全体を ls-files」ではなく「(b) 指定ディレクトリ配下のみを ls-files」に微修正。`git -C rootDir ls-files` で十分目的を果たし、既存 fixture-based テストが破壊されないため。`dup` は `findGitRoot` + prefix scoping を使うが、`comp` はディレクトリ自体を rootDir として扱う。
- D6 / D7: registry rootDir = positional path (findGitRoot を介さない)。`dup:` 系のみ既存通り `findGitRoot` で repo root に書き込む。エラーコードは既存の `NOT_A_GIT_REPO` に統一 (D7 の `NOT_A_GIT_REPOSITORY` は採用せず)。

## 1. 経緯

`docs/plans/comp-monorepo-tsconfig-discovery.md` (M1/M2 未実装) を読み返している中で、「**dup は tsconfig を読まないのに comp は読む**」という非対称が出てきた。原因を辿ると:

- `comp` の metrics のうち TypeChecker を要求しているのは **`callerCount` だけ**。`findReferences` でシンボル解決する必要があるため (`requirements.md:53`)。
- 他の軸 (cognitive / sloc / params / nesting / await / try-catch / mutation / commitCount / calleeCount) は全部 syntax-only か git-only。
- TypeChecker → ts-morph `Project` → tsconfig という鎖なので、`callerCount` を捨てれば `comp` は **dup と同じ "tsconfig 不要 + 1 ファイル単位パース" モデルに着地できる**。

`callerCount` は ranking で実質的な仕事をしている (intrinsic complexity だけだと「複雑だが誰も呼んでない死にコード」と「複雑で 50 箇所から呼ばれる地雷」を区別できない) が、今回は **product 判断として外す**。理由は:

- monorepo (`comp-monorepo-tsconfig-discovery.md`) の摩擦が消える (全 `.ts`/`.tsx` を git で列挙すればよい)
- comp / dup の入力モデル / エラーモデルが統一される (`TSCONFIG_NOT_FOUND` / `references` 走査 / solution config 等のコードパスが消滅)
- TypeChecker を回す ts-morph `Project` 構築コスト (一番重い処理) が消える
- agent 運用上、call site の数は agent 自身が `grep` / IDE で確認できるシグナルなので、ツールから取り上げる不利益は限定的

`comp-monorepo-tsconfig-discovery.md` 計画は本計画で **完全に不要化** されるので supersede する (M3)。

## 2. 現状

### 2.1 `callerCount` の到達範囲

```
src/schema.ts:15,28,40                           # FunctionMetrics / FunctionAxisId / FUNCTION_AXIS_IDS
src/aggregator/aggregate.ts:2,36                 # METRIC_COLLECTORS に登録
src/aggregator/rank.ts:26,160,176                # functionExtractors / metricKeys / category
src/collectors/call-graph/caller-count.ts        # 実装本体 (findReferencesAsNodes 使用)
src/collectors/call-graph/caller-count.test.ts   # 単体テスト
src/cli.test.ts                                  # callerCount を含む snapshot
src/aggregator/rank.test.ts                      # callerCount を含む snapshot
docs/requirements.md:53,65,95,203                # 仕様文 (TypeChecker 動機 + 軸定義 + leverage 言及)
README.md:33-44                                  # tsconfig 前提の記述
```

`FUNCTION_AXIS_CATEGORY` で `callerCount` は **唯一の "leverage" 軸が `commitCount` と並ぶ 1 つ**。削除後は leverage カテゴリに `commitCount` だけ残る (空にはならない)。

### 2.2 TypeChecker / tsconfig の到達範囲

```
src/loader/load-project.ts                        # Project + getTypeChecker() + walkTsconfigReferences + TsconfigNotFoundError
src/cli.ts:32,311-320,393-394,654-657,901        # resolveTsconfigPath / loadProject / TsconfigNotFoundError
src/collectors/enumerate-source-files.ts          # project.getSourceFiles() で列挙
src/collectors/enumerate-declarations.ts          # ts-morph Node を扱う (TypeChecker 不要)
src/collectors/types.ts:36                        # CollectorContext.project: Project (ts-morph)
src/collectors/**/*.ts                            # 残りの collector はすべて ts-morph 型 (Node, SyntaxKind) を使うが TypeChecker 不要
src/dismissal/hash.ts (computeBodyHash)           # ts-morph Node から body 文字列を取り hash
```

**重要**: `callerCount` 以外の collector は ts-morph **型** (`Node` / `SyntaxKind`) は使うが、TypeChecker は呼んでいない (確認済み: callee-count / cognitive / sloc / parameter-count / max-nesting-depth / try-catch-count / await-count / mutation-count はすべて syntactic walker)。**ts-morph 自体は TypeChecker なしでも動く** (ts AST のラッパとして使う) ので、M1 では `getTypeChecker()` 呼び出しを止めるだけで他は無傷。

### 2.3 ソース列挙の現状

`enumerateSourceFiles` (collectors/enumerate-source-files.ts:27) は `project.getSourceFiles()` から拾う。`Project` は `addSourceFilesFromTsConfig(cfg)` で seed されている (load-project.ts:48) ので、列挙対象は **tsconfig の `include` / `references` で決まる**。

これを git ls-files ベースに切り替えると、"tsconfig がカバーしていない `.ts` ファイル" も拾うようになる (要検証: 想定外のファイルが入って ranking が騒がしくなる可能性)。除外は既存の `--exclude` + `DEFAULT_EXCLUDE_GLOBS` (defaults.ts) で吸収する。

### 2.4 `--pr` モードとの関係

`comp --pr <revrange>` は workdir のソースで ranking を計算し、changed files に絞った view を出す (cli.ts:736 周辺)。tsconfig 撤廃後も "workdir の TS を全部解析" は変わらず、この挙動は維持される。dup の `--pr` が `git show <baseSha>` で base 時点を読むのとは設計意図が違う (dup は base ↔ head の比較が目的、comp は **現状コードの** 複雑度評価が目的)。

## 3. Approach

「**M1: 軸を消す → M2: 入力モデルを dup に揃える → M3: ドキュメント**」の 3 段階で進める。各段階は独立リリース可能で、M1 だけで止めても "tsconfig は読むが TypeChecker は走らない" という中間状態として有意義 (perf 改善のみ享受) になる。

設計上のキー判断:

- **callerCount は再導入余地を残さず完全削除**。schema / collector / test / docs / CLI 受理から消す。`--metrics callerCount` は `INVALID_METRIC` エラーを返すようにして、過去の利用者には「明示的なエラーで気づける」形で破壊する (silent ignore より良い)。
- **ts-morph は M1 では維持、M2 で外すかを再判断**。M1 で TypeChecker を切れば最も重い処理は消える。残った ts-morph 依存 (Node ラッパとしての利用) を剥がして raw `typescript` に揃えるのは差分が大きく、`dup` の indexer (`src/duplication/indexer/`) と一本化する話に発展するので別計画 (将来の "loader 統合" 計画) に切り出す。本計画では M2 で **「ts-morph は使うが、`Project` は tsconfig ではなく `addSourceFilesAtPaths(paths)` で seed」** に留める。
- **ソース列挙は git ls-files に統一**。`comp` は `--churn` で git に依存しているため "git repo であること" は既に soft requirement。git 非依存のフォールバック (filesystem walk) は YAGNI で足さない。dup と同じ方針。
- **位置引数 `[path]` の意味は dup と同じ "git repo 内のディレクトリ"** に変更。`tsconfig.json` を直接渡す経路は廃止。ディレクトリを渡したら `findGitRoot` でリポジトリ root を解決し、そこから git ls-files。これで `comp packages/foo` のようなサブパッケージ指定でも、リポ全体を解析した上で `--file` / scope で絞る運用に近づく (実装詳細は D5)。
- **破壊変更を 1 回で集約**。`callerCount` 削除と tsconfig 廃止を同じメジャーバージョン bump に乗せる (M1 と M2 を同じリリースに含める)。中間状態を user に晒すと migration が二重になる。

## 4. 意思決定が必要な点

| ID | 論点 | 案 | 暫定 |
|---|---|---|---|
| D1 | `callerCount` の落とし方 | (a) schema / 軸 / collector を完全削除 (b) 軸は残し常に 0 を返す deprecation 期間を設ける (c) opt-in flag (`--with-callers`) に格下げ | **暫定 (a)**。中途半端な (b)(c) は TypeChecker / tsconfig 依存を結局残す。CHANGELOG で破壊を周知 |
| D2 | ts-morph の扱い | (a) M1/M2 とも維持 (`Project` を tsconfig ではなく path 配列で seed) (b) M2 で raw `typescript` に置換し dup の indexer と統合 | **暫定 (a)**。(b) は collector 全書き換えで blast radius が大きく、本計画のスコープ外。別計画で扱う |
| D3 | ソース列挙の手段 | (a) `git ls-files` (workdir 反映) (b) `git ls-tree HEAD` (commit 済みのみ) (c) filesystem walk + `.gitignore` 尊重 | **暫定 (a)**。"未コミットの新規 `.ts` も解析対象に入れたい" を優先。`dup` の `git ls-tree --full-tree <sha>` とは違うが、これは "現状コードの metrics" vs "base 時点の duplication" という意図差を素直に反映 |
| D4 | tsconfig が存在する場合の扱い | (a) 完全に無視 (`include` / `paths` / `compilerOptions` を一切見ない) (b) 存在すれば `include` を尊重 (フォールバックで git ls-files) | **暫定 (a)**。(b) は "tsconfig を読むかどうかが暗黙に決まる" 不透明モードを生む。除外は `--exclude` + 既定 glob で十分制御可能 |
| D5 | 位置引数 `[path]` の意味 | (a) git repo 内のディレクトリ。`findGitRoot` で repo root を解決し repo 全体を ls-files (b) 指定ディレクトリ配下のみを ls-files (c) `tsconfig.json` 直接指定も互換維持 | **暫定 (a)**。dup と完全一致。サブディレクトリで絞りたいケースは `--file` / `--pr` でカバー。(c) は破壊変更ウィンドウに揃えて廃止 |
| D6 | `dismiss` / `list-dismissed` / `undismiss` の `--path` | (a) "git repo 内のディレクトリ" 解釈に統一 (b) tsconfig 互換維持 | **暫定 (a)**。help text 更新のみ。registry 配置 (rootDir = git repo root) は M2 の挙動に合わせる |
| D7 | エラーコード `TSCONFIG_NOT_FOUND` の置き換え | (a) `NOT_A_GIT_REPOSITORY` (新規) を追加し、`TSCONFIG_NOT_FOUND` は削除 (b) 双方とも残し、状況に応じて出し分け | **暫定 (a)**。tsconfig を読まないのだから前者は意味を失う。findGitRoot 失敗時の新コード 1 つで足りる |
| D8 | `comp-monorepo-tsconfig-discovery.md` の扱い | (a) 先頭に "Superseded by `comp-drop-callercount.md`" と書いて残す (b) 削除 | **暫定 (a)**。経緯と "なぜ YAGNI 判断が覆ったか" の記録として残す方が、将来同じ議論が再燃したとき早い |
| D9 | リリース戦略 | (a) M1+M2 を同じバージョン (破壊変更 1 回) (b) M1 を patch、M2 を破壊版に分割 | **暫定 (a)**。M1 単独で出すとユーザーは "tsconfig 不要にしたい" の半分しか得られず、M2 で再 migration が必要。1 回で済ませる |

## 5. マイルストーン

### M1 — `callerCount` 削除 + TypeChecker 無効化

決定: D1。

- `src/collectors/call-graph/caller-count.ts` + `caller-count.test.ts` を削除。
- `src/aggregator/aggregate.ts` の `METRIC_COLLECTORS` から `callerCountCollector` を除く。
- `src/aggregator/rank.ts` の `functionExtractors` / `functionAxisMetricKeys` / `FUNCTION_AXIS_CATEGORY` から `callerCount` を削除。
- `src/schema.ts` の `FunctionMetrics` / `FunctionAxisId` / `FUNCTION_AXIS_IDS` から `callerCount` を削除。
- `src/loader/load-project.ts` から `project.getTypeChecker()` 呼び出しを削除 (`callerCount` 以外の用途がないことを確認済み)。
- 既存テスト (cli.test.ts / rank.test.ts / 全体 snapshot) を `callerCount` 抜きで更新。
- `--metrics callerCount` を渡したときの挙動: 既存の `parseFunctionAxes` (cli.ts:348) が未知 ID を `INVALID_METRIC` で弾くので、追加実装は不要。

検証:
- `pnpm test` で全体 green。
- `pnpm start comp` を 1 回回し、`callerCount` キーが出力 JSON / Markdown のどこにも残っていないことを目視確認。
- ranking の hotspot 候補が大きく崩れていないことを 1 件 dogfooding。`callerCount` が "leverage" カテゴリから抜けても co-occurrence の "any quality axis" 判定は影響を受けない (rank.ts:223) ことを再確認。

リスク:
- `callerCount` を頼りにしていた既存ユーザーは ranking の安定性が変わったと感じる可能性。CHANGELOG / release note で明示的に削除を案内。

### M2 — tsconfig 依存撤廃 + git ls-files への切替

決定: D2 / D3 / D4 / D5 / D6 / D7。

- `src/loader/load-project.ts` を書き換え: `LoadProjectOptions { rootDir: string }` を受け、`Project` を `compilerOptions` のみで作り、git ls-files の結果を `addSourceFilesAtPaths(paths)` で投入。`walkTsconfigReferences` / `TsconfigNotFoundError` を削除。
- 新規 `src/loader/listRepoSources.ts` (仮): `git ls-files -z -- '*.ts' '*.tsx' '*.mts' '*.cts'` を `rootDir` で実行し、`DEFAULT_EXCLUDE_GLOBS` + ユーザー指定 `--exclude` で filter、絶対パスで返す。`dup` の `listBaseSources` を参考にするが「base SHA を読む」部分は不要 (workdir のディスクから直接読めばよい)。
- `src/cli.ts` の `resolveTsconfigPath` を `resolveRepoRoot` に置換: positional path → `findGitRoot` で repo root を解決。失敗時は `NOT_A_GIT_REPOSITORY` エラー (D7)。
- `prepare()` (cli.ts:387) を rootDir ベースに書き換え。`projectInfo.tsconfigPath` フィールドは schema から削除 (`schema.ts:75`)。
- `dismiss` / `list-dismissed` / `undismiss` の `--path` help text を更新 (D6)。registry 配置は `rootDir = git repo root` に統一。既存 registry の互換: tsconfig 親ディレクトリを使っていた既存配置はそのまま読み込めるか要確認 (`src/dismissal/store.ts` の `withProjectPath` 挙動次第)。
- `enumerateSourceFiles` の役割を縮小: `project.getSourceFiles()` を返すだけ (列挙は `listRepoSources` が担う)。あるいは関数ごと削除して `listRepoSources` の結果を `Project.addSourceFilesAtPaths` 後に取り直す形にする (実装着手時に綺麗な分割を選ぶ)。

検証:
- 単体テスト: `listRepoSources` を git fixture (untracked / .gitignore / submodule / 非 TS 拡張子) で網羅。
- e2e: `comp` を tsconfig 無しのリポで回して動くことを確認 (これが本計画のメインの売り)。pnpm-workspace な monorepo fixture を 1 つ追加し、root で `comp` を打つだけで全パッケージの関数が ranking に出ることを確認。
- 既存リグレッション: 本リポ自身に `comp` を打って ranking の大部分が同じ関数を指すことを目視 (callerCount 除去で一部順位が動くのは想定内)。

リスク:
- tsconfig の `paths` で alias 解決していた場合、import 解析は不要だが **コメント中の `// @ts-expect-error` 等で強制エラーを期待する記述があるソースで parse がコケないか**は要確認 (`ts.createSourceFile` は parseDiagnostics を出すだけで throw はしないので影響軽微の見込み)。
- `git ls-files` は untracked を含めない (デフォルト `--cached` のみ)。新規 `.ts` ファイルを analyze 対象に入れたければ `--others --exclude-standard` を足すか、要件として "コミットしてから回す" にするかを D3 着手時に再確認。`dup` は `git ls-tree <sha>` でコミット済みしか見ないので、`comp` だけ untracked を含めると非対称が生まれる点に注意。

### M3 — ドキュメント書き直し + 旧計画 supersede

決定: D8。

- `README.md` の `comp` セクションを書き直し: tsconfig 言及を削除、"git repo 配下で動く" "monorepo もそのまま動く" を 1 文で済ませる。"Solution-style monorepo" の段落 (`README.md:44`) は削除。
- `docs/requirements.md`: §53 (TypeChecker 動機)、§65 (file-level 軸の言い訳)、§95 (callerCount 軸定義)、§203 (file 軸の代替) を削除または書き直す。`callerCount` 由来の記述が消えると "file-level 指標を持たない理由" が薄くなる (元々 "callerCount で代替" と言っていたため) — 「v1 のスコープを最小に保つ」程度の記述に置き換える。
- `docs/plans/comp-monorepo-tsconfig-discovery.md` の冒頭に "**Superseded by [comp-drop-callercount.md](./comp-drop-callercount.md) (2026-MM-DD)**: tsconfig 依存自体を撤廃したため、本計画の monorepo discovery は不要になった" を追記 (D8)。
- `docs/dogfooding-prompt.md` (もし `callerCount` 言及があれば) を更新。

検証:
- README を cold で読み直し、`callerCount` / `tsconfig` の単語が `comp` 関連箇所から消えていることを確認。
- `pnpm start comp` の出力 envelope (`status` / `tool` / `project` / `hotspots`) が docs の例と一致することを確認。

## 6. リスク / 横断論点

- **callerCount 喪失の運用影響**: leverage 軸が `commitCount` 1 つになる。co-occurrence の `axisHitCount >= 3` 判定 (rank.ts:222) は他の quality 軸が複数あるので発火条件は変わらないが、「変更頻度は低いが call site 多数」というシグナルは取れなくなる。dogfooding で違和感があれば D1 の (c) (opt-in flag) に後退する余地は残す。
- **ts-morph 維持の代償**: TypeChecker を切っても ts-morph `Project` 構築 + ファイル投入のオーバーヘッドは残る。これが許容範囲かは M1 後の dogfooding で計測 (簡易タイマで `loadProject` の wall clock を比較)。許容範囲外なら D2 の (b) を別計画として立てる。
- **registry の互換性**: 旧運用では rootDir = tsconfig 親ディレクトリだったが、新運用では rootDir = git repo root。両者が一致するリポでは無問題、subpath で `comp` を打っていた利用者には dismissal registry が "見つからない" 形で出る可能性。`store.ts` の挙動を読んだ上で M2 着手時に migration が要るか確認。
- **`comp` と `dup` の "微妙な不一致"**: 本計画後でも `comp` は workdir / `dup` は git ls-tree (`git show`) で読む差は残る。これは設計意図の差なので積極的に揃えない (§2.4)。リファレンス実装として「`dup` の `listBaseSources` ≒ `comp` の `listRepoSources` だが SHA 解決の有無が違う」だけが共通項。
- **strip-only 制約**: 新規追加コード (`listRepoSources` 等) は `enum` / `namespace` / parameter properties を使わない。`tools/check-strip-only.ts` の既存チェックで自動的に拾われる。

## 7. 決定済み事項

(M1 着手時に D1-D9 を確定する。それまで本セクションは空。)
