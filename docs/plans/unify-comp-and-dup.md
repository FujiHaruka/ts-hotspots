## `comp` / `dup` 段階的統合 計画

> Status: Completed 2026-05-01 (M1–M5 shipped)
> Goal: `complexity` (`comp`) と `duplication` (`dup`) は別コマンドのまま、ユーザー体験 (CLI シェイプ・出力スキーマ・エージェント向け表現) を一貫させる。
> 非 Goal: `scan` のような単一コマンドへの再統合 (検討済み・採用しない。`docs/plans/scan-command.md` を削除した経緯はこの文書で吸収する)。

## 0. Progress

このセクションは進捗トラッカ。各 M 完了時にチェックを埋める。"次のマイルストーン" は最初の未チェック項目を指す。

- [x] **M1** — フラグ語彙の統一 (破壊変更含): `--limit` / `--format` / `[path]` / `--exclude` / `--json` 廃止 / `--repo` 廃止 / `--top` CLI 削除 / help text 揃え
- [x] **M2** — JSON 封筒の統一 (破壊変更含): `status` / `tool` / エラー envelope / 座標文字列化 / `comp:` prefix 先取り + registry migration
- [x] **M3** — Markdown 表現の統一 (加算): agent-first wrap を `dup` にも / streaming head / stderr stats line
- [x] **M4** — `comp --pr <revrange>` 追加 (加算): changed files に絞った hotspot 出力 / `parseRevRange` 共有
- [x] **M5** — `dup` の dismissal 追加 (加算): 群正規化 hash + `dup:` prefix routing

## 1. 経緯

`docs/plans/scan-command.md` (M5 RFC) では `comp` と `dup` を `scan` という単一コマンドに統合する案を検討した。狙いは「エージェントに 1 リクエストで両軸を渡したい」だったが、以下の理由で取り下げた:

- 2 軸はコスト構造がまったく違う (`comp` 数秒、`dup --whole-repo` 数十秒〜分) ので「いつでも両方走らせる」前提が破綻する
- 出力単位が違う (関数 ref vs. fragment 群) ので統合スキーマは "並べただけ" の和集合になり、独自価値が薄い
- 既存サブコマンドを残しつつ追加するなら `scan` は単なる薄い wrapper になり、保守コストが純増

採用方針は **「2 コマンドのままで、表面の一貫性を上げる」**。エージェント / CI / 人間のいずれが触っても "同じツールの 2 機能" に見える状態にする。`scan` 計画で挙げた論点 (PR モードでの hotspot, dedup の dismissal, 出力サイズ) は本計画の M4 / M5 に引き継ぐ。

## 2. 現状の差分インベントリ

`comp` (= `src/cli.ts`) と `dup` (= `src/duplication/cli/`) は別実装で、以下が食い違っている。マイルストーン設計の素材として一度全部並べる。

### 2.1 CLI シェイプ

| 観点 | `comp` | `dup` |
|---|---|---|
| パーサ | `commander` | `node:util` の `parseArgs` |
| プロジェクト指定 | 位置引数 `[path]` (tsconfig を解決) | `--repo <path>` (git リポを解決) |
| 件数制限 | `--top <N>` (既定 5, "軸ごとの上位 N") | `--limit <N\|all>` (既定 20, "群の上限") |
| 出力形式 | `--json` (bool, 付けると JSON) | `--format markdown\|json` (既定 markdown) |
| 除外 glob | `--exclude <glob...>` (既定の test 除外を **置換**) | `--exclude <glob>` 反復 (既定リストに **追加**) |
| ヘルプ | commander auto | 手書き USAGE 定数 |
| Markdown ストリーミング | あり (head 先出し → body 後出し) | なし (全体を最後に出す) |
| stderr 統計行 | なし | `ts-hotspots duplication: ...` を末尾に出す |
| 補助サブコマンド | `dismiss` / `list-dismissed` / `undismiss` | なし |
| 性能ログ | なし | `--phase-timings[=summary\|verbose]` |
| PR モード | なし (常に tree 全体) | `<revrange>` で対応 |

### 2.2 出力スキーマ

