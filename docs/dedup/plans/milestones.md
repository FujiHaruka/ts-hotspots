# ts-dedup v1 実装マイルストーン

本ドキュメントは [docs/requirements.md](../requirements.md) と [docs/v1.md](../v1.md) をもとに、
v1 をゼロから実装するためのマイルストーン計画をまとめる。

## コンテキスト

- 現状: `src/index.ts` にエントリポイントのスケルトンがあるのみ。
- ターゲット: TypeScript (`.ts` / `.tsx`) の Type-3 duplication を PR 差分 × 既存コードで検出する CLI。
- 非目標 (v1 外): PDG 解析、型チェッカ依存の高度解析、embedding / LLM 判定、永続索引、全ペア比較、自動リファクタリング。

## Approach

パイプライン (Diff Collector → Indexer → Changed Fragment Extractor → Feature Extractor → Candidate Search → Similarity Scorer → Report Generator) を、**後段ほど上流の出力形に依存する** という性質に合わせて、**下流の安定した中核 (Fragment / Feature / Index / Score) から先に作る** 順で積み上げる。

理由:

- Fragment / Feature / Index / Score はそれぞれ **純関数的にテスト可能** で、Diff や git 状態に依存しない。先に固めることで、後段の Diff 連携を入れる段階での試験が "スコアリング本体 × I/O" に切り分けやすくなる。
- 逆に E2E の walking skeleton を先に作ると、各段がスタブのまま配線だけ先行し、テストでの不具合特定が難しくなる。本ツールは recall と決定性が品質軸なので、**単位テストで細かく性質を押さえられる順** を優先する。
- Diff Collector は外部 I/O (git) が絡み、他段と結合度が低い独立モジュールなので、中核が固まった後にまとめて追加して統合する。

したがってマイルストーンの大枠は「型と足回り (M0) → fragment (M1) → feature (M2) → index + 検索 (M3) → スコアリング (M4) → diff と変更抽出 (M5) → レポート (M6) → CLI 統合 (M7) → 品質調整 (M8)」の 9 段となる。各マイルストーンは **その段単体で `pnpm test` により検証できる成果物** を持つことを完成の基準とする。

Recall 優先・決定性・根拠提示の 3 原則は、各段の受け入れ基準に明示的に織り込む。

## マイルストーン一覧

| # | 名称 | 主な成果物 |
|---|---|---|
| M0 | プロジェクト基盤とドメイン型 | 共通型定義、ディレクトリ構造、テスト雛形 |
| M1 | Codebase Indexer: Fragment 抽出 | TypeScript → Fragment 分割 |
| M2 | Feature Extractor | 3 系統の特徴量生成 |
| M3 | Inverted Index + Candidate Search | 転置索引と OR 候補検索 |
| M4 | Similarity Scorer | 4 観点のスコアと OR 判定 |
| M5 | Diff Collector + Changed Fragment Extractor | git 差分 → 変更 fragment |
| M6 | Report Generator | JSON / Markdown レポート |
| M7 | CLI 統合と E2E | `ts-dedup` コマンドと fixture E2E |
| M8 | 決定性・性能・チューニング | 決定性検証、閾値調整、ドキュメント |

---

## M0. プロジェクト基盤とドメイン型定義

### 目的
後続マイルストーンが参照する共通ドメイン型とディレクトリ構造、テスト基盤を整える。

### 成果物
- `src/domain/` 配下にドメイン型:
  - `Fragment` (id, filePath, startLine, endLine, kind, text, astNodeKind)
  - `Feature` 系 (token n-gram / statement kind n-gram / call fingerprint の共通形)
  - `Posting`, `InvertedIndex`
  - `Candidate`, `CandidateScore`
  - `CloneCandidateReport` (v1.md 8 章の型)
- `src/` 下のレイアウト方針を README もしくは `docs/plans/` 内に記載。
- `vitest` のサンプルテストと、fixture を置くディレクトリ (`test/fixtures/` など) を用意。
- 設定ファイル (除外ルール・n-gram 長・スコア重み) を受け取る `Config` 型と既定値。

