# `ts-hotspots scan` 設計 RFC

> Status: Draft (M5)
> 目的: 段階2 で導入する `ts-hotspots scan` の挙動・スキーマ・デフォルトを決定する。
> 実装は行わない。決定後に M6 で実装する。

## 1. なぜ統合コマンドが必要か

段階1 で `ts-hotspots` (関数 hotspot) と `ts-hotspots dedup` (重複候補) は同じバイナリの 2 サブコマンドとして同居している。ただし出力は完全に別系統で、それぞれ独立した JSON / Markdown レポートを返す。

エージェントに「このリポジトリ、まずどこを読めばいい?」を委ねる場面では、両方の答えを揃えてからでないと判断できない:

- 関数の複雑度・churn が高い座標 (hotspot)
- 既存コードと重複している、あるいは PR が新たに重複を持ち込んだ座標 (dedup)

これを別々に走らせると、エージェント側で 2 つのレポートを同時に持ち、座標とスコア軸を自前で正規化し、dismissal も別系統で管理する負担が生まれる。`scan` の意義はこの「**統合された "気になる場所" のリスト**を 1 リクエスト・1 スキーマで返す」点にある。

副次的に得られるもの:

- CI 設定の単純化 (1 コマンド 1 出力)
- dismissal レジストリの統一 (M5 では論点として保留 — §8 参照)
- ユーザが最初に試すコマンドが 1 つに集約され、入口が単純になる

逆に統合しないでよい論拠も並べておく (採用判断は §3 で行う):

- hotspot は ts-morph + TypeChecker、dedup は git + typescript パーサ直叩きで、コスト構造がまったく違う。dedup whole-repo は数十秒〜分単位の重さがある一方、hotspot 単独は通常数秒で済む。常に両方走らせると軽い用途が遅くなる。
- 出力の自然な単位が違う (関数 ref vs. fragment 群)。同居スキーマで両方を素直に表現できるかは設計問題。

## 2. 想定ユースケース

`scan` が応えるべき主要ユースケースを 3 つ列挙する。各ケースは §6 で「スキーマ案で過不足なく応えられるか」を確認する基準として使う。

### UC1. エージェントへの初期コンテキスト投入

**シナリオ**: 開発者が「このリポジトリ、まずどこを読んでリファクタすべき?」をエージェントに尋ねる。`ts-hotspots scan | claude --permission-mode plan` のように直接パイプする。

**期待**: エージェントは両軸 (hotspot / dedup) を踏まえて「先に読むべき座標 N 件」を提案できる。重複の片方が hotspot にも入っているケースは、優先度が自然に上がるべき。

**運用**: ローカル / CLI 対話。dedup は whole-repo モード相当。実行時間は数秒〜数十秒を想定 (大きいリポジトリなら `--exclude` でチューニング)。

### UC2. PR レビュー時の CI レポート

**シナリオ**: PR 作成時に CI が `ts-hotspots scan --pr <revrange>` を走らせ、結果を PR コメントまたはアーティファクトとして残す。レビュアー / Copilot は変更行の周辺リスクを 1 画面で把握する。

**期待**: PR で新たに作り込まれた hotspot (複雑度の高い新関数 / 大きく書き換わった既存関数) と、PR 由来の重複候補 (head 側 fragment が base ツリーの何かと似ている) を同じレポートに並べて返す。

**運用**: `<revrange>` は GitHub Actions の `${{ github.event.pull_request.base.sha }}...${{ github.event.pull_request.head.sha }}` 相当を渡す想定。dedup は PR モード。hotspot 側は base / head どちらで計測するか決める必要がある (§4 で扱う)。

### UC3. 手動レビュー前 / 引き継ぎ時の repo オンボーディング

**シナリオ**: 新規担当者がコードベース全体を把握する前に「ホットゾーンと重複クラスタの地図」を 1 度だけ作る。出力は Markdown で人間にも読める形が望ましい。

**期待**: hotspot 上位 N 件と dedup 群上位 M 件が、ファイルごと・領域ごとに俯瞰できるレポートを返す。詳細は各候補から個別の「読むべき座標」を辿れる。

**運用**: 一度きりの実行で時間制約は緩い。dedup は whole-repo モード。`--format markdown` で人間向け、`--format json` で後処理用、両方を選べる必要がある。

## 3. 既存コマンドとの関係

3 つの選択肢を検討する。