| 観点 | `comp` | `dup` |
|---|---|---|
| トップレベル | `FunctionReport { status, tool, project, functionHotspotCandidates, ... }` | `CloneCandidateReport { summary, groups }` |
| `status` フィールド | あり (`"ok"` / `"error"`) | なし |
| `tool: { name, version }` | あり | なし |
| エラー出力 | stdout に JSON 封筒 (`status: "error"`) | stderr にテキストのみ |
| 座標 | `location: "file:start-end"` 文字列 | `{ file, startLine, endLine }` 構造体 |
| Markdown 先頭 | エージェント向けプロンプト + fenced JSON | 通常の Markdown 見出し |

### 2.3 共通基盤の有無

`comp` の loader (`loadProject` + ts-morph) と `dup` の indexer (`typescript` 直叩き + git ls-tree) は完全に独立。共有しているのは `package.json` と Node 24+ の strip-only 制約だけ。これは性能上の判断で正しいので統合しない (M2 以降の論点)。

## 3. Approach

統合は「**外側 (ユーザーが触る面) から内側 (実装) へ**」段階的に進める。各マイルストーンは独立にリリース可能で、内部実装の合流は強制しない:

- **M1: フラグ語彙の統一** — 同じ概念は同じ名前で。実装は両側そのまま。
- **M2: JSON 封筒の統一** — `tool` / `status` / エラー envelope / 座標表現を揃える。スキーマ追加のみで破壊変更は最小化。
- **M3: Markdown 表現の統一** — agent-first な prompt wrap を `dup` にも入れ、`render` ヘルパを共有。
- **M4: 機能の交差 — `comp` に PR モード**。`scan` 計画 §8.1 の判断を持ち込む。
- **M5: 機能の交差 — `dup` に dismissal**。`scan` 計画 §8.2 の判断を持ち込む。

設計上のキー判断:

- **同名 = 同義**。`--format`、`--limit`、`--exclude` などは両コマンドで完全に同じ意味で使う。意味がずれるなら別名にする。
- **デフォルト挙動を揃える > 互換シム**。例えば `--exclude` が "置換" か "追加" かは片方に寄せて他方を直す。両モードを混在させない。
- **共有コードは "薄く"**。出力 envelope や Markdown prelude のような薄い層だけ共有する。loader / indexer / collector / scoring は共通化しない (性能と独立性を優先)。
- **破壊変更は M1 + M2 までに集約**。M3 以降は加算的にする (既存利用者を 2 度壊さない)。
- **CLI パーサは統一しない**。`comp` は commander、`dup` は parseArgs のまま。表面挙動が一致していれば実装の足並みを揃える価値は薄い。

## 4. 統合する項目 / 分離しておく項目

### 4.1 統合する (= 一貫させる)

| 項目 | 統合後の姿 (案) |
|---|---|
| 出力形式フラグ | `--format markdown\|json` (両コマンド共通、既定 `markdown`) |
| 件数制限フラグ | 用語を 1 本化 (§5.1 で決定) |
| プロジェクト位置指定 | 位置引数 `[path]` を両コマンドで受け、内部で tsconfig / git repo を導出 |
| `--exclude` セマンティクス | 既定リストへの **追加** で統一 (`dup` の現挙動に寄せる) |
| エラー封筒 | stdout に `{ status: "error", error: { code, message } }` を JSON / Markdown それぞれの形で吐く |
| `tool: { name, version }` | JSON 出力の先頭、Markdown body 冒頭 (head の instruction セクションには含まない; D8/B1 と整合) |
| 座標一次表現 | `location: "file:start-end"` 文字列のみ (`comp` 形に統一; LLM トークン経済優先) |
| Markdown プロンプト wrap | `dup` にも agent-first 冒頭プロンプトを入れる |
| ストリーミング先頭出力 | 重い処理前に Markdown head を flush する挙動を両者で揃える |
| stderr 統計行 | フォーマット (`ts-hotspots <cmd>: ...`) を共通の helper で出す |

### 4.2 分離しておく (= 統合しない)

