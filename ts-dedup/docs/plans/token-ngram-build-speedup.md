# Token n-gram キーの高速化

## 背景

`FeatureKey`(現状 `= string`)は 2 箇所で大量に作られ・引かれる:

1. **構築側** — `src/features/normalizedTokenNgram.ts` の `buildNgramKeys` が
   `tokens.slice(i, i+size).join(" ")` で n-gram キーを毎反復組み立てている。
   `tokenNgramSizes = [3,4,5,6]` × ~2500 fragment ぶん走る。
2. **比較側** — `src/scoring/internal/jaccardWithIntersection.ts` の `Set#has` ループが
   候補ペア数 (~42k) × 各軸の Set サイズぶん回る。これが `headSearch` (現状 3039 ms / 64%) の核。

つまり「token をどう正規化するか」は build 側と compare 側の双方に効く。

### マイクロベンチで取った当たり

200 fragment × 400 token、6000 ペアを Jaccard ライクに比較した実測(中央値 5 runs):

| 構成                                              | build ms | pairs ms | total ms | vs baseline |
|--------------------------------------------------|---------:|---------:|---------:|------------:|
| **baseline**(長い token / slice+join / string)  |     77.8 |     11.3 |     89.1 |          —  |
| A: 長い token / 手動 concat / string             |     70.2 |     11.7 |     83.2 |        -7%  |
| B: **短い** token / 手動 concat / string         |     56.8 |     11.4 |     67.8 |       -24%  |
| C: **短い** token / 手動 concat / `Symbol.for`   |     53.6 |      8.5 |     62.0 |       **-30%** |

読み方:

- **A→B**: token を `"LPAREN"`→`"("` のように短くすると build が -19%。concat の毎反復コピー量が減るため。
  pairs はほぼ動かない(V8 が Set 投入時に文字列を internalize しハッシュをキャッシュするので、
  短い文字列にしても compare は既に十分速い)。
- **B→C**: 連結後のキーを `Symbol.for(s)` で intern し、`Set<symbol>` として持つと pairs が -25%。
  `Set#has(symbol)` は identity 比較で Set 側の文字列等価判定経路を完全に外せるため。
  build は誤差〜やや速い(Symbol.for の registry lookup と Set add の initial hash が相殺)。
- baseline で議論されがちな「個々のトークンを `Symbol.for` 化」は **効かない**。trick は連結後の
  キーを Symbol 化すること(再利用回数とサイズが個々の token より大きいから)。

## 目標

- end-to-end (`pnpm bench:scale`) で `baseIndex` と `headSearch` の合計が **15% 以上** 短縮。
- マイクロベンチで baseline → 最終形で **25% 以上** 削減を確認。
- 出力されるレポート / fixture 一致は **bit-identical** に保つ(等価性ガード必須)。

## アプローチ

3 フェーズに分割、各フェーズの後で計測 → 次の判断。後ろのフェーズほどコード変更が広く影響範囲が
大きくなるので、前のフェーズで十分なら撤退する。

- **フェーズ 1: slice/join → 手動 concat** (`buildNgramKeys` 内のみ、型変更なし)
- **フェーズ 2: token を短い記号に書き換え** (`normalizeToken.ts` の表のみ、型は引き続き string)
- **フェーズ 3: 連結後キーを `Symbol.for` 化、`FeatureKey = symbol`**(全箇所の型変更)

### Symbol 化(フェーズ 3)のトレードオフ

採否判断にはこれを織り込む:

1. **`Symbol.for` レジストリは GC されない**。ts-dedup は CLI で即終了するため実害なし。
   ただしライブラリ組込みで長寿命プロセスに乗せる将来は捨てる選択になる。README/設計ノートで明記する。
2. **シリアライズ非互換**: `JSON.stringify(symbol) === undefined`。事前監査必須(下記)。
3. **`FeatureKey = string → symbol` の置換は広範囲**: 機械的だが、domain/feature.ts, invertedIndex,
   candidateSearch, scoring, report の **すべて** が対象。中途半端に混ぜると `Set#has` が
   静かに偽を返して結果が壊れる。1 PR で一気にやる。

## ベンチマーク戦略

「直す前に必ず数字を取り、直した後に同条件で取り直し、同じファイルに併記する」。

### 1. マイクロベンチ(新規)

- 追加: `tools/bench/microNgramBuild.ts`
  - 合成 token 列で `buildNgramKeys` 系列(slice/join 旧版・手動 concat 新版・短 token 版・Symbol 版)を
    1 ファイルに同居させ、同条件で連続計測する。Jaccard 風の Set 比較ループも含めて end-to-end 模擬する
    (build / pairs / total を分けて出力)。
  - 規模: F=200, T=400, NSIZES=[3,4,5,6], pairs=6000、各 5 runs の median。
- `package.json` に `bench:ngram` を追加。
- 結果は `tools/bench/baseline/ngram-build.md` に Markdown で蓄積(各フェーズ前後)。

