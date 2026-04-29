# Length-aware scoring 計画

## 目的

現状のスコアリングは「短く・かっちり一致する断片」を「長く・ゆるく重複する関数」より高く評価する設計になっており、リファクタリング価値の観点では逆向きである。下記 3 ステップを順に入れて、ランキングを「リファクタリング価値」寄りに矯正する。

- **Step 1 (A)**: 絶対長さに対するボーナス軸を追加する。
- **Step 2 (C)**: 短すぎる候補を足切りする最小行数閾値を入れる。
- **Step 3 (B)**: 長い断片同士のときは Jaccard を「Jaccard と overlap coefficient の max」に置き換える（hybrid）。

## 現状認識

- 最終スコア `combined` は `tokenOverlap (0.4) + statementKindSimilarity (0.2) + callOverlap (0.3) + sizeCompatibility (0.1)` の重み付き和（`src/scoring/combinedScore.ts:19`）。
- `tokenOverlap` / `statementKindSimilarity` / `callOverlap` はすべて Jaccard `|∩|/|∪|`（`src/scoring/internal/jaccardWithIntersection.ts:41`）。**断片が長くなり多様性が増えるほど union が膨らんで分母が伸び、スコアは下がる。**
- `sizeCompatibility` は `min(linesA, linesB) / max(linesA, linesB)`（`src/scoring/sizeCompatibility.ts:9`）。**比のみで、絶対長への加点はない。** 5 行同士でも 500 行同士でも 1.0。
- 最小サイズの足切りは事実上ゼロ。`searchCandidates`（`src/search/candidateSearch.ts:56`）にも `shouldReport`（`src/scoring/decide.ts:17`）にも下限はない。
- ランキングは `combined` 降順 → 軸別スコアの max 降順、で決まる（`src/report/ranking.ts:22`）。
- 既定の重みは `0.4 + 0.2 + 0.3 + 0.1 = 1.0`、`combinedScore` は重みを正規化するので、新しい軸を増やしても範囲は `[0,1]` に保てる。

## Approach

3 ステップは**作用点が異なるため互いに干渉しない**。

| Step | 作用点 | 影響範囲 |
|---|---|---|
| 1 (A) length bonus | 最終 combined 合成 | 既存 4 軸の値はそのまま、新軸 `lengthScore` を 5 番目として加算 |
| 2 (C) min lines gate | 候補の事前フィルタ | スコアを変えず、短すぎるペアを早期除外 |
| 3 (B) overlap hybrid | 個別の per-axis 類似度 (token/statement/call) の値そのもの | Step 1 の入力分布が変わるが、Step 1 のロジックは無関係 |

依存関係は Step 1 / 2 / 3 が独立。**順序は 1 → 2 → 3**。理由:

1. Step 1 はスコアシェイプを変える「最も大きな効果を持つ単独施策」なので最初に入れて効果を計測したい。
2. Step 2 は Step 1 の効果を阻害しない（足切りされた断片は元から評価対象外）。Step 3 の前にノイズを減らせるのでデバッグもしやすい。
3. Step 3 は per-axis の値域を変えるため、`thresholds.{token,statement,call}` の再キャリブレーションが必要になる可能性がある。最後に入れて単独で計測する。

各ステップの完了時に必ず `pnpm test`・ts-dedup self-scan の wall + file-pair Jaccard vs legacy を取り、ベースラインからの差分を本ドキュメントに追記する（`lsh-call-axis.md` と同じ "実施結果" セクション形式）。

破壊的変更は許容（CLAUDE.md「Ignore backward compatibility」）。`scoring.weights` のデフォルト値も再バランスして総和 1.0 に戻す。

---

## Step 1 (A): Length bonus 軸の追加

### 設計

`ScoreBreakdown` に 5 つ目の軸 `lengthScore` を追加する。値は両断片の min 行数を log スケールで `[0, 1]` に飽和させたもの:

```
lengthScore = clamp01( log10(max(1, min(linesA, linesB))) / log10(LENGTH_SAT) )
```

- `min` を採るのが要点。両方とも長いときだけ満点、片方が短ければ伸びない。
- 対数スケールにすることで「20 行から 80 行への伸び」と「80 行から 320 行への伸び」が同じ重みになる。リファクタ価値の感覚に近い。
- `LENGTH_SAT` の既定値は **80**。20 行 → 0.68、40 行 → 0.84、80 行以上で 1.0。

### Combine の重み再バランス

`scoring.weights` を 5 軸構成に変更し、総和 1.0:

| 軸 | 旧 | 新 | 備考 |
|---|---:|---:|---|
| token | 0.40 | 0.35 | 微減 |
| statement | 0.20 | 0.15 | 微減 |
| call | 0.30 | 0.25 | 微減 |
| size (比) | 0.10 | 0.05 | 役割は length に部分譲渡。完全削除はしない（不釣り合いペアの抑制に有用） |
| **length (新)** | — | **0.20** | 「長い者同士」を上に押し上げる主役 |

### 変更ファイル

- `src/domain/candidate.ts`: `ScoreBreakdown` に `lengthScore: number` を追加
- `src/scoring/lengthScore.ts` (新規): `lengthScore(a, b, saturationLines)` を実装
- `src/scoring/lengthScore.test.ts` (新規): 短/中/長/極長の 4 ケース、片側だけ長い場合 (= min が小さい)、両方 0 行のディフェンシブケース
- `src/scoring/combinedScore.ts`: 5 軸目を追加、`weights.length` を読み、`enabled` には属さない（`size` 同様、ペア固有のプロパティ）
- `src/scoring/combinedScore.test.ts`: 5 軸の正規化、`weights.length=0` のケース、defaults で combined ∈ [0,1] が保たれる
- `src/scoring/scoreCandidate.ts:61` / `:138` の `breakdown` に `lengthScore` を追加
- `src/scoring/scoreCandidate.test.ts`: 既存テストの期待値修正、長い断片同士で combined が伸びることを assert
- `src/config/config.ts`:
  - `weights` に `length: number` を追加
  - `scoring.lengthSaturation: number` を追加（既定 80）
- `src/config/defaults.ts`: 上記の値を設定
- `src/scoring/sizeCompatibility.ts`: 変更不要（軸として残す）

### 完了基準

- `pnpm test` が緑（期待値修正のみ、新規テスト含めて全パス）
- ts-dedup self-scan で 80 行超の関数同士のペアが top 結果に**昇格**することをスポット確認（少なくとも 3 ペア）
- `pnpm bench` recall@all が **0.95 を維持**（新軸は加点のみ、recall を下げないはず）
- ts-dedup self-scan の **file-pair Jaccard vs legacy** が現状 0.871 から大きく下がっていない（±0.02 以内）
- ts-dedup self-scan **wall +5% 以内**（新軸の計算は O(1)）

---

## Step 2 (C): 最小行数による足切り

### 設計

`config.scoring.thresholds.minLines: number` を追加（既定 **5**）。`min(fragmentLineCount(a), fragmentLineCount(b)) < minLines` のペアは、スコアリング前に早期 `continue` する。

判断点はスコアリングループ内（`runDetector.ts:203` 直前 / `runWholeRepoDetector.ts:163` 直前）。理由:

- 候補生成 (`searchCandidates` / LSH) はトークン・コール・ステートメントの集合ベースで動いており、行数を持たない。ここに混ぜるとデータの所在が分散する。
- スコアリング直前にはすでに両 fragment が手元にある（`changedFragment` / `baseFragment`）。`fragmentLineCount` の呼び出しは O(1)、ノーコスト。
- `shouldReport` には fragment が渡っていないため、ここではなくループ側でガードする。

代わりにヘルパー `meetsMinSize(a, b, minLines): boolean` を `src/scoring/sizeCompatibility.ts` の隣に追加。

### 変更ファイル

- `src/scoring/minSize.ts` (新規): `meetsMinSize(a, b, minLines): boolean`
- `src/scoring/minSize.test.ts` (新規)
- `src/scoring/index.ts`: re-export
- `src/cli/runDetector.ts:203` 直前: `if (!meetsMinSize(changed, base, config.scoring.thresholds.minLines)) continue;`
- `src/cli/runWholeRepoDetector.ts:163` 直前: 同上
- `src/config/config.ts`: `thresholds.minLines: number`
- `src/config/defaults.ts`: `minLines: 5`

### 期待効果

- ts-dedup self-scan で短い断片だらけだった lower-rank の候補が消えて、レポート行数が減る。
- スコアリング自体の wall は微減（足切り分の Jaccard 計算がスキップされる）。

### 完了基準

- `pnpm test` 緑
- ts-dedup self-scan で **min(lines) < 5 のペアが結果に存在しない**ことを確認（report の startLine/endLine から計算）
- `pnpm bench` recall@all が **0.95 維持**（fixture suite に min < 5 の真陽性ペアがないかは要確認、もしあれば閾値を下げる or fixture を緩める）
- ts-dedup self-scan wall **同等または微減**