| 項目 | 理由 |
|---|---|
| loader / indexer の実装 | `comp` は ts-morph + TypeChecker、`dup` は `typescript` 直叩き + git ls-tree。コスト構造が違うので統合は性能を落とすだけ |
| 機能固有フラグ | `--metrics` / `--full` / `--no-churn` (`comp` 側), `--no-code` / `--phase-timings` / `--ref` (`dup` 側)。共通化する意味がない |
| 性能ログ (`--phase-timings`) | `dup` のパイプライン段階構造に依存。`comp` には該当する分割がない |
| 出力スキーマの中身 | `FunctionReport` と `CloneCandidateReport` は別型。トップレベル envelope を共通化するだけにとどめる |
| CLI パーサライブラリ | `comp` の commander、`dup` の `parseArgs` はそれぞれの選択理由がある (commander は dismissal subcommands を扱いやすい、parseArgs は依存ゼロで dup 単体テスト容易) |
| README quick-start | 1 機能 1 セクションを維持。"両方を 1 コマンドで" という導線は v1 では作らない |

### 4.3 意思決定が必要な点

各 M で決めるべき項目を先に明示する。決定は M 着手時に dogfooding 1 周を踏まえて確定する。

| ID | 論点 | 案 | 暫定 |
|---|---|---|---|
| D1 | 件数制限フラグ名 | (a) `--limit` に統一 (b) `--top` に統一 (c) 別名のまま (d) 両コマンドが両方を受ける相互エイリアス | **決定: (a)**。`comp` / `dup` ともに user-facing は `--limit` のみ。`comp` の現 `--top` は内部定数化 (A1: `--top` を CLI から外す) し、既定値は現状の 5 から引き上げ余地あり (M1 で確定)。`--full` モードでの `--limit` は `functionHotspotCandidates[]` のみに適用 (X)。`--file <path>` モードでは `--limit` は無視するが stderr 警告を出す (P+警告) |
| D2 | `--json` の扱い | (a) `--json` を完全廃止 (b) `--format json` の別名として残す (c) 残す (恒久) | **決定: (a)**。M1 は元々破壊変更マイルストーンなので互換シムを増やさない。CHANGELOG と移行ノートで `--json → --format json` を案内 |
| D3 | 位置引数の意味 | (a) `[path]` = tsconfig を内包するディレクトリ (両コマンド共通) (b) `[path]` = git repo ルート (c) コマンドごとに意味を変える (現状維持) | **決定: (a)**。`comp` 現挙動を踏襲し、`dup` 側は positional path から git repo root を上方探索する。サブパッケージの tsconfig を直接渡す運用も許容 (monorepo 対応)。`path` 直下に tsconfig が無い場合の子ディレクトリ探索は将来拡張として保留 |
| D4 | `--exclude` のセマンティクス | (a) 既定に追加 (`dup` 現挙動) (b) 既定を置換 (`comp` 現挙動) (c) (a) + `--no-default-exclude` でエスケープ | **決定: (a)**。両コマンドで「ユーザー指定 glob は組み込みデフォルトに追加」で統一。`comp` の現挙動 (test 除外を置換可能) は失われるが、エスケープハッチは必要になってから追加する。test 含めたい既存ユーザー向けの移行ノートを M1 リリースに添える |
| D5 | エラー封筒の形 | (a) `comp` 側の `{ status: "error", error: { code, message } }` を `dup` にも導入 (b) 既存 `summary` ベースの dup スキーマに `error?` を埋める (c) 現状維持 (`dup` は stderr のみ) | **決定: (a)**。`dup --format json` 失敗時は stdout に `{ status: "error", error: { code, message } }`、`--format markdown` 失敗時は `# ts-hotspots error` ボディを stdout に出す。stderr には人間向け詳細。エラーコード語彙 (`INVALID_REVRANGE` / `GIT_FAILED` / 等) は M2 実装時に確定。streaming 中の失敗は head 出力後に続きとしてエラーボディを追記 (`comp` の現挙動踏襲) |
| D6 | 座標の primary 表現 | (a) 構造体 + 文字列併記 (b) 構造体のみ (`dup` 現状) (c) 文字列 `"file:start-end"` のみ (`comp` 現状) | **決定: (c)**。`dup` を `comp` 形に寄せる。LLM 主要 consumer ではトークン数が小さい方が良く、構造体併記は SSOT 違反でメリットが薄い。CI / programmatic consumer は文字列を 1 回 split すれば足りる。M2 で `dup` の fragment / member が `location: string` を持つ形に統一 |
| D7 | Markdown prompt prelude | (a) `comp` と同じ "instruction + fenced JSON" を `dup` にも導入 (b) `dup` は対人 Markdown のまま、`--agent` で wrap (c) 両コマンドで Markdown = 常に "instruction + fenced JSON"、対人 Markdown は廃止 | **決定: (c)**。`--format markdown` = agent-first wrap、`--format json` = raw JSON の 2 軸に固定。`dup` の現対人 Markdown レンダラ (`buildMarkdownReport`) は M3 で wrap 形式に置き換える。対人レンダリングが必要なら `--format json \| jq` で代替 (requirements.md §2 の "agent-first output" 原則と整合) |
| D8 | Streaming preamble | (a) `dup` にも head 先出しを導入 (b) `dup` は遅延フィードバック許容 (c) (a) + `--no-head` opt-out | **決定: (a)**。`dup --format markdown` でも処理開始前に head (instruction のみ; scope 情報は body 側) を flush し、`claude --permission-mode plan` の 3s detect 窓に間に合わせる。head 後の致命エラーは `renderMarkdownErrorBody` と同じパターンで body に追記 (`comp` 現挙動踏襲)。head の内容は `comp` と同じ "instruction only" (B1) で、scope 情報は body 側に置く |
| D9 | `comp` の PR モード (M4) | (a) 案 Y: 計測は head ref 全体・出力は changed files の関数のみ (b) 案 X: tree 全体 (c) 案 W: 既定 Y / `--full-tree-hotspots` で X (旧 scan §8.1 結論) (d) 案 Z: Y + PR 由来 churn 強調 | **決定: (a) シンプル版 Y**。`comp --pr` は changed files に属する関数のみを出力。ranking 計算は分布が壊れないよう head ref 全体で走らせ、出力段でフィルタ。`--full-tree-hotspots` は YAGNI で足さず、必要なら `--pr` を外せばよい。Z (churn 強調) は後続改善 |
| D10 | `dup` の dismissal ID 戦略 (M5) | (a) 案 P: 群正規化 hash (members `bodyHash` をソート → 連結 → hash) (b) 案 Q: anchor bodyHash (c) 案 R: M5 で見送り (d) 案 S: pair-level (e) 案 T: モード別 P/Q | **決定: (a) 案 P**。失効しやすい方にバイアス (= "false expiration を許容、false persistence は避ける")。これは `dup` 検出側の "recall over precision" と整合。再 dismiss コストは許容。fuzzy match (`dismiss された members の N% 以上を含む新群は同一視`) や stderr ヒント (`過去に dismiss された群が失効しました`) は後付けの拡張余地として残す |
| D11 | dismissal subcommands の所属 | (a) トップレベル維持 + ID から内部 lookup (b) feature 配下 (`comp dismiss` / `dup dismiss`) (c) (a) + ID に feature プレフィックス (`comp:abc...` / `dup:def...`) で曖昧解消 | **決定: (c)**。`ts-hotspots dismiss <id>` のフラットな配置を維持。`dismissalId` は `<feature>:<hash>` 形式 (例: `comp:a3f9c2...` / `dup:b8d4e1...`) にして prefix から routing。`--feature` フラグは不要。registry レイアウトは案 X (1 ファイル `dismissed.json`、entry に `feature` フィールドを追加)。既存 entry は prefix 無し = `comp` とみなして自動 migration |

