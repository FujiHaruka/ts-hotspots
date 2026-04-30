## `comp` / `dup` 段階的統合 計画

> Status: Draft
> Goal: `complexity` (`comp`) と `duplication` (`dup`) は別コマンドのまま、ユーザー体験 (CLI シェイプ・出力スキーマ・エージェント向け表現) を一貫させる。
> 非 Goal: `scan` のような単一コマンドへの再統合 (検討済み・採用しない。`docs/plans/scan-command.md` を削除した経緯はこの文書で吸収する)。

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
| `tool: { name, version }` | 両コマンドの JSON / Markdown 双方の先頭に出す |
| 座標一次表現 | `{ file, startLine, endLine }` を一次、`location: "file:start-end"` を派生表記として併記 |
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
| D6 | 座標の primary 表現 | (a) `{ file, startLine, endLine }` 構造体を一次にし `location` 文字列を派生 (b) 文字列のみ | (a)。エージェントが Read tool に直接渡せるため |
| D7 | Markdown prompt prelude | (a) `comp` と同じ "instruction + fenced JSON" 形式を `dup` にも (b) `dup` は対人 Markdown のまま、`--agent` で wrap | (a)。両コマンドで `\| claude --permission-mode plan` にパイプして同じ振る舞いになる |
| D8 | Streaming preamble | (a) `dup` にも head 先出しを導入 (b) `dup` は処理が長い分、遅延フィードバックが許容される | (a)。`claude --permission-mode plan` の 3s detect 窓に間に合わせる |
| D9 | `comp` の PR モード (M4) | (a) 案 Y: 計測は head ref 全体だが出力は changed files の関数のみ (b) 案 X: tree 全体 (c) 既定 Y / `--full-tree-hotspots` で X (旧 scan §8.1 の結論) | (c) を継承 |
| D10 | `dup` の dismissal ID 戦略 (M5) | (a) 案 P: 群正規化 hash (b) 案 Q: anchor bodyHash (c) 案 R: M5 で見送り | M5 着手時に dogfooding ノイズ分布を見て決める。現時点の暫定は (c) |
| D11 | dismissal subcommands の所属 | (a) トップレベル維持 (`ts-hotspots dismiss <id>`) (b) feature 配下 (`ts-hotspots comp dismiss <id>` / `ts-hotspots dup dismiss <id>`) | M5 で `dup` 側にも dismissal を入れる場合 (b) 検討。それまで (a) |

## 5. マイルストーン

各 M は独立してリリース可能。M1+M2 は破壊変更を含むため 0.x 系のバージョンを 1 段上げる想定。M3 以降は加算的。

### M1 — フラグ語彙の統一 (破壊変更含)

決定: D1 / D2 / D3 / D4。

- 両コマンドで `--format markdown|json` を採用。`comp --json` は別名として残す (D2)。
- `dup` で位置引数 `[path]` を受け付け、git repo root を上方探索する (D3)。`--repo` も別名として残す。
- `--exclude` は両コマンドで「既定リストに追加」セマンティクスに統一 (D4)。`comp` の現挙動 (test 除外を置換可能) は失われるので、test も含めたいときは `--exclude '!**/*.test.ts'` 等のネガティブ glob 追加も同時に検討する (mod 案: 別 flag `--no-default-exclude`)。
- 件数制限フラグ名 (D1) を確定し、片方は alias として残す。

検証: 既存 e2e テスト + `tools/check-strip-only.ts` + 新規追加の "両コマンドが同じフラグを同じ意味で受ける" cross-CLI テスト。

成果物: README quick-start の `comp` / `dup` 両セクションでフラグの説明文がそのまま使い回せる状態。

### M2 — JSON 封筒の統一

決定: D5 / D6。

- 両コマンドの JSON 出力に `{ status: "ok" \| "error", tool: { name, version }, ...}` の共通封筒を導入。
- 失敗時は stdout に `{ status: "error", error: { code, message } }` を出し、stderr には人間向け詳細を出す (`comp` の現行挙動を `dup` にも展開)。
- 座標の一次表現を `{ file, startLine, endLine }` 構造体に揃える (`comp` 側の `location` 文字列を併記する派生フィールドにする)。
- スキーマ型 (`schema.ts` / `domain/`) を更新し、両側で同名の `Coordinate` 型を共有する (両者の出力 JSON が `Coordinate` の同一形を持つ、というレベルの共有。型は重複定義してよい)。

検証: snapshot テスト 2 種 (`comp` / `dup` ともに ok / error の 2 ケース)。`docs/dogfooding-prompt.md` の手順を更新し、エージェントが両出力を同じ envelope ロジックで扱えることを確認。

### M3 — Markdown 表現の統一

決定: D7 / D8。

- `dup` の Markdown 出力に agent-first 冒頭プロンプトを差し込む。`comp` 側の prelude を抽象化し、feature 名と入力概要だけ差し替える形にする。
- `dup` でも長時間ジョブ前に Markdown head を flush し、`\| claude --permission-mode plan` の検出窓に間に合わせる (D8)。
- `src/reporter/render.ts` から共通 helper を抽出 (`renderHead({ feature, scope })` / `renderErrorBody`)、`comp` / `dup` の reporter から呼ぶ。実装の重複は許容、共通化は表面文言と構造だけ。

