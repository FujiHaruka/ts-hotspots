# M8 (slice 2): ground-truth fixture suite と計測ハーネス

[docs/plans/milestones.md](./milestones.md) M8 受け入れ基準のうち
「主要 fixture で recall の目視確認 OK、precision は要求通り "ノイズあり許容"」
を **目視ではなく数値で** 担保するためのスライス計画。

slice 1 ([m8-extensibility.md](./m8-extensibility.md)) で導入した
`features.enabled` を使って ablation も計測する。

## 目的

1. **recall を数値で** 監視する。「v1.md の閾値 / 重みを動かしたとき
   recall がどう変化したか」を毎回手で目視せずに済むようにする。
2. **precision の劣化に気付く** 仕組みを持つ (negative GT を入れる)。
   「ノイズあり許容」とはいえ、明らかに無関係なペアを大量に出すリグレッションは検出したい。
3. **ablation** (どの feature stream が recall にどれだけ効くか) を
   数値化して、将来の高度化 (C/D ⇒ embedding / PDG) の根拠を残す。
4. **パラメータチューニング** (n-gram サイズ、候補件数、重み、閾値) を
   "勘" ではなくグリッド比較で行うための土台を作る。

これらは v1.md 末尾「v1 の設計思想」(高 recall 優先・ノイズ許容) を
**測れる形** に翻訳する作業。

## Approach

### 全体の形

- `test/fixtures/suite/` に **オンディスク** で 25 シナリオ前後を置く。
  各シナリオは `base/` と `head/` のソースツリー + `expected.json` (GT) +
  `README.md` (意図と期待挙動)。
- `tools/bench/` (もしくは `scripts/bench.ts`) に **計測ハーネス** を置く。
  各 fixture について一時 git repo を組み立て (`base/` を 1 commit、`head/` を 2 commit目)、
  `runDetector` を呼び、レポートと GT を `match` ロジックでつき合わせ、
  recall@K / precision / ablation / 実行時間を集計する。
- 出力は **Markdown サマリ** (人間が PR に貼れる) と **JSON ダンプ**
  (`git diff` で実行間差分を取れる)。
- vitest 本体には **smoke subset** (3〜5 件) だけ統合し、PR 毎に CI を
  回す。完全 suite は `pnpm bench` で on-demand 実行 (CI 上は nightly か手動)。

### なぜオンディスクか (programmatic 生成しない)

- 25 シナリオの意図はコードを目で見て理解したい。`tempRepo.write(...)` を
  25 回手で書くのは保守不能。
- VS Code の TypeScript サポートで lint / 補完が効くので fixture コード自体を保守しやすい。
- 失敗時の調査が「fixture ファイルを直接開く」で済む。
- ただし fixture 用の `tsconfig.json` は配置しない (型チェック対象外。
  `package.json` exclude で隔離する)。

### Ground truth スキーマ

```jsonc
// test/fixtures/suite/<id>/expected.json
{
  "description": "Type-2 rename: identifiers differ, structure identical",
  "tags": ["type-2", "rename", "function"],
  "expectedPositive": [
    {
      "changed":  { "filePath": "src/util.ts",  "startLine": 1, "endLine": 7 },
      "existing": { "filePath": "src/math.ts",  "startLine": 1, "endLine": 7 },
      "rationale": "addCopy is a verbatim copy of add with renamed args",
      // 任意。指定すれば「最低この combined を超えること」を要求。
      // 省略時は「report に含まれていれば OK」。
      "minScore": { "combined": 0.5 }
    }
  ],
  "expectedNegative": [
    {
      "changed":  { "filePath": "src/foo.ts" },
      "existing": { "filePath": "src/bar.ts" },
      "rationale": "shared domain vocabulary but different control flow"
    }
  ]
}
```

### マッチ判定

レポート上の候補が GT エントリにマッチする条件:

- `filePath` が **完全一致** (両側とも)。
- 行範囲は **Jaccard >= 0.5**。GT は人間が書く行範囲なので fragment 切り出しと
  完全一致しないことが多い。Jaccard 0.5 なら片側 >= 過半数の重なりを要求できる。
- `expectedNegative` は `filePath` のみで判定 (任意の行範囲ヒットを失敗扱い)。

### メトリクス

各シナリオで:

- `recall@10` / `recall@50` / `recall@all` = 検出された GT positive 数 / GT positive 総数。
- `negativeViolations` = report に含まれた `expectedNegative` ペア数。
- `minScoreFailures` = GT positive で `minScore` を満たさなかったもの。
- `wallMs` = `runDetector` の実行時間。

