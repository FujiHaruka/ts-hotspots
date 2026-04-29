# 8. 決定性と Whole-repo モード

## 8.1 決定性の保証

要求仕様 §5.2 の通り、同一入力には bit-identical なレポートを返す。これを担保するための仕掛けは各段階に分散している:

| 段階 | 決定性の根拠 |
|---|---|
| ソース取得 | `git show <sha>:<path>`。ワーキングツリーは見ない |
| diff 出力 | `git diff` の出力 + ファイルパス昇順ソート |
| fragment 抽出 | `ts.forEachChild` の走査順 + `FragmentIdAllocator` の id 採番 |
| 特徴量抽出 | 走査順依存だが入力 AST が同じなら同じ |
| 索引構築 | `Map` の挿入順 = 入力順 |
| 候補検索 | `hitCounts` 集計後に明示ソート (§4.2 step 5) |
| Jaccard / 交差 | 交差キーは昇順ソート |
| 後処理 | 各ステップで明示ソート (§7) |
| 群集約 (PR) | `changedFragment.id` でグルーピング後、明示ソート (§7.5) |
| 群集約 (Whole-repo) | グラフ構築・BFS・quasi-clique 抽出のすべてが入力ペアの追加順 / fragmentId 昇順で確定 (§7.6) |

`Map` / `Set` の反復順は ECMAScript で挿入順と決まっているため、純粋に入力順だけで決まるパイプラインなら出力も決定的になる。

## 8.2 Whole-repo モード

実装は `src/cli/runWholeRepoDetector.ts`。

PR モードとの違いは入口だけ。指定 ref のソースを全部読んで全部 fragment 化し、**索引側 = クエリ側** とする。

### 重複ペアの正規化

任意の 2 fragment `a, b` について `searchCandidates(a, ...)` の結果に `b` が、`searchCandidates(b, ...)` の結果に `a` が現れる。両方そのまま処理するとレポートに同じクローンが 2 度載るので:

- canonical key = `${min(idA, idB)}|${max(idA, idB)}`
- すでに見たキーは早期 continue

この canonical 化で `(a, b)` と `(b, a)` のどちらが先に来ても出力は同じ。

### anchor / member スロット

レポートは `anchor` (1 件 / optional) と `members` (N 件) を持つ群 (`CloneGroup`) を出力単位とする。Whole-repo モードでは方向の意味が無いため `anchor` を `undefined` とし、クラスタ内の全 fragment を `members` (fragmentId 昇順) に並べる。クラスタ抽出 (§7.6) は入力ペアの順序と fragmentId をすべての分岐で参照するので、同じ入力に対して同じクラスタ集合が同じ順番で得られる。

### sha の扱い

`pr.baseSha` と `pr.headSha` の両方に同じ ref の sha を入れる。スキーマ消費側を変えずに、両者が等しいことが「diff を介さない 1 ref のスキャン」を表す。

## 8.3 同一性の検証

E2E テストが実装の決定性を直接的に保証する。`runDetector` を 2 度呼び出して JSON 出力が完全一致することをチェックしており、Map/Set の挿入順依存や走査順依存が入った場合にここで落ちる。