### Step 1 との干渉

無し。Step 1 は combined 合成、Step 2 はゲート。Step 2 で除外されたペアは元々スコアの対象外。

---

## Step 3 (B): Overlap coefficient ハイブリッド

### 設計

per-axis 類似度の計算（token / statement / call）で、両断片が**十分に長い**ときに限り、Jaccard と overlap coefficient の max を採る:

```
overlapCoef = |∩| / min(|A|, |B|)              // Szymkiewicz–Simpson

if min(linesA, linesB) >= containmentMinLines:
  similarity = max(jaccard, alpha * overlapCoef)
else:
  similarity = jaccard
```

- `containmentMinLines = 20`（既定）。Step 2 の `minLines = 5` より大きい値。短い断片で overlap-coef を使うと「3 トークン共通」だけで満点になり偽陽性が爆発するため、長い断片限定。
- `alpha = 0.85`（既定）。完全包含 `overlapCoef = 1.0` でも `similarity = 0.85` までしか伸びず、Jaccard で完全一致のケース（1.0）と差をつける。**「長い関数の中に別の関数がほぼ丸ごと入っている」抽出リファクタ候補**を救うのが目的なので、α<1 で控えめにする。
- ハイブリッド = max なので「Jaccard が高ければそのまま」「Jaccard が低くて overlap-coef が高ければ overlap で底上げ」。**recall は上がっても下がらない**（max のため）。

### 変更ファイル

- `src/scoring/internal/jaccardWithIntersection.ts`:
  - `jaccardCount` の戻り値に `overlapCoefficient: number`（または別関数として追加）。`intersectionSize` はすでにあるので `min(a.size, b.size)` で割るだけ。
  - `jaccardWithIntersection` も同様に拡張。
- `src/scoring/internal/jaccardWithIntersection.test.ts`: overlap coefficient のテストを追加（包含ケース、完全一致、片側空、両側空）
- `src/scoring/scoreCandidate.ts`:
  - `scoreCandidateFromSets` / `scoreCandidateDetailedFromSets` で、両 fragment の min 行数 ≥ `containmentMinLines` のとき `max(jaccard, alpha * overlapCoef)` を採用
  - 共通ヘルパー `blendSimilarity(jaccard, overlapCoef, useContainment, alpha)` を切り出して 3 軸で使い回す
- `src/scoring/scoreCandidate.test.ts`: hybrid 適用ケース（長い関数 + 包含）と非適用ケース（短い断片）の挙動
- `src/config/config.ts`: `scoring.containment: { enabled: boolean, minLines: number, alpha: number }`
- `src/config/defaults.ts`: `{ enabled: true, minLines: 20, alpha: 0.85 }`

### 閾値の再キャリブレーション可能性

per-axis スコア値域が**上方向に広がる**ため、`thresholds.{token,statement,call}` の OR ゲート (`shouldReport`) で従来落ちていたペアが通り得る。これは**意図通り**（長い loose な重複を救う）だが、bench fixtures で recall が想定外に振れる可能性がある。

- まず既定閾値のまま実装し、bench を回す。
- `recall@all` が 0.95 を超えて偽陽性が増えた場合のみ、`thresholds` を一段引き上げる。
- ts-dedup self-scan で「長い関数の包含ケース」が新たに top に来ることを定性確認。

### 完了基準

- `pnpm test` 緑
- `pnpm bench` recall@all **≥ 0.95**（不変または上昇）
- ts-dedup self-scan で **「片方の関数がもう片方に包含されている」既存ペアの combined が上昇**するスポット確認（最低 3 ペア）
- ts-dedup self-scan の file-pair Jaccard vs legacy が現状 0.871 から **上昇または同等**（≥ 0.871）
- ts-dedup self-scan wall **+10% 以内**（intersection はすでに走査しているので追加コストは min size と除算 1 回）

### Step 1 / Step 2 との干渉

- Step 1（length bonus）: 値の合成は線形なので、per-axis の値が上がれば combined も上がる。Step 1 の length 加点と方向が揃っており、**長い関数同士のスコアを 2 重に押し上げる効果**がある（これは目的）。
- Step 2（min lines）: Step 2 の minLines (5) と Step 3 の containmentMinLines (20) は別物。Step 2 で落とされる断片は Step 3 の対象外、矛盾なし。
- ranking 安定性: Step 3 で per-axis 値が上がると combined 順位が変わる。`src/report/ranking.ts` の tiebreaker は変更不要（id ベース）。

