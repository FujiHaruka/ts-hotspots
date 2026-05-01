## `comp` monorepo tsconfig 自動展開 計画

> **Superseded by [comp-drop-callercount.md](./comp-drop-callercount.md) (2026-05-01)**: `comp` から tsconfig 依存自体を撤廃し、ソース列挙を `git ls-files` ベースに切り替えたため、本計画の monorepo discovery は不要になった。経緯と「なぜ YAGNI 判断が覆ったか」の記録として残す。
>
> Status: Superseded (no longer planned)
> Goal: `ts-hotspots comp <path>` で `<path>` 直下に `tsconfig.json` が無い monorepo ルートを渡されたとき、配下のパッケージ tsconfig を自動的に発見してまとめて解析する。
> 非 Goal: `dup` 側の挙動変更 (`dup` は tsconfig を読まないため本計画の対象外)。複数プロジェクトを **別レポートに分割** して並べる出力形 (集約は単一 ranking のまま)。

## 0. Progress

- [ ] **M1** — 発見ロジック実装 + 単一 `Project` への複数 tsconfig 投入
- [ ] **M2** — `comp --pr` との結合 (changed file が属するパッケージの tsconfig を確実に含める)

## 1. 経緯

`docs/plans/unify-comp-and-dup.md` の D3 (位置引数の意味) で **`[path]` = tsconfig を内包するディレクトリ** に統一した際、「`path` 直下に tsconfig が無い場合の子ディレクトリ探索は将来拡張として保留」と明記して棚上げした (§7 D3, §3 Approach)。

棚上げ理由は「必要になってから足す YAGNI」だったが、利用上の摩擦として:

- pnpm/yarn workspaces で `packages/*/tsconfig.json` の構成を取る monorepo はかなり一般的。
- 現状この形で `ts-hotspots comp .` を打つと `TSCONFIG_NOT_FOUND` で落ちる。回避するにはパッケージごとに `comp packages/foo` を打ち直す必要があり、agent ワークフローでは渡された path をそのまま使えないと痛い。
- TS の "solution config" (root tsconfig + `references`) は既に `walkTsconfigReferences` (loader/load-project.ts:55) でたどれているので、ギャップは **solution config を採用していない** 種類の monorepo に限られる。

`dup` は tsconfig 非依存 (git root のみ参照) なので影響を受けない。

## 2. 現状

### 2.1 既にできていること

- `comp [path]` で `path` を tsconfig パス or その親ディレクトリとして解決する (`src/cli.ts:311 resolveTsconfigPath`)。
- 渡された tsconfig が `references: [{ path: "..." }]` を持つ場合、推移的にすべて辿って 1 つの `Project` に投入する (`src/loader/load-project.ts:55 walkTsconfigReferences`)。

### 2.2 落ちるケース

| パターン | 例 | 現状の挙動 |
|---|---|---|
| root に tsconfig 無し / 子に分散 | pnpm-workspace + 各 `packages/*/tsconfig.json` 独立 | `comp .` → `TSCONFIG_NOT_FOUND` |
| root tsconfig はあるが references 空 | 設定漏れ / プロジェクト参照を導入していない monorepo | 子の tsconfig は見つからず、root だけが Project に投入される (= 子パッケージ関数は 0 件扱い) |
| tsconfig がネストするが workspace マーカー無し | apps/foo + apps/bar + lib/x (packages.json なし) | 同上 / 落ちる |

### 2.3 設計上の制約

- `loadProject` は内部で `allTsconfigs: string[]` を 1 つの `Project` に投入する作りなので、**N 個の tsconfig を seed にする一般化** は局所改修で済む。
- `comp --pr` (M4 で導入済) は changed file が属する Project に関数が含まれていないと `PR_SCOPE_EMPTY` になる。複数 tsconfig を統合する場合、changed file を網羅できる set を必ず投入する必要がある。

## 3. Approach

「`[path]` 解決 → tsconfig discovery → loadProject に N 件渡す」の 3 段で組み、**出力スキーマは現状維持** (集約された単一 ranking)。

- **発見トリガ**: `[path]/tsconfig.json` が存在しないとき / または存在しても解析候補が 0 件になりそうなとき、子 discovery を試みる。「常に子も探す」はしない (単一プロジェクトでの I/O 増を避ける)。
- **発見戦略の優先順**:
  1. `<path>/pnpm-workspace.yaml` の `packages:` glob → 各 glob 直下の `tsconfig.json`
  2. `<path>/package.json` の `workspaces` フィールド (npm/yarn) → 同上
  3. フォールバック: 深さ制限 + `node_modules` / `dist` 除外つきの再帰 walk