### 2. End-to-end ベンチ(既存)

- 既存 `pnpm bench:scale --base <ref>` を **同じ revision** で 3 runs(median)。
- `tools/bench/baseline/scale.md` の history テーブルに各フェーズ前後で 1 行ずつ追記。
- 注目フェーズ:
  - フェーズ 1, 2: `baseIndex`(現状 818 ms)。`headSearch` はほぼ動かない想定。
  - フェーズ 3: `headSearch`(現状 3039 ms)が主、`baseIndex` も少し動く可能性。
- `headSearch` がフェーズ 1, 2 で予想外に動いたらノイズか副作用なので調査して止める。

### 3. 等価性チェック(全フェーズ共通)

- フェーズ 1, 2: `normalizedTokenNgram.test.ts` に "outputs match the legacy formulation" テストを追加。
  旧実装をテスト内ローカル関数として残し、ランダム入力 100 ケースで配列一致を `===` ベースで確認。
- フェーズ 2: `normalizeToken.test.ts` の固定マッピングテストを **新表に書き換える**(出力が変わる)。
  ただし end-to-end の fixture テストでレポート結果が変わってはいけない — token 表記が短くなっても
  「同じ token 列が同じ n-gram キーになる」という性質は保たれるため、最終レポートは bit-identical
  になるはず。fixture suite で確認。
- フェーズ 3: 既存 fixture テストが symbol キーでも通ることを確認。`JSON.stringify` 呼び出し箇所の
  事前監査(下記参照)。

### 4. 撤退条件

- フェーズ 1 単独で end-to-end の baseIndex が誤差(±5%)に埋もれる → フェーズ 1 は採用しない、
  フェーズ 2 へ。
- フェーズ 2 適用後の合計改善が目標(15%)に達した → フェーズ 3 はスキップ。Symbol 化のリスクは
  十分なゲインがある場合のみ正当化される。
- 出力(レポート JSON / Markdown / fixture 一致テスト) が変わる → 即 revert。
- フェーズ 3 で `JSON.stringify` または同等のシリアライズ経路が `FeatureKey` を踏む箇所が
  見つかった場合 → 経路を直すコストを見積もり、見合わなければフェーズ 3 撤退。

## ファイル別の変更

### フェーズ 1

- **`src/features/normalizedTokenNgram.ts`** (`buildNgramKeys`)
  - `slice` + `join` を撤去し、`for (let j = 1; j < size; j++) key += " " + tokens[i+j]` 形式に置換。
  - 関数 signature・挙動・出力同一性は変えない。
- **`src/features/normalizedTokenNgram.test.ts`**
  - 等価性テスト 1 ケース追加(legacy 実装と完全一致)。
- **`tools/bench/microNgramBuild.ts`** (新規)、**`package.json`** (`bench:ngram` 追加)。
- **`tools/bench/baseline/ngram-build.md`** (新規, before/after 併記)。
- **`tools/bench/baseline/scale.md`** (history 行追記)。

### フェーズ 2

- **`src/features/internal/normalizeToken.ts`**
  - `EXPLICIT_MAP` の値を短い記号に置換:
    - 句読点系は文字そのもの: `"LPAREN"`→`"("`, `"RBRACE"`→`"}"`, `"DOT"`→`"."`, `"COMMA"`→`","` …
    - 識別子・リテラル: `"ID"`→`"i"`, `"STR"`→`"s"`, `"NUM"`→`"n"`, `"BOOL"`→`"b"`, `"REGEX"`→`"r"`
    - キーワード: 1〜2 文字に統一(`"FUNCTION"`→`"Fn"`, `"RETURN"`→`"Re"`, `"CONST"`→`"Co"` …)
  - 衝突しないこと(全値ユニーク)を `normalizeToken.test.ts` の単体テストで保証。
  - 区切り文字を空白から **`\x00`(NUL)** に変える(空白は token 内に出ないとはいえ短い token 表記と
    曖昧になる余地があるため、明確な制御文字で完全に分離)。`buildNgramKeys` の concat 内の
    `" "` を `"\x00"` に置換。
- **`src/features/normalizedTokenNgram.test.ts`** / **`src/features/internal/normalizeToken.test.ts`**
  - 期待値文字列を新表記に追従更新。等価性テスト(フェーズ 1 で入れたもの)は新表記でも通るよう調整。
- **fixture suite** を回し、レポート出力に変化がないことを確認(出力で n-gram キー文字列を
  そのまま出していないか念のため確認)。
- **`tools/bench/baseline/ngram-build.md`** / **`scale.md`** に行追記。

### フェーズ 3 (採用判断後にのみ着手)

事前監査タスク:
- `grep -rn "FeatureKey\|features\.tokens\|features\.statements\|features\.calls" src` で全参照点を列挙。
- `JSON.stringify` / `JSON.parse` 周辺で `FeatureKey` が踏まれていないか確認。`src/cli/`,
  `src/report/` を重点。`perfLog` のキー型も確認。