## 5. マイルストーン

各 M は基本的に独立してリリース可能。例外として M5 は M2 後を前提とする — M2 で `comp` の `dismissalId` を `comp:<sha256>` 形式に先取り変更し registry migration も済ませるため、M5 は `dup` 側を加算するだけになる。M1 + M2 が破壊変更を含むため 0.x 系のバージョンをここで上げる。M3 / M4 / M5 は加算的。

### M1 — フラグ語彙の統一 (破壊変更含)

決定: D1 / D2 / D3 / D4。

- 件数制限フラグを `--limit` に統一 (D1)。`comp` の `--top` は CLI から完全削除 (内部定数化)。`--full` モードでの `--limit` は `functionHotspotCandidates[]` のみに適用、`--file <path>` モードでは無視 + stderr 警告。
- 出力形式フラグを `--format markdown|json` に統一 (D2)。`comp --json` は完全廃止、互換 alias は置かない。
- 位置引数 `[path]` を `dup` でも受け付け、tsconfig 親ディレクトリ意味論に統一 (D3)。`dup` 側は path から git repo root を上方探索する。`--repo` 既存フラグは互換 alias を置かず M1 で完全廃止 (D2 と同じ姿勢)。
- `--exclude` を両コマンドで「組み込みデフォルトに追加」セマンティクスに統一 (D4)。統一後のデフォルトは `dup` 現在の 17 件 (`node_modules/**`, `dist/**`, `**/*.{test,spec}.*` 等) をベースにする。`comp` の現デフォルト (`**/*.{test,spec}.{ts,tsx,mts,cts}`) は dup 側に内包されるので merge は二重定義にならない。エスケープハッチ (`--no-default-exclude` 等) は YAGNI で足さない。
- ヘルプテキスト (commander auto / 手書き USAGE) を新フラグ語彙に揃える。両コマンドで help format の "形" が揃って見えることを目視確認する。