集計 (suite 全体):

- micro recall@K (全 GT positive を母数にした recall)。
- per-tag recall (e.g. `type-2`, `window`, `tsx`)。
- ablation (`token` / `statement` / `call` 各 off で再計算した recall@all)。

### 出力フォーマット

Markdown 例:

```
# ts-dedup bench report

config: defaults
fixtures: 25 (positives: 38, negatives: 12)
wall: 4.2s

## summary

| run            | recall@10 | recall@50 | recall@all | neg viol. |
|----------------|----------:|----------:|-----------:|----------:|
| baseline       |      0.92 |      0.97 |       1.00 |         3 |
| token-off      |      0.71 |      0.84 |       0.92 |         1 |
| statement-off  |      0.84 |      0.92 |       0.97 |         2 |
| call-off       |      0.87 |      0.95 |       1.00 |         3 |

## per-tag recall (baseline)

| tag        | recall |
|------------|-------:|
| type-1     |  1.00  |
| type-2     |  0.95  |
| type-3     |  0.85  |
| tsx        |  0.80  |
| window     |  0.92  |

## failures

- 014-switch-vs-if-chain: recall 0/1 (combined 0.18, expected >= 0.30)
- 023-different-async-styles: 1 negative violation
```

JSON は同情報を機械読める形で吐く (差分計算用)。

### Fixture taxonomy (25 シナリオ固定)

多様性を最優先し、設計時点で全 25 シナリオを列挙する。
positive 20 + negative 5。各シナリオには 1 つ以上の `tags` を付け、
per-tag recall で観測軸を切り分ける。

#### Positive (20)

| ID | name | tags | 何を担保するか |
|----|------|------|--------------|
| 001 | exact-fn-copy | type-1, function, cross-file | 完全コピーの sanity baseline |
| 002 | exact-block-copy | type-1, block, cross-file | try/catch block の完全コピー検出 |
| 003 | renamed-args | type-2, function, rename | 引数名のみ差し替え (token 正規化の効き) |
| 004 | renamed-locals | type-2, function, rename | ローカル変数名のみ差し替え |
| 005 | renamed-literals | type-2, function, literal | 文字列/数値リテラル差 (STR/NUM 正規化) |
| 006 | renamed-fn-and-args | type-2, function, rename | 関数名 + 引数の二重 rename |
| 007 | method-vs-function | type-2, function, method | クラスメソッド ↔ free function 同形 |
| 008 | extra-log-stmt | type-3, function | 同一ロジック + console.log 1 文追加 |
| 009 | removed-validation-stmt | type-3, function | 1 文削除版コピー |
| 010 | reordered-independent | type-3, function | 独立文の順序入れ替え |
| 011 | extra-early-return | type-3, function | early-return ガード 1 行追加 |
| 012 | extract-fn-candidate | type-3, window, refactoring | 2 つの大きな関数内に同じ 6 行が埋まる |
| 013 | window-in-larger-fn | type-3, window, cross-granularity | 短い関数が長い関数の中身 7 行と一致 |
| 014 | block-in-different-fn | type-3, block, cross-granularity | 同じ if-for ブロックが無関係な 2 関数に |
| 015 | same-file-near-twins | type-2, function, same-file | 同一ファイル内で双子ヘルパ (riskFlag 確認) |
| 016 | async-await-call-pattern | type-2, function, async | await db.find / await api.get の重複 |
| 017 | tsx-component-copy | type-1, function, tsx | React コンポーネント完全コピー |
| 018 | tsx-render-helper | type-2, function, tsx | render ヘルパが複数ページにコピー |
| 019 | template-literal-heavy | type-3, function, template-literal | テンプレートリテラル中心のロジック重複 |
| 020 | generics-annotations | type-2, function, generics | 型注釈/generics 多めでも token 正規化が効く |

#### Negative (5)

| ID | name | tags | 何を担保するか |
|----|------|------|--------------|
| 021 | neg-shared-domain | negative, function | 共通語彙 (validateUser/checkAccount) だが制御フロー別 |
| 022 | neg-boilerplate-only | negative, function | constructor + super() のみが似た 2 クラス |
| 023 | neg-tiny-fragments | negative, function, small | 3 行の極小関数同士が token で偶発一致 |
| 024 | neg-different-async-styles | negative, function, async | callback vs promise vs async/await で同目的 |
| 025 | neg-trivial-getters | negative, function, small | 多数のクラスにある `return this.x` 系ゲッター |

#### カバレッジマトリクス