検証: snapshot テスト + `docs/dogfooding-prompt.md` を 1 リポで実機回し、両コマンドの prelude が同じ "形" になっていることを目視確認。

### M4 — `comp` の PR モード (cross-feature)

決定: D9。

- `comp --pr <revrange>` を新規追加。意味論は scan §8.1 の (c) を採用: 既定は changed files に属する関数のみ、`--full-tree-hotspots` で従来の repo 全体に戻せる。
- diff の解決は `dup` の `parseRevRange` / git 周りロジックを `src/util/git/` に切り出し、両コマンドから呼ぶ。これは "薄い共有" の数少ない例外。
- churn 軸の振る舞いを PR モードでも維持 (PR の影響で churn が高まったケースは `--pr` 出力で強調表示)。

検証: PR モードと whole-repo モードで結果が変わることを示す e2e テスト + 1 件の dogfooding。

リスク: hotspot ranking は tree 全体の分布に依存しているので、changed files に絞ると軸の正規化基準がぶれる可能性。先に `--pr` で計測を絞らず、出力で絞る方式に倒すのが無難。

### M5 — `dup` の dismissal (cross-feature)

決定: D10 / D11。

- `dup` 群に安定 ID を付ける戦略を確定 (D10)。dogfooding 1〜2 周で群サイズの入れ替わり頻度を観察してから案を選ぶ。
- dismissal subcommands の API を `comp` / `dup` 両対応にする (D11)。トップレベル維持なら ID から feature を判定するロジックを足す。feature 配下に降ろすなら `comp dismiss` / `dup dismiss` を作って既存 `dismiss` を deprecate alias にする。
- registry ファイル名 / レイアウトは現行 `dismissed.json` に feature キーを足して 1 ファイルで管理する案を初期検討する。

検証: dismissal の round-trip (dismiss → 次回 run で消える → undismiss で戻る) が両機能で同じ挙動になる e2e テスト。

リスク: 群の正規化キーは群構成変化で容易に失効する。dismissal が "ほぼ自動失効" になるなら M5 全体を見送って scan §8.2 の (c) (= 段階3 で別解決) に倒す。

## 6. リスク / 横断論点

- **0.x 利用者への影響**: M1 + M2 は flag / スキーマの破壊変更。CHANGELOG 一本にまとめ、移行ノート (旧フラグ → 新フラグ表) を README ではなく `docs/` 側に置く (CLAUDE.md の "user docs は first-time reader 向け" 指針に従う)。
- **共有コードの肥大化**: M3 / M4 で `src/util/` 系に共通モジュールを置くと、両機能から強い依存を受けて実装の独立性が崩れる懸念がある。共有は「envelope, render head, git rev parse」の 3 点に限定し、それ以上は片方の実装にローカル化する。
- **CLI パーサの混在**: commander と parseArgs の両立は内部だけの問題だが、ヘルプの見た目が違うので "ツールの一体感" を損なう。M1 の派生として「ヘルプテキストを共通フォーマットに揃える」だけは検討。本格的な統一 (どちらかに寄せる) は別計画。
- **`scan` 復活の誘惑**: 本計画を進めると "もう envelope も Markdown も同じなんだから 1 コマンドにすればいい" という議論が再燃する可能性がある。本計画では `scan` 復活は明示的に non-goal とする。再検討するなら新計画を立てる。

## 7. 決定済み事項

- **D3 (位置引数の意味)**: `[path]` = tsconfig を内包するディレクトリ (案 A)。`dup` 側は path から git repo root を上方探索する。サブパッケージ tsconfig の直接指定で monorepo 部分スコープに対応。`path` 直下に tsconfig が無い場合の子ディレクトリ探索は将来拡張。
- **D4 (`--exclude` のセマンティクス)**: ユーザー指定 glob は組み込みデフォルトリストに追加 (案 A)。`comp` 側の "デフォルトを置換可能" な現挙動は失われる。エスケープハッチ (`--no-default-exclude` 等) は必要になってから追加する YAGNI 方針。
- **D1 (件数制限フラグ名)**: `--limit` に統一 (案 A)。`comp` の現 `--top` は CLI から外して内部定数化 (A1)。`--full` 時の `--limit` 適用範囲は `functionHotspotCandidates[]` のみで、他の配列 (`functionRankings` / `functions[]` / `functionCoOccurrence`) は内部定数の支配下に置く (X)。`--file <path>` モードでは `--limit` を無視し stderr に警告を出す (P+warn)。`--top` の内部既定値 5 が小さすぎる件は M1 実装時に再検討する。
- **D2 (`--json` の扱い)**: `comp --json` は M1 で完全廃止 (案 A)。互換シムは置かない。CHANGELOG に `--json → --format json` の移行ガイドを記載。
- **D5 (エラー封筒の形)**: `comp` の `{ status: "error", error: { code, message } }` 形を `dup` にも展開 (案 A)。json モードでは stdout に JSON 封筒、markdown モードでは stdout に `# ts-hotspots error` ボディ、stderr には人間向け詳細。エラーコード体系は M2 実装時に整理 (`INVALID_REVRANGE` / `GIT_FAILED` 等の追加)。