### 受け入れ基準
- `pnpm typecheck` / `pnpm test` / `pnpm lint` が通る。
- `Config` の既定値が requirements.md の記述 (広めの候補件数、OR 判定等) と矛盾しない。

### 依存
なし。

---

## M1. Codebase Indexer: Fragment 抽出

### 目的
TypeScript ソースを走査し、比較単位となる fragment に分割する。

### 成果物
- `src/indexer/parseSource.ts`: `typescript` パッケージで `SourceFile` を生成。
- `src/indexer/extractFragments.ts`: `SourceFile` から以下の粒度で fragment を抽出。
  - function / method / arrow function
  - block: `if` / `for` / `while` / `try` / `catch` / `switch`
  - statement window: 連続する N 文 (既定 5〜20, 設定可能)
- 各 fragment に安定な ID (例: `filePath#startLine-endLine-kind`) を付与。
- ファイル/ディレクトリ単位で一括インデックス化する `buildCodebaseIndex` (ただし「索引」そのものは M3 で差し込む前提で、ここでは fragment の配列を返す)。

### 受け入れ基準
- ユニットテストで次を確認:
  - 関数宣言 / メソッド / アロー関数が分離して取れる。
  - `if` / `for` 等のブロックがネストしていても適切に抽出される。
  - statement window の長さが設定で切り替わる。
  - 生成物 (行番号・text) が元ソースと整合する。
- 決定性: 同一入力に対して fragment の配列と ID が毎回同一。

### 依存
M0。

---

## M2. Feature Extractor

### 目的
fragment から検索・スコアリング用の特徴量 3 系統を抽出する。

### 成果物
- `src/features/normalizedTokenNgram.ts`:
  - TypeScript の scanner / AST からトークン列を取り、識別子 → `ID`, 文字列 → `STR`, 数値 → `NUM`, 真偽値 → `BOOL` などに正規化。
  - 型注釈・コメントは既定で除去。
  - 3〜6 gram (長さ設定可能)。
- `src/features/statementKindNgram.ts`:
  - 文ノードの kind だけを並べた列から 2〜5 gram を生成。
- `src/features/callPropertyFingerprint.ts`:
  - 関数呼び出し名 (`CALL:foo` / `AWAIT_CALL:obj.method`) とプロパティアクセス (`PROP:obj.field`) を抽出。
- `src/features/extractFeatures.ts`: fragment を受け取り 3 系統の特徴量をまとめて返す。

### 受け入れ基準
- 各特徴量抽出のユニットテストで次を確認:
  - 識別子・リテラルの差異だけのペアで token n-gram と statement kind n-gram が大部分一致する。
  - 呼び出し・プロパティが fingerprint として拾える。
  - 設定で n-gram の長さを変更できる。
- 決定性: 同一 fragment → 同一 feature 列。

### 依存
M0, M1。

---

## M3. Inverted Index + Candidate Search

### 目的
base 側 fragment の特徴量から転置索引を構築し、changed fragment 向けに高 recall な候補検索を行う。

### 成果物
- `src/index/invertedIndex.ts`: 特徴 key ごとに posting のリストを持つ `Map` ベースの索引。
  - key 例: `token:IF ID DOT ID`, `statement:IfStatement|ReturnStatement`, `call:findById`。
- `src/search/candidateSearch.ts`:
  - changed fragment の特徴量を索引に投げ、3 系統の **OR (union)** で候補を列挙。
  - 候補ごとに系統別ヒット数 (`hitCounts.token/statement/call`) を集計。
  - 上位 N 件 (既定 50〜200, 設定可能) に絞る。

### 受け入れ基準
- ユニットテスト:
  - 片方の系統のみ一致する候補も拾える (OR の確認)。
  - ヒット数が特徴ごとに正しく集計される。
  - 上限件数で打ち切る順序が決定的 (tie-break を定義)。