検証: 既存 e2e テスト + `tools/check-strip-only.ts` + 新規追加の "両コマンドが同じフラグを同じ意味で受ける" cross-CLI テスト。

成果物: README quick-start の `comp` / `dup` 両セクションでフラグの説明文がそのまま使い回せる状態。

### M2 — JSON 封筒の統一

決定: D5 / D6。

- 両コマンドの JSON 出力に `{ status: "ok" | "error", tool: { name, version }, ... }` の共通封筒を導入 (D5)。
- 失敗時は stdout に `{ status: "error", error: { code, message } }` を出し、stderr には人間向け詳細 (`comp` 現挙動を `dup` にも展開)。エラーコード語彙 (`INVALID_REVRANGE` / `GIT_FAILED` / 等) は実装時に確定。streaming 中の失敗は head 出力後に body にエラーを追記する `comp` パターンを踏襲。
- 座標の一次表現を `location: "file:start-end"` 文字列に統一 (D6)。`dup` の `{ file, startLine, endLine }` 構造体は出力 JSON / Markdown から削除し、文字列のみを露出。reporter 内部で line 情報が必要な場面は構造体を保持してよいが、表面には出さない。
- `comp` の `dismissalId` を `comp:<sha256>` 形式に M2 で先取り変更し、registry 読み込み時の migration (旧 prefix 無し entry を `feature: "comp"` で補完) も M2 で入れる。これにより M5 では `dup:` 系を追加するだけで registry スキーマには触らず、破壊変更を M1+M2 ウィンドウに集約できる。

検証: snapshot テスト 2 種 (`comp` / `dup` ともに ok / error の 2 ケース)。`docs/dogfooding-prompt.md` の手順を更新し、エージェントが両出力を同じ envelope ロジックで扱えることを確認。

### M3 — Markdown 表現の統一

決定: D7 / D8。

- `dup` の Markdown 出力を agent-first wrap (instruction + fenced JSON) に置き換える (D7)。`comp` 側の prelude を抽象化し、feature 名と入力概要だけ差し替える形にする。`dup` の現対人 Markdown レンダラ (`buildMarkdownReport`) は廃止。
- `dup` でも処理開始前に Markdown head を flush し、`| claude --permission-mode plan` の 3s detect 窓に間に合わせる (D8)。head は instruction のみ (B1; scope 情報は body 側)。
- stderr 統計行を両コマンドで共通フォーマット (`ts-hotspots <cmd>: ...`) に揃える。`comp` 側 (現状 stats 行なし) にも同形の 1 行サマリを追加する。
- `src/reporter/render.ts` から共通 helper を抽出 (`renderHead({ feature })` / `renderErrorBody` / `renderStatsLine`)、`comp` / `dup` の reporter から呼ぶ。実装の重複は許容、共通化は表面文言と構造だけ。

検証: snapshot テスト + `docs/dogfooding-prompt.md` を 1 リポで実機回し、両コマンドの prelude が同じ "形" になっていることを目視確認。

### M4 — `comp` の PR モード (cross-feature)