- **Type ラベル**: type-1 (×3) / type-2 (×8) / type-3 (×7) / negative (×5)。
- **fragment 種別**: function (×17) / block (×3) / window (×3)。
- **JSX/TSX**: 2 件 (017, 018)。
- **同一ファイル**: 1 件 (015)。
- **言語機能**: async/await (016, 024), template literal (019), generics (020)。
- **小型ノイズ**: 023, 025。
- **意味的に似て構造別**: 021, 024。
- **意味的に別で構造似**: 022, 025。

不足が見えたシナリオ (例: regex literal 中心、tsconfig paths を跨ぐコピー) は
M9 以降で追加する。Phase 1 では 25 件で固定する。

### CLI / ハーネス起動

```sh
# 全 fixture を回し summary.md / summary.json を出す
pnpm bench

# 1 fixture だけ
pnpm bench -- --only 003-renamed-args

# ablation を外したい (速度優先)
pnpm bench -- --no-ablation

# 設定を差し替えてグリッド比較
pnpm bench -- --config tools/bench/configs/heavy-token.json
```

依存方針: 新規 npm 依存は入れない。`node:util.parseArgs` と既存の `runDetector` で完結。

### CI 統合

- vitest 本体で smoke subset (5 シナリオ) を回す: PR 毎に決定性 + 基本的な recall を担保。
- 全 25 シナリオ + ablation は **手動トリガー** または nightly。
  PR 毎に回すには重く (4〜10s)、ablation の差分を見るのは「触ったときだけ」で十分。
- ベンチ実行を簡単にするため `package.json` の scripts に `bench` を追加。

### 決定性の扱い

- 各 fixture を 2 回走らせ JSON 完全一致を確認するモードを harness に持たせる
  (`--check-determinism`)。slice 3 (決定性テスト拡張) と統合される想定。

## 成果物

```
test/fixtures/suite/
  001-exact-fn-copy/
    base/src/...
    head/src/...
    expected.json
    README.md
  002-renamed-args/
  ...
  025-...
  README.md          # 全シナリオの一覧表 (タグ / 期待挙動)

tools/bench/
  index.ts           # CLI エントリ
  loadFixtures.ts    # suite/ 配下を走査して GT をロード
  setupRepo.ts       # base/ と head/ を一時 git repo に展開
  matchReport.ts     # GT vs report のマッチ判定 (Jaccard 0.5)
  metrics.ts         # recall@K / per-tag / ablation
  formatMarkdown.ts
  formatJson.ts
  configs/
    baseline.json
    heavy-token.json # グリッド用例
  README.md          # ハーネスの使い方

src/cli/
  // 変更なし。runDetector を再利用。

package.json
  // scripts に "bench" を追加 ("tsx tools/bench/index.ts")。
  // tsx は既に dev 依存に居るはず → 居なければ計画から除外し、
  // pnpm exec ts-node 等で代替する。

test/fixtures/suite-smoke.test.ts
  // smoke subset を vitest から実行する薄いラッパ。
```

`vitest.config.ts` (or `package.json` の `test` 設定):

- `test/fixtures/**` を test 対象から除外。fixture コードは型チェック / lint からも除外する。
- ただし `suite-smoke.test.ts` だけは include。

## フェーズ分け

Phase 1 で **基盤 + 25 シナリオ + ablation** を一気に作る。
シナリオを後追いで追加する形にすると taxonomy 全体での recall を判断できないため、
最初から 25 件揃えた状態で baseline 数値を確定させる。

### Phase 1: 基盤 + 全 25 シナリオ + ablation (M8 内で完結)

実装上は小さく分けて段階的にコミットする (1 PR とは限らない)。
順序:

1. **harness 骨格**
   - `expected.json` スキーマ + 手書きパーサ (zod を入れず軽量化)。
   - `setupRepo.ts` (base/ → 1 commit、head/ → 2 commit目)。
   - `matchReport.ts` (file path 完全一致 + line range Jaccard >= 0.5)。
   - `metrics.ts` (recall@10/50/all、negative violations、minScore failures、wallMs)。
   - `formatMarkdown.ts` / `formatJson.ts`。
   - **ablation も最初から組み込む**: 4 run (baseline + token-off + statement-off + call-off) を
     summary に行として並べる。`--no-ablation` でスキップ可能。
   - per-tag recall も最初から出す (シナリオ数が多いので軸別観察が必須)。
2. **fixture 投入**
   - 25 シナリオを順次書く。1 件ずつ「README.md → base/ → head/ → expected.json → bench で確認」のループ。
   - シナリオ追加のたびに `pnpm bench -- --only NNN-...` で個別検証。