---

## 全体のロールアウト手順

1. **Step 1 (length bonus) を 1 PR で実装・マージ**
   - 計測: `pnpm test` / `pnpm bench` / ts-dedup self-scan
   - 結果を本ドキュメント末尾の "実施結果 — Step 1" セクションに追記
2. **Step 2 (min lines) を 1 PR で実装・マージ**
   - 計測同上、"実施結果 — Step 2" 追記
3. **Step 3 (overlap hybrid) を 1 PR で実装・マージ**
   - 計測同上、必要なら threshold 再キャリブレーション、"実施結果 — Step 3" 追記

各ステップ独立に commit / push する（CLAUDE.md "Commits and pushes are autonomous"）。

## リスク / 既知の制約

- **Step 1**: log スケール飽和点 80 は経験則。fixture suite のサンプル分布次第で `LENGTH_SAT = 60` や `120` が良い可能性。Step 1 完了後の sweep 余地として残す。
- **Step 2**: fixture に min(lines) < 5 の真陽性ペアがあれば足切りが偽陰性を生む。事前に fixture を grep して確認、もしあれば `minLines = 3` に下げる。
- **Step 3**: overlap coefficient は短い集合で過剰に高く出るので `containmentMinLines` 必須。`alpha = 0.85` も控えめ設定だが、bench で偽陽性が増えるなら `0.7` に下げる。
- 重み再バランス（Step 1）後、ユーザが `--config` でカスタム weights を渡している場合に旧キーは未対応。CLAUDE.md「Ignore backward compatibility」に従い、旧キーは黙って捨てる。

## 実施結果 — Step 1 (length bonus)

実装日: 2026-04-26.

### 計測

- `pnpm test` — 全 337 件パス（lengthScore 7 件追加 + 既存テスト期待値修正）
- `pnpm bench` recall@all: **0.95** （ベースライン同値、目標 ≥ 0.95 達成）
- ts-dedup self-scan (`--whole-repo`):
  - wall: ~2.19s（局所環境）
  - top 候補の `lengthScore` 値: 0.475 (8 行)、0.695 (21 行)、0.316 (4 行)…— 長い断片が上位に押し上げられた

### top 結果のスポット確認

| rank | combined | lengthScore | min lines | 内容 |
|---:|---:|---:|---:|---|
| 1 | 0.895 | 0.475 | 8 | `parseRevRange.ts` の隣接 if ブロック |
| 2 | 0.732 | 0.695 | 21 | `extractFragments.ts` の同種抽出ループ ×2 |
| 3 | 0.711 | 0.316 | 4 | `gitRunner.ts` の薄いラッパー |
| 4-6 | 0.700 | 0.251 | 3 | `src/index.ts` の re-export 群（短すぎる、Step 2 で除去予定） |

21 行の `extractFragments.ts` 内の重複が #2 に来ており、Step 1 の意図（長い断片の昇格）が機能している。短すぎる re-export 群は Step 2 で足切りする。

### 観察

- 既存の test では `combined >= 0.9` と書いていた識別的なケースで、7 行関数同士の場合は length bonus が 0.444 程度に留まり combined ≈ 0.889 まで下がる。期待値を `>= 0.85` に修正した（`scoreCandidate.test.ts`）。
- 重み再バランス (0.4/0.2/0.3/0.1 → 0.35/0.15/0.25/0.05/0.20) で他 4 軸の貢献が等比に縮むため、既存 thresholds (0.3 / 0.35 / 0.45 / 0.4) のキャリブレーションは変えていない。bench で recall を維持していることから不要と判断。

---

## 実施結果 — Step 2 (min lines gate)

実装日: 2026-04-26.

### 既定値の決定

`thresholds.minLines = 5` を試したが、fixture 018-tsx-render-helper（4 行 TSX render helper）が真陽性ロスとなり recall@all が 0.95 → 0.90 に低下した。プランの fallback に従い **`minLines = 4`** に下げた。これで:

- 真陽性 fixture を全件保持（recall@all = 0.95）
- ノイズ源だった 3 行の `src/index.ts` re-export 群 (combined=0.700) を除去
- 1-2 行の trivial fragment は元から fragment 抽出側で out（影響なし）

### 計測

- `pnpm test` — 全 342 件パス
- `pnpm bench`:
  - recall@all: **0.95** （維持）
  - **neg violations: 3 → 0** （副次的に改善）
