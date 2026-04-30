# 6. 報告判定

実装は `src/scoring/decide.ts`。

候補ペアを最終的にレポートに乗せるかを決める。**OR ベース**で、recall を優先する。

```
report ⇔
   combined  ≥ thresholds.combined
∨ (token     ≥ thresholds.token     ∧ token 軸が enabled)
∨ (statement ≥ thresholds.statement ∧ statement 軸が enabled)
∨ (call      ≥ thresholds.call      ∧ call 軸が enabled)
```

すべての比較は inclusive (`>=`)。閾値ちょうどのペアは報告される。

## デフォルト閾値

```
combined:  0.30
token:     0.35
statement: 0.45
call:      0.40
```

合体スコアが 0.30 に届かない弱いペアでも、いずれかの軸が単独で強ければ拾う。例えば:

- `tokenOverlap = 0.5`, 他 = 0 のペア → token 単独で報告。
- `callOverlap = 0.45`, 他 = 0.1 のペア → call 単独で報告。

## 閾値ベース報告のフラグ立て

「結合スコアは弱いが軸単独で滑り込んだ」ケースは、レビュアーが自前で評価し直したいことが多い。`recommendationHint.ts` で:

- `combined < 0.3` かつ
- いずれかの軸が単独閾値を超えて報告された

ペアには `riskFlags: ["threshold-based", ...]` を付ける。これにより下流側で「単軸由来の弱いマッチ」を絞り込みやすい。

## 無効化された軸の扱い

`config.features.enabled.*` で off にされた軸は OR 条件から **完全に除外** される。0 スコアによる暗黙の不一致を「マッチ」扱いしないため。combined への寄与も §5.2 で重み 0 化される。

## 設計トレードオフ

- 単軸での通過を許すことで偽陽性も増える。これは仕様上の意図 (recall 優先)。precision を上げたい場合は閾値を上げるか、enabled を絞る運用で対応する。
- combined 単独で判定しないのは、強い局所的一致 (例: API 利用の重なりが極めて多い) を combined の薄まりで取り逃すのを避けるため。
