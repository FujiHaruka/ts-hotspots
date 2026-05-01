# 5. 類似度スコアリング

候補ペアごとに 4 軸のスコアを計算する。実装は `src/scoring/`。

## 5.1 軸の定義

| 軸 | 計算 | 意味 |
|---|---|---|
| `tokenOverlap` | クエリ側 token n-gram 集合と base 側 token n-gram 集合の **Jaccard** | 局所的なトークンの並びがどれだけ一致するか |
| `statementKindSimilarity` | 同上 (statement n-gram 集合) | 制御構造の並びがどれだけ一致するか |
| `callOverlap` | 同上 (call/property fingerprint 集合) | 呼び出し / プロパティの一致度 |
| `sizeCompatibility` | `min(linesA, linesB) / max(linesA, linesB)` | サイズの近さ。極端に大きさが違うペアを減点 |

すべて [0, 1] に収まる。

### Jaccard 計算

`src/scoring/internal/jaccardWithIntersection.ts` で 1 パスで Jaccard 値と **交差集合** を同時に取り出す。交差集合はレポートの evidence にそのまま使うため、別途計算しないことで再走査と Set 再構築のコストを省く。

set の構築自体は fragment 単位で 1 回だけ行う (`buildFeatureSets`)。1 つの fragment が複数候補に登場する場合、set はそのまま再利用される。

### サイズ整合

`src/scoring/sizeCompatibility.ts`。`fragmentLineCount` は `endLine - startLine + 1`。0 行 fragment は 1 行扱いにフォールバック (NaN 回避)。

## 5.2 結合スコア

実装は `src/scoring/combinedScore.ts`。

```
combined = (w_token / W) * tokenOverlap
         + (w_stmt  / W) * statementKindSimilarity
         + (w_call  / W) * callOverlap
         + (w_size  / W) * sizeCompatibility
```

- `W` は有効重みの合計。デフォルト重みは `(0.4, 0.3, 0.2, 0.1)` で合計 1.0、つまり通常は正規化が no-op。
- ユーザが任意の正値で重みを上書きしても、`W` で割って [0, 1] に収まるよう正規化する。これにより閾値の意味が壊れない。
- `config.features.enabled` で **off にした系統の重みは分母分子両方から除外** する。残った軸の相対比は保たれる。`size` は系統ではなくペア属性なので常時 on。
- 全重みが 0 のときは 0 を返す (defensive)。

## 5.3 グループ並び順 (churn amplifier)

ペアの `combined` はそのままにしつつ、**グループの並び替えだけ** churn (= ファイル単位のコミット数) で増幅する。

```
groupChurnMax = max(churn[file] for file in groupFiles)   // 同一ファイルは 1 回計上
amplifier     = 1 + alpha * min(groupChurnMax, cap) / cap
groupSortKey  = aggregateScores.combined.max * amplifier
```

- 既定値は `alpha = 0.5`, `cap = 20`。最大増幅は 1.5×。combined=0.4 + churn 飽和 (=0.6) > combined=0.55 + churn 0 (=0.55) という入れ替わりが起きる程度に控えめにしてある。
- churn が 0 / 利用不可 (`--no-churn`、非 git、shallow clone) の場合は `amplifier = 1.0` になり、増幅前の `combined.max` 順とビット同一。
- pair-level の `scoreCandidate` / `ranking.ts` のペアソートには触らない。`combined.max` を持つペアそのものを動かさず、グループの並び順だけを leverage で矯正する設計。
- `aggregateScores.combined.amplified` フィールドにソートに使った値をそのまま露出 (verbose レポートのみ)。`aggregateChurn = { max, min, perFile }` も同梱され、下流の agent / レビュアが「max 高 + min 低 (サイレント分岐)」と「max 高 + min 高 (協調修正)」を読み分けられるようになっている。
- churn コレクタは `comp` と同一実装 (`src/collectors/churn/commit-count.ts`)。CLI フラグ (`--churn-window`, `--churn-ref`, `--no-churn`) も完全に共通。

## 5.4 evidence の同時生成

各軸の Jaccard と一緒に **昇順ソート済みの交差キー** を返している (`jaccardWithIntersection`)。これは:

- レポートの `sharedCalls` / `sharedProperties` / `matchedStatementKinds` / `matchedTokenNgramsSample` の生成にそのまま使う。
- ソートは決定的出力のため。
- token については後段で `tokenNgramSampleSize` (デフォルト 5) で先頭サンプルを取る。

「なぜ似ていると判定したか」を機械にも人間にも提示するため、スコアと根拠を 1 パスで取り出す設計になっている (§3.3 要求仕様)。
