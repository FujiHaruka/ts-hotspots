# 同一ファイル内重なりを candidate 段で除外する

## 背景

`docs/eval/eval-vs-jscpd.md` の評価で、ts-dedup の whole-repo 上位 10 件の rank 10
(`client-helpers.ts:82-172` ↔ `:138-224`) は同一ファイル内で **35 行重なるスライディング window 同士**
だった。同一ファイルかつ行範囲が交わる pair は構造的に「自分自身を含む region と少しずれた region の比較」
であり、両側の特徴量集合には重なり区間のトークン / statement / call が同じ寄与をしてしまう。
結果、score は人工的に膨らみ "クローン検出" として無意味な signal を出す。

現状 `src/report/dropSameFileOverlap.ts` が post-score で `max(Jaccard, containment) >= 0.5` を境に落としている
が、上記ペアは max ≈ 0.40 で生き残る。閾値を上げれば狙えるが、そもそもこのペアは候補として不適 ──
重なる行が 1 行でもあれば落とす方が説明可能性が高い。

加えて、post-score で落としているということは **scoring の CPU を無駄に使っている**。同一ファイル重なりは
候補集計 (`searchCandidates`) の段で `Posting.filePath / startLine / endLine` から確定的に判定できるので、
そこで打ち切れば scoring を呼ばずに済む。

## Approach

**`searchCandidates` の `tally` 内で「自己マッチ除外」と同じ場所に「同一ファイル × 行範囲重なり」の
skip を追加する。** 検索時に重なりペアを `hits` Map に乗せないことで、scoring・report 双方の下流から
このノイズが消える。`Posting` に既に必要な情報 (`filePath / startLine / endLine`) があり、
新規に index 構造を変える必要もない。

具体的に:

1. `tally` の per-posting ループに skip 条件を追加:
   - `posting.fragmentId === changedFragment.id` (既存) **または**
   - `posting.filePath === changedFragment.filePath` かつ
     `[posting.startLine, posting.endLine]` と
     `[changedFragment.startLine, changedFragment.endLine]` が **1 行でも交わる**

   なら `continue`。

2. `tally` のシグネチャを `changedFragmentId: string` から `changed: { id, filePath, startLine, endLine }`
   に拡張し、呼び出し元 (`searchCandidates`) で 1 回構築して 3 軸ぶん使い回す。

3. 後段の `dropSameFileOverlap` (post-score フィルタ) は **削除**。検索段で既に消えているので冗長。
   関連テスト・export も併せて掃除する (CLAUDE.md: ignore backward compatibility に従い、
   非推奨化や移行パスは作らない)。

4. **同一ファイル・非重複ペア (例: 同じファイル内の隣接する 2 関数) は引き続き候補として残す**。
   これは「ファイル内の実クローン」を拾うために必要。

## 判定ロジック

```
overlaps(a, b) := a.endLine >= b.startLine && b.endLine >= a.startLine
```

`a.endLine === b.startLine` (1 行ぶんだけ接する) も重なりとして扱う ── 行ベースの fragment 範囲は
通常 `endLine` を含む半閉区間として解釈されている (`fragmentLineCount` も `+1`) ので、touch を重なりに
含めるのが整合的。

## 変更ファイル

### 変更

- `src/search/candidateSearch.ts`
  - `tally` シグネチャ変更 (`changedFragmentId` → `changed: { id, filePath, startLine, endLine }`)。
  - skip 条件に同一ファイル重なりを追加。
  - `searchCandidates` 側で `changed` オブジェクトを 1 回作って渡す (3 軸ぶん共有)。
- `src/search/candidateSearch.test.ts`
  - 同一ファイル重なりが結果から消えるテストを追加 (詳細は下記)。
  - 既存の同一 fragmentId スキップが回帰しないことの確認は維持。
- `src/report/jsonReport.ts`
  - `dropSameFileOverlap` の import / パイプライン呼び出しを削除。
  - `perfLog.emit("report.summary", ...)` から `dropSameFileOverlap` カウンタを削除。
- `src/report/jsonReport.test.ts`
  - `dropSameFileOverlap` 経由の挙動を期待していたテストがあれば、検索段で消える前提に書き換える。
    (該当しない場合は変更不要。)
- `src/report/index.ts`
  - もし `dropSameFileOverlap` を re-export していたら削除 (現状の index.ts には無いはず)。