- **集約**: 発見した N 件すべてを `loadProject({ tsconfigPaths: string[] })` に渡し、内部で 1 つの ts-morph `Project` に投入。ranking ロジックには手を入れない。
- **既存挙動の維持**: `<path>/tsconfig.json` が存在する場合はこれまで通り。`tsconfig.json` への直接パスを渡された場合もこれまで通り。新挙動が発火するのは「ディレクトリ + そこに tsconfig が無い」ケースに限定。

設計上のキー判断:

- **発見は CLI 層ではなく loader 層に閉じ込める**。`resolveTsconfigPath` (cli.ts) は今まで通り「path or undefined → 単一 tsconfig パス候補」を返す薄い関数のまま残し、loader 側で「候補が無い場合は workspace 推論を試みる」を持つ。CLI レイヤを薄く保つ既存方針 (unify-comp-and-dup.md §3) を踏襲。
- **`Project` は 1 つに統一**。複数 `Project` を作って結果をマージする実装は、TypeChecker・名前解決・churn 集約のすべてを跨いで二重化する必要が出るので不採用。`addSourceFilesFromTsConfig` を N 回呼ぶ既存パターン (load-project.ts:47) で十分。
- **stderr に発見ログを 1 行**。「root に tsconfig が無いので packages/* を展開した、N 個の tsconfig をロード」を 1 行で出す。発見が暗黙だと PR モードで関数が見つからない理由がデバッグできなくなる。形式は M3 で導入した `ts-hotspots <cmd>: ...` stats 行に揃える。

## 4. 意思決定が必要な点

| ID | 論点 | 案 | 暫定 |
|---|---|---|---|
| E1 | discovery のトリガ条件 | (a) `<path>/tsconfig.json` が無いときだけ (b) (a) + root tsconfig が `references` 空 / `files` 空 のときも (c) 常に子も探す | **暫定 (a)**。(b) は誤判定リスクがあり (`files` を意図的に絞った root tsconfig を壊す)、(c) は単一プロジェクトでの I/O 増。M1 着手時に dogfooding で再評価 |
| E2 | workspace マーカーの優先順 | (a) `pnpm-workspace.yaml` → `package.json#workspaces` → walk フォールバック (b) `package.json#workspaces` を最優先 (c) walk 一本 | **暫定 (a)**。明示宣言があるならそれを尊重。walk フォールバックは 「monorepo っぽいけど宣言なし」のためのセーフティネット |
| E3 | walk フォールバックの深さ | (a) 深さ 2 (`<path>/*/tsconfig.json` のみ) (b) 深さ 3 (`<path>/*/*/tsconfig.json` まで) (c) 無制限 + `node_modules` 等の除外のみ | **暫定 (a)**。深さ 2 で `apps/foo/tsconfig.json` / `packages/foo/tsconfig.json` の主要ケースを拾える。深いネストが必要になったら (b) に拡張 |
| E4 | 発見 0 件のときの挙動 | (a) `TSCONFIG_NOT_FOUND` (現状) (b) 新エラーコード `NO_TSCONFIG_DISCOVERED` (c) (b) + stderr ヒント "workspace に tsconfig が見つかりません" | **暫定 (c)**。エラーコードを分けると agent 側で「発見ロジック自体は走ったが空だった」が判別できる |
| E5 | `loadProject` API の変え方 | (a) `tsconfigPath` を `tsconfigPaths: string[]` に置換 (破壊変更) (b) `tsconfigPaths?: string[]` を追加し既存 `tsconfigPath` を維持 (c) 新関数 `loadProjectMulti` を追加 | **暫定 (a)**。loader は内部 API、call site は CLI 1 箇所だけ。互換シムを残す動機が薄い |
| E6 | `--projects <glob>` 等の明示指定 | (a) 入れない (自動発見のみ) (b) 入れる (発見を上書き) (c) (a) + 必要になったら後付け | **暫定 (c)**。E1-E5 の暗黙発見だけで足りない監視ケースが出てから足す YAGNI 方針 |

## 5. マイルストーン

### M1 — 発見ロジック実装 + 単一 `Project` への複数 tsconfig 投入

決定: E1 / E2 / E3 / E4 / E5 / E6。

- `loadProject` の API を `LoadProjectOptions { tsconfigPaths: string[] }` に変える (E5)。`walkTsconfigReferences` は各 seed から推移的に展開し、結果を結合 + 重複除去。
- 新規 `src/loader/discover-tsconfigs.ts` (仮): `<path>` を入力に
  1. `<path>/tsconfig.json` 単体 (= 既存挙動)
  2. `pnpm-workspace.yaml` を解析した `packages:` glob → tsconfig discovery
  3. `package.json#workspaces` → 同上
  4. フォールバック深さ 2 walk
  の順で候補を返す関数を実装 (E1 / E2 / E3)。
