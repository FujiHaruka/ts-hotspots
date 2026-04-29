# M8 (slice 3): 決定性テスト拡張

[docs/plans/milestones.md](./milestones.md) M8 受け入れ基準のうち
「決定性テストが CI 上でグリーン」を **全 fixture スイート規模で** 担保するためのスライス計画。

slice 2 ([m8-fixture-suite.md](./m8-fixture-suite.md)) で 25 シナリオの
fixture suite と bench harness (`--check-determinism` オプション) が
整ったので、それを vitest / CI に繋ぎ込んで回し続けられるようにする。

## 目的

本ツールのパイプラインは純粋なデータ変換で、非決定性が入る余地は構造的にほぼ無い
(`Map` / `Set` は挿入順保証、`Array.sort` は stable、`readdirSync` は sort 済み、
`Promise.all` 等の並列化なし、乱数・時刻なし)。各モジュールの "is deterministic"
単体テスト + `runDetector.test.ts` の最小 end-to-end ケースが既に存在する。

したがってこのスライスの位置付けは **高尚な正しさ検証ではなく、将来の回帰トリップワイヤ** である:

1. **並列化事故の予防**: 高速化のため `Promise.all` を導入した際に結果を sort せず
   使ってしまう、といった典型的な回帰を統合経路で検出する。
2. **新 tie-break 未定義の検出**: 新しいスコア要素やソート軸を追加したときに
   tie-break が未定義で実行毎に順序が揺れる、を拾う。
3. **受け入れ基準の文字面充足**: M8 milestone の「決定性テストが CI 上でグリーン」を満たす。

検知力は 1 件でも 25 件でも大差ない (同じ非決定性バグは fixture を増やしても
冗長に再現するだけ) という判断から、**代表 5 件** に絞る。
`bench --check-determinism` が 25 件 × 4 variant の厳密版を on-demand で提供する。

## Non-goals

- **クロスプロセス決定性**: 別プロセス起動 (`node` を spawn して bench を叩く)
  での一致は検証しない。単一プロセス内 2 回実行で崩れない = Map 反復順 / tie-break /
  ファイルスキャン順が安定 = 実質的な決定性要件は満たせる、という前提を置く。
  spawn ベースの検証は CI 時間を消費するだけで得るものが少ない。
- **クロスプラットフォーム決定性** (Linux / macOS / Windows): M8 の範囲外。
  `.gitattributes` で `eol=lf` 固定済みなので改行差は出ない、以上の保証はしない。
- **ランダム入力での fuzz**: slice 計画外。shape が固定された 25 fixture で十分。

## Approach

### 全体の形

- vitest 上で **代表 5 fixture** を回し、`runDetector` を **同一 repo / 同一 config で
  2 回** 呼び、`JSON.stringify(report)` の完全一致を assert する。
- 5 fixture は `suiteSmoke.test.ts` と同じ taxonomy カバー (type-1 / type-2 /
  type-3 / tsx / negative)。recall / precision は smoke、決定性は本ファイル、と
  責務を分けて両方にロジックを混載しない。
- bench harness 側の `--check-determinism` はそのまま残す。25 fixture × 4 variant
  (ablation 込み) の厳密版は on-demand で回せる。

### なぜ smoke と分けるか

- smoke は recall / precision の基本線を、決定性テストは report の安定性を、
  それぞれ独立した assertion として回す。assert 内容が違うので、落ちたときの
  原因切り分けを楽にするため別ファイルにする (実行は同じ `pnpm test` 1 発)。

### テストの構造

- 対象 fixture id は `suiteSmoke.test.ts` と同じ 5 件 (`001` / `004` / `008` /
  `017` / `021`)。taxonomy の各バケットから 1 件ずつ。
- fixture 毎に 1 `it()` を切る。崩れたときにどのシナリオで壊れたかが vitest の
  出力で即わかる。
- config は `defaultConfig` のみ。ablation variant での決定性は bench 側でカバー
  (on-demand)。CI で 4 variant 回すのは過剰。

### Config の決定性

- `defaultConfig` 1 本に固定する。config が変わったら決定性が崩れる可能性は低いが、
  ablation variant まで含めると vitest 時間が 4 倍 (~50s) に膨らむ。CI のコストと
  検知力のトレードオフで、ablation 決定性は bench on-demand に任せる。

### 既存単体テストとの関係

- 以下の既存 "is deterministic" テストは残す。責任範囲が違う:
  - `src/cli/runDetector.test.ts` "is deterministic across repeated runs":
    最小シナリオでの end-to-end 決定性。pre-commit hook の高速フィードバックとして機能。
  - 各モジュールの単体決定性テスト (inverted index / ranking / collapsePairs 等):
    Map 反復順 / tie-break の局所的な回帰を狙い撃ちで検知。
- 今回追加する `suiteDeterminism.test.ts` は「全 25 fixture 分の end-to-end」を
  担当する。既存テストとの重複があっても保持コストは小さい (1 ファイル)。

## 成果物

```
test/suiteDeterminism.test.ts
  // 全 25 fixture を 2 回走らせ JSON 一致を検証。
  // loadFixtures + setupRepo + runDetector を再利用。

docs/plans/m8-determinism.md
  // 本計画ドキュメント。
```

bench harness 側 (`tools/bench/index.ts`) は既に `--check-determinism` を持つので変更なし。

## 受け入れ基準

- [ ] `test/suiteDeterminism.test.ts` が 5 ケース全てパスする (`pnpm test`)。
- [ ] 各 fixture が独立した `it()` になっており、壊れたシナリオ ID が
      vitest 出力から一目でわかる。
- [ ] `pnpm typecheck` / `pnpm lint` 通過。
- [ ] vitest 全体の実行時間の増分が **+2s 以内** に収まる。

## リスク / 留意点

- **flaky を誤検知しないこと**: JSON 完全一致を assert するので、ほんの 1 文字の
  ランダム性でも落ちる。落ちたら即 root cause (どの Map 反復 / どの sort の tie-break) を
  追う。リトライでごまかさない。
- **単体決定性テストとの重複**: 各モジュールの "is deterministic" テストと
  意図的に役割が被るが、統合経路でのみ顕在化する回帰 (並列化導入など) を拾う
  セーフティネットとして 5 件分は残す。

## 依存

- Slice 2 (`m8-fixture-suite.md`): `loadFixtures` / `setupRepo` / 25 fixture を再利用。済。
- Slice 1 は独立 (ablation variant の決定性は CI 範囲外)。