3. **smoke 統合**
   - 全 25 件から **代表 5 件を選定** して vitest 経由で実行する `suite-smoke.test.ts` を作る。
     初版選定: `001-exact-fn-copy` / `004-renamed-locals` / `008-extra-log-stmt` /
     `017-tsx-component-copy` / `021-neg-shared-domain`。
4. **baseline 数値の記録**
   - `pnpm bench` の summary.md / summary.json を `tools/bench/baseline/` に
     チェックインしておき、将来の差分比較の基準点にする (毎回上書きはしない)。

### Phase 2: チューニング (M9 候補 / M8 範囲外を推奨)

- Phase 1 で得た per-tag recall と ablation 表を見て:
  - `tokenNgramSizes`, `statementNgramSizes`
  - `maxCandidatesPerFragment`
  - `weights`, `thresholds`
  をどう動かすと recall が上がる / negative violations が増えるかを観測。
- グリッド探索ヘルパ `tools/bench/grid.ts` を追加し、`configs/*.json` を
  まとめて回して比較表を出す。

### Phase 3: docs (slice 3 と合流)

- `docs/configuration.md` で全パラメータと「動かしたときの recall 影響」を Phase 1 の数値で記述。

## 受け入れ基準

Phase 1 (= 本スライス完了) の基準:

- [ ] `pnpm bench` が exit 0 で走り、summary.md / summary.json を生成する。
- [ ] 25 シナリオすべて GT (`expected.json`) と README が揃っている。
- [ ] baseline run の `recall@all` >= 0.8 (Phase 1 では緩めに置く。
      Phase 2 のチューニング後に 0.9 を目指す)。
- [ ] ablation 行が summary に出ている (baseline + token-off + statement-off + call-off の 4 行)。
- [ ] per-tag recall 表が summary に出ている。
- [ ] negative シナリオ (`021`〜`025`) で `negativeViolations` が
      合計 <= 5 (1 シナリオ平均 1 件以下)。Phase 2 で 0 を目指す。
- [ ] `tools/bench/baseline/` に baseline 結果がチェックインされている。
- [ ] smoke subset (5 件) が vitest 経由で通る。
- [ ] `pnpm typecheck` / `pnpm lint` が通る (fixture を除外して)。

## リスク / 留意点

- **fixture が増えると保守コストが膨らむ**。25 件は意図的に上限。30 を超えるなら
  「シナリオを 1 件足す代わりに 1 件削る」運用にする。各 fixture の README に
  「何を担保するか」を 1 文で書き、重複したら統合する。
- **GT は人間の主観**。recall ターゲットを高く設定しすぎると、
  「ターゲットに合わせて GT を緩める」逆転が起きる。Phase 1 では recall 0.8 で十分とし、
  Phase 2 のチューニング後に 0.9 を目指す段階方式にする。
- **25 件を一気に作るコスト**: シナリオ 1 件あたり「README + base/ + head/ + expected.json」で
  10〜15 分 × 25 = 4〜6h を見込む。harness 骨格と並行で進めると合計 1〜2 営業日。
- **Jaccard 0.5 マッチ閾値** は経験則。25 件投入後に実データを見て緩いか厳しいか
  最終調整する (Phase 1 内で完結させる)。
- **fixture コードの保守**: `.gitattributes` で `eol=lf` 固定し、改行差で
  決定性が崩れないようにする。
- **ベンチの実行時間**: 25 シナリオ × 4 run (baseline + 3 ablation) = 100 run。
  各 100ms としても 10s。CI フル実行は nightly 想定で問題なし。
- **smoke subset の選定**: 代表性を確保するため type-1 / type-2 / type-3 / tsx / negative
  から 1 件ずつ選ぶ (上記 "smoke 統合" 参照)。PR 毎の CI で 1〜2 秒以内に収まる想定。
- **baseline スナップショットを checkin するか**: 数値そのものをコミットすると
  小変更でも diff が出るので、`tools/bench/baseline/summary.md` のみコミットし
  `summary.json` は `.gitignore` 推奨。差分検知は markdown 表で行う。
- **Phase 2 を M8 内でやるか M9 に送るか**: Phase 1 でハーネスが走れば
  「設定をいじって recall を見る」は誰でもできる。M8 完了基準は Phase 1 のみとし、
  本格チューニング (Phase 2) は M9 に送るのが現実的。

## 依存

- Slice 1 (`m8-extensibility.md`): ablation で `features.enabled` を使う。済。
- Slice 3 (決定性テスト拡張): `--check-determinism` で合流する想定 (別計画)。