| 案 | 概要 | 評価 |
|---|---|---|
| A | `scan` は alias。中身は既存 2 コマンドを順に呼んで報告層で結合する | 実装コストは小さいが、両者の出力は別系統スキーマで整合性が取りにくい |
| B | `scan` を第一級の新コマンドにし、既存の `ts-hotspots [path]` / `ts-hotspots dedup` は残す | 入口を `scan` に集約しつつ、既存の用途 (片側だけ走らせたい) も壊さない |
| C | `scan` 導入とともに既存 2 コマンドを deprecate。今後は `scan --only hotspots` / `scan --only dedup` で代替する | API 表面は最小化されるが、既存利用者 (CI スクリプト含む) を壊す |

**採用: 案 B**。

理由:

- 段階1 で既存コマンドのインターフェース・出力スキーマは安定済みで、これを破ることに見合うメリットがない。dogfooding 用の `dedup --whole-repo --phase-timings` のような細かい調整は `scan` 経由ではなく直接サブコマンドを叩く方が自然。
- `scan` は「両方を一発で取りたい」というユースケースに応えるための加算的な追加。減算 (既存削除) はしない。
- 将来 `scan` が安定したら、README の "Quick start" 推奨を `scan` に寄せていく形で穏やかに重心移動する。

つまり 0.x 系では:

```
ts-hotspots [path]                  既存。関数 hotspot だけが欲しいときの最短経路
ts-hotspots dedup [args...]         既存。重複検出だけが欲しいときの最短経路
ts-hotspots scan [args...]          新規。両方を 1 レポートで取りたいときの推奨経路
```

の 3 並列で運用する。

## 4. CLI シェイプとデフォルト挙動

### 4.1 シェイプ

```
ts-hotspots scan [path] [options]
```

`path` は `ts-hotspots [path]` と同じ意味 (省略時は cwd)。dedup の対象 git リポジトリは原則として `path` から解決する (tsconfig が置かれた階層からリポジトリルートを上方探索)。

主要オプション:

| オプション | 意味 | 既定 |
|---|---|---|
| `--pr <revrange>` | PR モード。dedup を PR モードで実行し、hotspot もこの diff を踏まえる (§8 で扱う) | unset |
| `--whole-repo` | リポジトリ全体を対象にする。`--pr` と排他 | unset |
| `--include-dedup` | whole-repo モードで dedup を有効にする | off |
| `--only <hotspots\|dedup>` | 片側だけ実行する | unset = 両方 |
| `--format <markdown\|json>` | 出力形式 | markdown |
| `--top <N>` | hotspot の top-N | 5 |
| `--limit <N\|all>` | dedup 群の上限 | 20 |
| `--exclude <glob...>` | 両軸に共通で適用するパス除外 | hotspot / dedup それぞれの既定 |
| `--no-code` | dedup レポートから fragment ソースを落とす | off (= ソース含む) |
| その他 | 既存サブコマンドの flag は名前衝突しない範囲で透過的に受け取る (例: `--metrics`, `--churn-window`, `--phase-timings`) | — |

### 4.2 デフォルト挙動 (どの組み合わせで何が走るか)

|  | hotspots | dedup |
|---|---|---|
| `scan` (引数なし) | ✓ (cwd) | × |
| `scan <path>` | ✓ | × |
| `scan --pr <range>` | ✓ (range 込み) | ✓ (PR モード) |
| `scan --whole-repo` | ✓ | × (`--include-dedup` で ✓) |
| `scan --whole-repo --include-dedup` | ✓ | ✓ (whole-repo モード) |
| `scan --only hotspots ...` | ✓ | × |
| `scan --only dedup --pr <range>` | × | ✓ (PR モード) |
| `scan --only dedup --whole-repo` | × | ✓ (whole-repo モード) |

設計上のキー判断:

- **既定では dedup を走らせない**。`scan` 単独は素早くフィードバックが返る形を保ち、dedup の起動コストを払う場面を明示にする。
- **PR モードでは dedup を既定で含める**。PR モードでの dedup は「変更 fragment だけを検索側に回す」ので whole-repo に比べて軽く、UC2 が一次目的なら同居させる方が自然。
- **whole-repo dedup は明示 opt-in**。UC1 / UC3 のいずれも `--include-dedup` を意識して付ける場面と判断する。
- **`--only` は対称的なフィルタ**。`--only hotspots` と `--only dedup` のどちらでも同じスキーマ (該当しない側は空配列) を返し、消費側に分岐を持ち込まない。
- **既存 flag の透過**。`scan` 経由でも各サブコマンドの細かい挙動を制御できるようにする (実装は §5 のスキーマに合わせて整理)。名前衝突するもの (`--exclude`) は scan 側で 1 つにまとめ、内部で両軸に渡す。

## 5. 統合 JSON スキーマ案

> TODO

## 6. ユースケース別の充足確認

> TODO

## 7. エージェント誘導文サンプル

> TODO

## 8. 未解決の論点