決定: D9。

- `comp --pr <revrange>` を新規追加 (D9)。出力は changed files に属する関数のみ。`--full-tree-hotspots` 等のエスケープは設けない (`--pr` を外せば従来挙動)。
- ranking 計算は head ref 全体で走らせ、出力段でフィルタする (分布が壊れないように)。これは D9 で確定済みの実装方針。
- diff の解決は `dup` の `parseRevRange` / git 周りロジックを `src/util/git/` に切り出し、両コマンドから呼ぶ。これは "薄い共有" の数少ない例外。
- churn 軸の振る舞いは PR モードでもそのまま (PR 由来 churn の特別強調 = scan §8.1 の Z 案は後続改善扱い)。

検証: PR モードと whole-repo モードで結果が変わることを示す e2e テスト + 1 件の dogfooding。

リスク: changed files に該当する関数が 1 件もない PR (typo fix, 設定ファイル変更だけ) では出力が空になる。"changes have no scoring functions" 旨を Markdown body / JSON status に明示するハンドリングが必要。

### M5 — `dup` の dismissal (cross-feature)

決定: D10 / D11。

- `dup` 群の dismissal ID = members `bodyHash` をソート → 連結 → SHA-256 (D10 / 案 P)。群構成が変われば自動失効するバイアス (recall over precision の dismissal 版)。
- dismissal subcommands は `ts-hotspots dismiss <id>` のフラット配置を維持し、ID 自体に feature プレフィックスを埋め込む (D11 / 案 C)。`dismissalId` 形式: `comp:<sha256>` / `dup:<sha256>`。routing は prefix から行うので `--feature` 不要。
- registry の `feature` フィールド対応と `comp:` prefix 化は M2 で先取り済みなので、M5 では `dup` 用の dismiss / list-dismissed / undismiss 経路と `dup:` prefix の registry entry を追加するだけ。registry スキーマは触らない。

検証: dismissal の round-trip (dismiss → 次回 run で消える → undismiss で戻る) が両機能で同じ挙動になる e2e テスト。

リスク: 群の正規化キーは群構成変化で容易に失効する。再 dismiss コストが許容を超えたら fuzzy match レイヤ ("過去 dismiss された members の N% 以上を含む新群は同一視") を後付けで足す。stderr ヒント ("過去に dismiss された群が失効しました") も改善余地。

## 6. リスク / 横断論点

- **0.x 利用者への影響**: M1 + M2 は flag / スキーマ / dismissalId 形式の破壊変更を集約 (M2 で `comp:` prefix 化を先取り)。CHANGELOG 一本にまとめ、移行ノート (旧フラグ → 新フラグ表、旧 dismissalId → prefix 付き) を README ではなく `docs/` 側に置く (CLAUDE.md の "user docs は first-time reader 向け" 指針に従う)。
- **共有コードの肥大化**: M3 / M4 で `src/util/` 系に共通モジュールを置くと、両機能から強い依存を受けて実装の独立性が崩れる懸念がある。共有は「envelope, render head, git rev parse」の 3 点に限定し、それ以上は片方の実装にローカル化する。
- **CLI パーサの混在**: commander と parseArgs の両立は内部だけの問題だが、ヘルプの見た目が違うので "ツールの一体感" を損なう。M1 でヘルプテキストの "形" は揃える (M1 bullet 5)。本格的な統一 (どちらかに寄せる) は本計画のスコープ外。
- **`scan` 復活の誘惑**: 本計画を進めると "もう envelope も Markdown も同じなんだから 1 コマンドにすればいい" という議論が再燃する可能性がある。本計画では `scan` 復活は明示的に non-goal とする。再検討するなら新計画を立てる。

## 7. 決定済み事項