### 削除

- `src/report/dropSameFileOverlap.ts`
- `src/report/dropSameFileOverlap.test.ts`

### perfLog の取り扱い

`SearchStats` に skip 件数のカウンタを増やす案も考えたが、**今回は増やさない**。理由:
- 自己マッチ skip もカウントしていないので、整合性のため両方カウンタ化するならスコープが広がる。
- 同一ファイル重なりは "そもそも候補にしない" 設計判断であり、可観測性より明瞭さを優先。
- 必要になれば後続で `searchSkipBreakdown` を別計画で足す。

## テスト

### `candidateSearch.test.ts` 追加ケース

| # | シナリオ | 期待 |
| --- | --- | --- |
| 1 | 同一 filePath、行範囲が完全に交わらない (隣接する 2 関数) | candidate に含まれる |
| 2 | 同一 filePath、`a.endLine === b.startLine` (1 行接する) | candidate **から除かれる** |
| 3 | 同一 filePath、片方が他方を完全に包含 (関数 vs 内部 window) | 候補から除かれる |
| 4 | 同一 filePath、35 行重なり (rank 10 相当) | 候補から除かれる |
| 5 | 異なる filePath、行範囲はたまたま重なる | candidate に含まれる (filePath が違うので無関係) |
| 6 | 同一 fragmentId (= 自己) | 既存どおり除かれる |
| 7 | 重なりにより `hits` が空になる場合 | `searchCandidates` は `[]` を返す (既存の `hits.size === 0` 早期 return が効く) |
| 8 | top-K min-heap 経路 (`preCapSize > max`) でも skip が効く | heap への投入前に弾かれる |

### `jsonReport.test.ts` の確認

- 同一ファイル重なりの fixture を直接 `buildJsonReport` に投入したテストがあれば、現在は
  `dropSameFileOverlap` で落ちているはず。今回 `dropSameFileOverlap` を削除するため、
  - そのテストが「`buildJsonReport` 単体での dedup 動作」を主張しているなら、上流 (search) で
    弾かれる前提に書き換えるか、テストを `candidateSearch` 側に移す。
  - すでに上流で弾かれる scenario になっているなら、テストはそのまま通る。

## 受け入れ基準

- [ ] 既存テスト + 追加テストが通る (`pnpm test`)。
- [ ] `pnpm typecheck` / `pnpm lint` が通る。
- [ ] `private-eval-repo` での再評価で:
  - rank 10 の `client-helpers.ts:82-172 ↔ :138-224` が消える。
  - 既存の TP (rank 1, 2, 11–16 など) は順位が上がる方向で残る。
- [ ] whole-repo モードの `candidatePairs` / `reportedPairs` カウンタが減少する (perfLog で確認)。
  - 数値は記録するだけで OK (回帰閾値は設けない)。

## 想定リスク

- **`a.endLine === b.startLine` を重なりとみなすかどうか**: 上記ロジックでは touch を含める。
  既存の `dropSameFileOverlap` は `intersection = max(0, intersectionEnd - intersectionStart + 1)` で
  同様に touch を 1 行重なりとして扱っている (`intersectionStart === intersectionEnd` でも `+1`)。
  互換は意識しないが、定義を変えないことで mental model がブレない。
- **recall への影響**: 「重なる window pair でしか拾えない実クローン」は理論上ありうる
  (3 連続で同じ shape の関数があり、stride が短くて隣接 window が重なるケース)。ただし extractor は
  ファイル内に **重ならない window** も emit するので、その経路で別 pair として現れる可能性が高い。
  実害は eval 上では確認されていない。
- **post-score の保険を失う**: `dropSameFileOverlap` を削ると、何らかの理由で search 側を通り抜けた
  ケースが report に出る。が、検索段の skip は `Posting` の固定情報 (filePath / lines) のみで判定する
  純関数で、抜ける経路が無い。

## 非対象 (out of scope)

- **薄いラッパー検出による down-rank** (`thin-wrapper-filter.md`): 別計画。直交する。
- **同型クラスタの pairwise → 1 件 collapse**: 別計画。
- **window の stride / size の調整**: ノイズの根本対策ではなく、別軸の議論。
- **同一ファイル非重複ペアのさらなる扱い** (例: same-file riskFlag の自動 down-rank): 既存
  `recommendationHint` の `same-file` flag に任せる。