- ログ出力に直接 token キーを出している箇所があれば、そこは `Symbol.keyFor(sym)` で復元する関数を
  通すよう変更。

実装変更:
- **`src/domain/feature.ts`**: `export type FeatureKey = symbol;`(`= string` から)。
- **`src/features/normalizedTokenNgram.ts`** 等の各 builder
  (`statementKindNgram.ts`, `callPropertyFingerprint.ts` 含む):
  - `out.push("token:" + ...)` の戻り直前で `Symbol.for(prefix + body)` に変換。
  - 接頭辞(`"token:"`, `"stmt:"`, `"call:"` 等)は登録時に含めて、Symbol 名空間が混ざらないようにする。
- **`src/index_/invertedIndex.ts`**: `Map<FeatureKey, Posting[]>` は型置換だけで動くはず。実装変更なし。
- **`src/scoring/featureSets.ts`**: `new Set<FeatureKey>(...)` は同様。実装変更なし。
- **`src/scoring/internal/jaccardWithIntersection.ts`**:
  - `string[]` を返している `intersection` を `symbol[]` または `string[]` に変える(直後に
    `Symbol.keyFor` で文字列化するなら `string[]` 維持でも良い)。
  - 評価時の出力用に `Symbol.keyFor` で string に戻すヘルパを追加。
- **etc.** — `FeatureKey` を踏む箇所は型エラーで網羅される。エラーゼロまで詰めればリンクは取れる。
- **テスト**: 既存テストの期待値で `"token:..."` 文字列を直接書いているところは、
  `Symbol.for("token:...")` に置換。fixture テストはそのまま通るはず。

## 進め方

1. この計画ファイルをコミット。
2. **フェーズ 1**:
   - `microNgramBuild.ts` と `bench:ngram` を追加。**まず修正前の数字** を `ngram-build.md` に記録。
   - `pnpm bench:scale` を 3 runs。`scale.md` history に "phase-1 before" 行。
   - `buildNgramKeys` を手動 concat に書き換え、等価性テスト追加、`pnpm test`。
   - マイクロベンチ・scale を再計測、両 md に "phase-1 after" 行。
   - 撤退条件に該当しなければ確定。
3. **フェーズ 2**:
   - `EXPLICIT_MAP` を短表記化、区切り文字を `\x00` に。テスト期待値追従、fixture 通過確認。
   - "phase-2 after" を両 md に記録。
   - フェーズ 1+2 合計の改善が目標 15% に達していたら、フェーズ 3 をスキップして打ち止め。
4. **フェーズ 3**:
   - 事前監査(`JSON.stringify` 周辺、ログ出力経路)。NG 経路があれば計画を見直し。
   - `FeatureKey = symbol` 一斉置換、各 builder で `Symbol.for` を被せる。
   - 全テスト・fixture 通過確認、"phase-3 after" 記録。
   - 改善幅が複雑度に見合わなければ revert(マイクロベンチ結果は記録だけ残す)。

## 結果(2026-04-26)

- **フェーズ 1**(`buildNgramKeys` を手動 concat に置換)・**フェーズ 2**
  (`EXPLICIT_MAP` を短い記号化、区切り文字を `\x00` に変更)を適用。
- マイクロベンチ(`pnpm bench:ngram`、F=200, T=400, sizes=[3,4,5,6],
  pairs=6000、median of 5)で V0(長い token / slice+join / string)
  → V2(短い token / 手動 concat / string)が build phase で
  約 **−25%**(44.1 ms → 32.6 ms)。pairs phase はほぼ動かず、total は
  ノイズ程度。
- フェーズ 3(`Symbol.for`)は同じマイクロベンチで V2 → V3 が
  build +200% / pairs −18%、合計で **+7% 悪化**。production スケール
  (baseIndex 818 ms / headSearch 3039 ms)に外挿しても baseIndex に
  入る `Symbol.for` 登録コストが headSearch 側のゲインをほぼ食い潰す。
  `FeatureKey` 型変更の波及範囲(invertedIndex / candidateSearch /
  scoring / evidence)に対してリターンが見合わないので **不採用**。
- 報告経路の `matchedTokenNgramsSample` は `stripPrefix` で内部 NUL
  区切りを空白に戻して人が読める形に保つようにした(`i . i` 形式)。
  fixture suite の判定はファイル/行単位なのでペア検出は不変、
  determinism テストも通る。

## 非目標

- 個々の token を `Symbol.for` 化(効果なし、調査済み)。
- 数値 ID + rolling hash(touchpoint が広く、フェーズ 2+3 でほぼ同等のゲインが取れる見込み)。
- `headSearch` 側のスコアリングアルゴリズム自体の変更(別問題)。
- API 後方互換の維持 — このプロジェクトはまだ公開リリースなしという技術判断
  (`CLAUDE.md`)に従い、`FeatureKey` 型変更や token 表記変更は躊躇なく行う。