- **D3 (位置引数の意味)**: `[path]` = tsconfig を内包するディレクトリ (案 A)。`dup` 側は path から git repo root を上方探索する。サブパッケージ tsconfig の直接指定で monorepo 部分スコープに対応。`path` 直下に tsconfig が無い場合の子ディレクトリ探索は将来拡張。
- **D4 (`--exclude` のセマンティクス)**: ユーザー指定 glob は組み込みデフォルトリストに追加 (案 A)。`comp` 側の "デフォルトを置換可能" な現挙動は失われる。エスケープハッチ (`--no-default-exclude` 等) は必要になってから追加する YAGNI 方針。
- **D1 (件数制限フラグ名)**: `--limit` に統一 (案 A)。`comp` の現 `--top` は CLI から外して内部定数化 (A1)。`--full` 時の `--limit` 適用範囲は `functionHotspotCandidates[]` のみで、他の配列 (`functionRankings` / `functions[]` / `functionCoOccurrence`) は内部定数の支配下に置く (X)。`--file <path>` モードでは `--limit` を無視し stderr に警告を出す (P+warn)。`--top` の内部既定値 5 が小さすぎる件は M1 実装時に再検討する。
- **D2 (`--json` の扱い)**: `comp --json` は M1 で完全廃止 (案 A)。互換シムは置かない。CHANGELOG に `--json → --format json` の移行ガイドを記載。
- **D5 (エラー封筒の形)**: `comp` の `{ status: "error", error: { code, message } }` 形を `dup` にも展開 (案 A)。json モードでは stdout に JSON 封筒、markdown モードでは stdout に `# ts-hotspots error` ボディ、stderr には人間向け詳細。エラーコード体系は M2 実装時に整理 (`INVALID_REVRANGE` / `GIT_FAILED` 等の追加)。
- **D6 (座標の primary 表現)**: `location: "file:start-end"` 文字列のみ (案 C)。`dup` 側を `comp` 形に寄せる。理由は LLM 主要 consumer ではトークン数が小さい方が良く、構造体併記の SSOT 違反コストに見合うメリットがないため。programmatic consumer (CI / dashboards) には軽い split を要求する。
- **D7 (Markdown prompt prelude)**: `--format markdown` は両コマンドで agent-first wrap (instruction + fenced JSON) に統一 (案 C)。対人 Markdown レンダラは廃止。requirements.md §2 の "agent-first output" 原則を `dup` にも適用する形。対人用途は `--format json | jq` 等で代替。
- **D8 (Streaming preamble)**: `dup --format markdown` でも処理前に head を先出し (案 A)。`claude --permission-mode plan` の 3s detect 窓に間に合わせる。head は instruction のみで scope 情報は body 側 (B1; `comp` と一貫)。head 後に致命エラーが起きたら body にエラーを追記する `comp` 現挙動を踏襲。
- **D9 (`comp` の PR モード)**: シンプル版 Y (案 A)。`comp --pr <revrange>` は changed files に属する関数のみを出力。ranking 計算は分布が壊れないよう head ref 全体で走らせ、出力段でフィルタ。`--full-tree-hotspots` 等のエスケープは YAGNI で足さない (必要なら `--pr` を外せばよい)。PR 由来 churn の強調も後続改善扱い。
- **D10 (`dup` の dismissal ID 戦略)**: 案 P (群正規化 hash; members `bodyHash` をソート → 連結 → SHA-256)。失効しやすい方にバイアスし `dup` 検出側の "recall over precision" と一貫させる。再 dismiss コストは許容。後付けで fuzzy match レイヤや "失効しました" stderr ヒントを足す余地は残す。
- **D11 (dismissal subcommands の所属 / registry 形)**: トップレベル `ts-hotspots dismiss <id>` を維持し、ID 自体に feature prefix を埋め込む形で routing (案 C)。`dismissalId` は `comp:<sha256>` / `dup:<sha256>` 形式。`--feature` フラグは不要。registry は単一 `dismissed.json`、entry に `feature` フィールドを追加 (案 X)。既存 entry は prefix 無し = `comp` として自動 migration。
- **D3 派生 (`--repo` フラグの去就)**: M1 で完全廃止 (互換 alias 無し)。`--json` 廃止 (D2) と同じ姿勢で、M1 の破壊変更ウィンドウに集約する。
- **D11 派生 (`comp:` prefix 化のタイミング)**: M5 ではなく M2 で先取り。`comp` の `dismissalId` を `comp:<sha256>` 化 + registry migration を M2 で完了させ、M5 は `dup` 側の加算のみに縮める。破壊変更を M1+M2 ウィンドウに集約してユーザー摩擦を最小化。