- 大まかな性能確認: 数千 fragment × 数千特徴でも秒オーダーで検索が終わること (ベンチは軽いもので可)。

### 依存
M0, M1, M2。

---

## M4. Similarity Scorer

### 目的
候補ペアに対して 4 観点で再スコアし、OR 条件で最終判定する。

### 成果物
- `src/scoring/tokenOverlap.ts` (Jaccard もしくは Dice 係数)
- `src/scoring/statementKindSimilarity.ts`
- `src/scoring/callOverlap.ts`
- `src/scoring/sizeCompatibility.ts` (サイズ比で減点)
- `src/scoring/combinedScore.ts`:
  - 既定重み (v1.md: 0.40 / 0.30 / 0.20 / 0.10) を設定可能に。
- `src/scoring/decide.ts`:
  - v1.md の閾値 (combined >= 0.30 OR token >= 0.35 OR stmt >= 0.45 OR call >= 0.40) の **OR** で報告採否を決める。

### 受け入れ基準
- ユニットテスト:
  - 既知の同一コピー → 全スコア高。
  - 識別子だけ変更 → token は高、statement はより高。
  - サイズ差が極端 (10x 以上等) で sizeCompatibility が減点される。
  - combined が閾値未満でも個別観点で超えれば report 採用される (OR 確認)。
- 重み・閾値が設定経由で差し替え可能。

### 依存
M0, M2, M3。

---

## M5. Diff Collector + Changed Fragment Extractor

### 目的
PR の base / head と差分を取得し、変更行を含む fragment を抽出する。

### 成果物
- `src/diff/collectDiff.ts`:
  - base / head を受け取り、変更ファイル・hunk・変更行範囲を返す。
  - 実装候補: `simple-git` もしくは `git diff --unified=0` を子プロセスで呼ぶ方式。選定理由を PR description に書く。
  - `.ts` / `.tsx` 以外は除外。
  - 除外ルール (generated / dist / build / vendor / lockfile / snapshot / migration / 大 fixture) を `Config` から受け取り適用。
- `src/diff/extractChangedFragments.ts`:
  - 変更行を含む最小 function / 最小 block / 周辺 statement window を抽出。
  - M1 の抽出器を再利用 (head branch 側のソースに対して実行)。

### 受け入れ基準
- ユニットテスト (git リポジトリを使わないもの):
  - 変更行範囲と fragment 範囲の交差判定。
  - 関数全体変更 / 関数内部 1 行変更 / 複数 hunk が同じ関数に当たる場合の fragment 抽出が要求通り。
  - 除外ルールでファイルが落ちる。
- 統合テスト (小さな一時 git リポジトリ):
  - base / head 間の差分が取れる。
  - `.ts` 以外が除外される。

### 依存
M0, M1。

---

## M6. Report Generator

### 目的
検出結果を coding agent と人間の双方が使える形で出力する。

### 成果物
- `src/report/jsonReport.ts`: v1.md の `CloneCandidateReport` 形式で JSON 化。
  - PR 情報 (baseSha / headSha)
  - 変更側・既存側の位置・kind・code
  - combined と個別スコア
  - evidence (共通する calls / properties / statement kinds / token n-gram サンプル)
  - recommendationHint (confidence / likelyRefactoring / riskFlags)
- `src/report/markdownReport.ts`: 人間が PR コメントで読める概要 Markdown。
- ランキングの決定的な順序 (score 降順 → fragment ID 昇順 等の tie-break) を定義。

### 受け入れ基準
- ユニットテスト:
  - 同一入力 → 同一 JSON (決定性)。
  - evidence に実際の一致要素が入っている (空にならない)。
  - recommendationHint の `confidence` / `likelyRefactoring` を score から導くロジックが規則に従う。

### 依存
M0, M2, M4。

---

## M7. CLI 統合と E2E

### 目的
ここまでのモジュールを配線し、1 コマンドで動く CLI を完成させる。

