# M8 (slice 1): 特徴量 1 系統 off の拡張性

[docs/plans/milestones.md](./milestones.md) M8 の受け入れ基準のうち
「設定で特徴量を 1 系統 off にしても動作する (拡張性要件の確認)」を満たすためのスライス計画。

## 目的

token / statement kind / call-property の 3 系統のうち任意の 1 系統を
設定で無効化しても、パイプライン全体が壊れず、残り系統だけで検出が走ることを保証する。

これは v1.md §4〜§7 で「3 系統」と書かれている箇所を config 切り替え可能にする作業で、
後続の性能チューニングや ablation 実験 (どの系統が recall/precision にどれだけ効くか) の前提になる。

## Approach

### 切り口

現状 config には **n-gram サイズ** しか系統別のフラグがなく、`[]` にすれば token / statement
は事実上ゼロ化するが `call` はそもそも off にできない。また系統別に off にしても
`combinedScore` の重み正規化と `shouldReport` の OR 判定には残り続けるため、
「系統を消したのに combined に 0 が混ざって他軸のスコアが薄まる」「0 点の軸の threshold を
OR で誤ってチェックする (実害はないが意図と乖離)」という副作用が起きる。

これを**明示的な `enabled` フラグ** を config に足すことで、次の一貫した挙動に揃える:

1. 無効化された系統は **特徴量抽出自体を行わない** (空配列)。CPU を 1/3 程度節約できる見込み。
2. `combinedScore` は **無効軸を分子・分母から除外** して再正規化する。重み比は維持。
3. `shouldReport` は **無効軸の OR 判定をスキップ**。
4. `buildInvertedIndex` / `searchCandidates` は変更なし (空配列を受け取れば自然に何もしない)。
5. report の evidence / riskFlags も自然に空になる (追加コード不要)。

size 軸は fragment のペア属性であり特徴量ではないので toggle の対象にしない。

### Config 形状

既存のフラットな並びを壊さない **additive** な形で追加する:

```ts
// src/config/config.ts
features: {
  enabled: {
    token: boolean;
    statement: boolean;
    call: boolean;
  };
  tokenNgramSizes: number[];
  statementNgramSizes: number[];
};
```

デフォルトは 3 系統すべて `true`。後方互換は v1 リリース前なので気にしない。

### なぜ enabled を分けて持つか (n-gram サイズを `[]` で代用しないか)

- 「token は off / statement は on」 の意図を **1 箇所で宣言** できる。
- `tokenNgramSizes: []` は「token を off」を意味するのか「(運用中に誤って空になった)」
  を意味するのか曖昧。`enabled.token = false` なら明示。
- `call` には n-gram サイズがなく対称性が壊れる。enabled なら 3 系統対称。
- ablation 実験で「サイズはデフォルトのまま系統だけ抜く」操作が 1 行で書ける。

### combinedScore の再正規化

現状:

```ts
sum = w.token + w.statement + w.call + w.size;
combined = (w.token/sum)*token + (w.statement/sum)*statement + ...
```

変更後:

```ts
wToken = enabled.token ? weights.token : 0;
wStatement = enabled.statement ? weights.statement : 0;
wCall = enabled.call ? weights.call : 0;
wSize = weights.size;
sum = wToken + wStatement + wCall + wSize;
combined = (wToken/sum)*token + (wStatement/sum)*statement + (wCall/sum)*call + (wSize/sum)*size;
```

これで「token を off にすると combined に占める statement / call の比率が相対的に上がる」という
直感的な挙動になる。閾値 `thresholds.combined = 0.3` の意味が「有効軸の加重平均」として
そのまま残るので、既定閾値を触らずに済む。

### shouldReport のスキップ

```ts
if (score.combined >= thresholds.combined) return true;
if (enabled.token && breakdown.tokenOverlap >= thresholds.token) return true;
if (enabled.statement && breakdown.statementKindSimilarity >= thresholds.statement) return true;
if (enabled.call && breakdown.callOverlap >= thresholds.call) return true;
return false;
```

実害としては「無効軸のスコアは常に 0 なので閾値を超えない」ので現状でも問題は出ないが、
**設定の意図と挙動を一致させる** という M8 の目的に沿って明示的にスキップする。

## 成果物

### 変更ファイル

- `src/config/config.ts` — `features.enabled` 型を追加。
- `src/config/defaults.ts` — 3 系統 `true` で既定化。
- `src/features/extractFeatures.ts` — 無効系統は空配列。
- `src/scoring/combinedScore.ts` — `enabled` を受け取り再正規化。
- `src/scoring/scoreCandidate.ts` — `config.features.enabled` を `combinedScore` に渡す。
- `src/scoring/decide.ts` — 無効軸の OR をスキップ。

### テスト (新規 / 拡張)

- `src/features/extractFeatures.test.ts` — 3 系統それぞれを off にして該当配列だけが空になる。
- `src/scoring/combinedScore.test.ts` — 1 軸 off のとき、残り 3 軸 (size 含む) の加重平均に一致する。
- `src/scoring/decide.test.ts` — 無効軸はたとえブレイクダウンに高いスコアが入っていても OR で拾わない (防御的な挙動確認)。
- `src/cli/runDetector.test.ts` — 既存の最小 repo を流用し、`token` / `statement` / `call` の
  いずれか 1 系統を off にしても `runDetector` が例外を出さず JSON レポートを返すことを確認。

## 受け入れ基準

- [ ] 上記テストが全て通る (`pnpm test`)。
- [ ] `pnpm typecheck` / `pnpm lint` が通る。
- [ ] 3 系統いずれを off にしても E2E 1 件以上の候補が拾える fixture が 1 つ以上ある
      (関数全体コピーは token/statement/call 全て効くので off にしても他 2 系統で拾える想定)。
- [ ] `combinedScore` が disabled 軸を除外して正規化する (残り軸の加重平均に等しい)。

## 依存 / 次のスライス

- これが済んだら M8 の次スライス (計測ハーネス / ground-truth fixture / パラメータ再検討) に進む。
- 本スライスで追加した `features.enabled` は、後段の ablation 計測 (「token を切ると recall が
  どれだけ落ちるか」) で直接使う。

## リスク / 留意点

- **default で全 true** — 既存テストは挙動が変わらないことが前提。combinedScore は
  sum = `0.4+0.3+0.2+0.1 = 1.0` なので、enabled が全 true なら現状と数値一致する。
- **scoreCandidate のシグネチャは変えない** (`config` を既に取っている)。`combinedScore` は
  呼び出し側 1 箇所なので安全に `enabled` 引数を追加できる。
- **型定義の順序** — `enabled` を `tokenNgramSizes` の前に置く (読む順が「何を on/off するか」 →
  「どの粒度で抽出するか」の方が自然)。