- 候補 0 件で `NO_TSCONFIG_DISCOVERED` を投げる経路を追加 (E4)。エラー envelope は M2 で確立した形 (`{ status: "error", error: { code, message } }`) に乗る。
- stderr に発見結果 1 行 (`ts-hotspots complexity: discovered N tsconfigs (mode: pnpm-workspace)` 等) を出す (M3 stats 行と同形)。
- `--projects <glob>` 等の明示指定は入れない (E6)。

検証:
- 単体テスト: discovery 関数を fixture (pnpm workspace / npm workspace / 素の monorepo / 単一プロジェクト / discovery 失敗) で網羅。
- e2e テスト: `tests/fixtures/` に簡易 monorepo を 1 つ追加し、`comp <root>` が複数パッケージの関数を ranking に含めることを確認。
- 既存 cli.test.ts / load-project.test.ts のリグレッションが無いこと。

### M2 — `comp --pr` との結合

決定: なし (M1 の API を使うだけ)。

- `runComplexityPr` (cli.ts:619 周辺) で discovery を経由する経路を確認。changed file が discovered tsconfig set に属さない場合のメッセージを `PR_SCOPE_EMPTY` ではなく `PR_SCOPE_OUT_OF_TSCONFIG` 等の別ヒントに分岐するかは M2 着手時に検討 (現状 `PR_SCOPE_EMPTY` で実用上問題ないなら見送り)。
- e2e: monorepo fixture 上で `comp --pr <revrange>` を回し、changed file が属するパッケージの hotspot だけ拾うことを確認。

検証: M1 fixture を流用し、`--pr` 経路で同じ発見結果が使われていることを e2e で示す。

リスク: pnpm-workspace.yaml の glob 解釈は YAML パーサに依存する。最小実装では `js-yaml` を入れず、必要最小限の手書きパーサで `packages: ["..."]` だけ取り出す方が依存を増やさず済む。リスクがでかくなるなら依存追加を検討。

## 6. リスク / 横断論点

- **依存追加の誘惑**: pnpm-workspace.yaml の解析に `js-yaml` を足したくなるが、`packages:` フィールドだけ取れれば十分なので最小手書きパーサで凌ぐ方針。`package.json#workspaces` は JSON なので追加依存不要。
- **発見ノイズ**: `node_modules` や `dist` の中の `tsconfig.json` を拾うと激重になる。walk フォールバックでは少なくとも `node_modules` / `dist` / `build` / `.next` / `out` を skip 必須。除外パスは `src/duplication/config/` 等で既に持っている defaults を再利用するか、本機能で重複定義するか M1 着手時に確認。
- **発見結果の決定性**: glob 展開や readdir の順序がプラットフォーム依存だと ranking が揺らぐ。発見した tsconfig パス配列は最終投入前に必ず `sort()` する (`dup` 計画の "Determinism is a hard invariant" と同じ姿勢)。
- **既存 solution config との重複**: 子パッケージの tsconfig が既に root tsconfig の `references` に書かれている場合、discovery と `walkTsconfigReferences` の両方から同じパスが出る。`loadProject` 内の `visited: Set<string>` で吸収されるが、発見ロジックの単体テストでも重複耐性を確認する。
- **M2 の必要性**: M1 が刺さる場面の大半は `comp --pr` 経由なので、M1 だけリリースして M2 を即座にやらないと「monorepo で `--pr` が変な挙動をする」報告が来る可能性が高い。M1 と M2 は同じセッションで一緒に出すのを推奨。

## 7. 決定済み事項

(M1 着手時に E1-E6 を確定する。それまで本セクションは空。)