### 成果物
- `src/cli/main.ts`:
  - `ts-dedup --base <sha|ref> --head <sha|ref> --repo <path> --out report.json [--markdown <path>]` 相当のインターフェース。
  - 終了コード: 候補が 0 件でも 0 (検出はツールの責務、CI 失敗判定はユーザ側)。
- `src/index.ts` から `main` を呼び出すように接続。
- `test/e2e/` に 2〜3 個の fixture repo (一時 git repo を生成するヘルパ) を置き、次をカバー:
  - 関数全体コピー
  - 識別子だけ変えたコピー
  - 連続する数文の部分コピー
- README (もしくは `docs/usage.md`) に最小の使い方を記載。

### 受け入れ基準
- E2E テストで期待候補が含まれること (recall の最低限確認)。
- `pnpm build` で成果物が出て、`node dist/index.js` で起動する。
- CI 想定の実行時間: 中規模 fixture (数千行) で数秒〜数十秒。

### 依存
M1〜M6 すべて。

---

## M8. 決定性・性能・チューニング

### 目的
v1 としての品質ラインに整える。

### 成果物
- 決定性テスト: 同一入力で 2 回実行しレポートが一致することを検証。
- 性能計測と、明らかな hotspot の最適化 (例: 索引 key の hash キャッシュ、fragment 重複の除去など)。
- 既定パラメータ (n-gram 長、候補件数、スコア重み、OR 閾値) の暫定値を fixture 結果で見直し。
- `docs/configuration.md` に全チューニング項目を一覧化。
- README を「このツールは何で、どう動かすか」で書き直す (CLAUDE.md の docs ポリシー準拠)。

### 受け入れ基準
- 決定性テストが CI 上でグリーン。
- 主要 fixture で recall の目視確認 OK、precision は要求通り "ノイズあり許容"。
- 設定で特徴量を 1 系統 off にしても動作する (拡張性要件の確認)。

### 依存
M7。

### 状態 (2026-04-25 クローズ)
4 スライスに分割して完了:

- [m8-extensibility.md](./m8-extensibility.md): `features.enabled` で 3 特徴量を個別 off 可能に。
- [m8-fixture-suite.md](./m8-fixture-suite.md): 25 シナリオの ground-truth fixture suite と
  bench harness。baseline `recall@all` = 1.00 / negative violations = 4。
  smoke subset (5 件) を vitest CI で実行。
- [m8-determinism.md](./m8-determinism.md): 5 件の代表 fixture で end-to-end 決定性
  トリップワイヤを vitest に追加。CI グリーン。
- [m8-performance.md](./m8-performance.md): フェーズ別計測を仕込み、ts-dedup 自身に対する
  scale probe を `tools/bench/baseline/scale.md` にチェックイン。

受け入れ基準すべて充足。スコープ調整:

- `docs/configuration.md`: descoped (将来 v1.1 以降で必要になった時点で書く)。
- `headSearch` 最適化: scale probe で 87% を占めることを確認したが、計測の責務までで
  M8 をクローズ。実装は follow-up slice (詳細と候補アプローチは
  [tools/bench/baseline/scale.md](../../tools/bench/baseline/scale.md))。

---

## リスクと留意点

- **TypeScript パーサの選定**: `typescript` パッケージか `@typescript-eslint/typescript-estree` か。v1 は型解析に依存しないので `typescript` パッケージを第一候補とする。M1 冒頭で確定させる。
- **git 実行方法**: `simple-git` vs 直接 `git` 子プロセス。CI 上での挙動安定性を優先し、M5 冒頭で軽く prototyping して決める。
- **Statement window の重複**: window の重なりで候補爆発を起こしうる。M1 で重複除去方針 (スライド幅 / 重複フィルタ) を決めておく。
- **決定性**: `Map` 反復順、並行処理の導入有無、tie-break の定義が崩れると即決定性違反。M3 / M6 の段で tie-break を明示しておく。
- **除外ルール既定値**: requirements.md のリストを globs で既定化するが、過剰除外で recall を下げないよう、M5 で実 fixture に当てて確認する。