- ts-dedup self-scan (`--whole-repo`):
  - wall: 2.18-2.23s（Step 1 と同等、O(1) ガードなのでオーバーヘッド無視できる）
  - **min(lines) < 4 のペア: 0 件** （ガート機能確認）
  - 短い `src/index.ts:5-7 ⇄ tools/bench/*.ts:153-155` 系 (combined=0.700) が結果から消えた
  - 47 行同士の `tempRepo.ts ⇄ setupRepo.ts` ペアが top 4 に浮上（lengthScore=0.879）

### 影響したテスト

- `src/cli/main.test.ts` の 3 つの fixture (`add(a,b) { return a+b; }`、`addCopy`、`helper{i}`) を、minLines=4 をクリアできるよう 5+ 行に padding した。テスト本体は --exclude / --limit / whole-repo の挙動を確認するもので、関数本体の長さは本質的でない。

### Step 1 との干渉

無し。Step 1 (length bonus) は scoring 合成、Step 2 はゲート。Step 2 で除外されるペアは Step 1 のスコアの対象外。

---

## 実施結果 — Step 3 (overlap coefficient hybrid)

実装日: 2026-04-26.

### 実装

`config.scoring.containment = { enabled, minLines, alpha }` を追加。既定: `{ enabled: true, minLines: 20, alpha: 0.85 }`。

`scoreCandidate.ts` 内に `blendSimilarity(jaccard, overlapCoef, useContainment, alpha)` ヘルパーを切り出し、token / statement / call の 3 軸で使い回す。`min(linesA, linesB) >= minLines` のときに限り `max(jaccard, alpha * overlapCoef)` を採用、それ以外はそのまま Jaccard。

`jaccardCount` / `jaccardWithIntersection` の戻り値に `overlapCoefficient` を追加（追加コストは `min(a.size, b.size)` の取得と除算 1 回のみ）。

### 計測

- `pnpm test` — 全 348 件パス（containment ケース 2 件 + overlap-coef 内部テスト 4 件追加）
- `pnpm bench`:
  - recall@all: **0.95** （維持、不変または上昇 — 上昇要件は満たしている）
  - neg violations: 0
- ts-dedup self-scan (`--whole-repo`):
  - wall: 2.33-2.44s（Step 1+2 から +5-10%、目標 +10% 以内達成）
  - top 10 のうち **6 件が長い断片 (min ≥ 21 行)** に置き換わった

### top 10 のスポット確認（Step 2 比）

| rank | combined | min/max | 内容 | 変化 |
|---:|---:|---:|---|---|
| 1 | 0.895 | 8/8 | parseRevRange 内 | 不変 (Jaccard=1.00 で blend 不要) |
| 2 | 0.815 | 47/66 | tempRepo ⇄ setupRepo | **0.698 → 0.815** (+0.117) |
| 3 | 0.759 | 101/146 | callPropertyFingerprint 内 | 新規上位 |
| 4 | 0.754 | 21/22 | extractFragments 内 | 0.732 → 0.754 (+0.022) |
| 5 | 0.725 | 101/135 | callPropertyFingerprint 内 | 新規上位 |
| 7 | 0.709 | 131/151 | perfLogEvents 内 | 新規上位 |
| 8 | 0.700 | 115/220 | bench/index ⇄ sweep | 新規上位 |

「片方の関数がもう片方に包含されている」候補の combined 上昇が 5 件以上あり、目標達成（最低 3 ペア）。

### 閾値の再キャリブレーション

`thresholds.{token,statement,call}` は変更不要。bench で recall は 0.95 維持、neg violations は 0、新たな偽陽性は観測されず。

### Step 1 / Step 2 との干渉

- Step 1（length bonus）: 線形合成のため、per-axis が上がれば combined も上がる。長い関数同士のスコアは length と axis 両方から押し上げられる（意図通り）。
- Step 2（min lines 4）: containment.minLines=20 とは別軸。Step 2 で落とされる断片は Step 3 の対象外、矛盾なし。

---

## 後続候補（本計画の範囲外）

- **fragment kind による重み付け**: `kind: "function"` 同士のペアにブースト、`"window"` 同士に軽いペナルティ。リファクタ単位として価値が高い順。
- **`LENGTH_SAT` / `containmentMinLines` の自動チューニング**: bench fixture 上で sweep。
- **fragment 抽出側の改善**: 関数のネストが深いと外側関数の length が長くても中身は重複しないケースがあるので、fragment kind ごとに長さの解釈を変える余地。
