# 1. パイプライン概観

ts-dedup は単方向のパイプラインで動く。PR モードと Whole-repo モードでフロントエンドが異なるが、後段の **特徴量抽出 → 索引 → 候補検索 → 再スコア → レポート** は共通である。

## PR モード

```
diff 取得 → base 側ソース列挙 → base 索引構築 → 変更 fragment 抽出
        → 各変更 fragment ごとに候補検索 → 候補ペア再スコア → レポート生成
```

実装は `src/cli/runDetector.ts`。

- **Diff Collector**: `git diff baseSha..headSha` をパースし、変更があった `.ts` / `.tsx` ファイルだけ残す。除外グロブにマッチするファイルや、削除のみの hunk しか持たないファイルは落とす。
- **Base 索引**: `git show baseSha:path` で取得した base 側ソースをパースし、すべての fragment と特徴量を抽出して転置索引に積む。索引は PR 実行時にメモリ上で構築するだけで、永続化しない。
- **変更 fragment 抽出**: head 側ソースから抽出した全 fragment のうち、いずれかの hunk と行範囲が交差するものを残す。「最小包含」のような追加フィルタはかけない (高 recall 優先)。
- **再スコア & レポート**: 各候補ペアに対して 4 軸スコアを計算し、閾値判定をクリアしたペアだけ収集する。後処理 (重複落とし・崩し落とし・ソート) ののち、`changedFragment.id` で **クローン群 (`CloneGroup`)** に集約して JSON / Markdown 形式で出力する。レポートの最終単位は群 (anchor + N members) であり、ペアではない (§7.5)。

## Whole-repo モード

base / head の区別がなく、単一の ref から取得した全 fragment を「クエリ側 = 索引側」両方として扱う。実装は `src/cli/runWholeRepoDetector.ts`。

- 各 fragment ごとに `searchCandidates` を呼び、自分以外の候補を集める。
- ペア `(a, b)` と `(b, a)` の重複は **lex で小さい id を先に置いた canonical key** で 1 回だけ処理する。
- `pr.baseSha` / `pr.headSha` には同じ ref の sha が入る。これでスキーマ上は PR モードと同形を保つ。
- レポート段では PR モードの `changedFragment.id` pivot ではなく、ペア集合をエッジ・fragment をノードとする無向グラフに変換 → 連結成分 → 密度ゲート / quasi-clique 抽出 → 群内 cross-granularity collapse、で **クローン群** に集約する (§7.6)。`{A, B, C}` のような三つ組は 1 群として 1 度だけ報告される。

## 設計上の不変条件

- 各段階は純関数化されており、入力 (ソース、設定、ref) が同じなら出力も bit-identical になる (詳しくは §8)。
- 各段階の責務が独立しているため、フラグメント定義の追加や特徴量系統の追加は他段階に波及しない。

