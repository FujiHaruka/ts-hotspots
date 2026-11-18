# 4. 転置索引と候補検索

## 4.1 転置索引

実装は `src/duplication/lookup/invertedIndex.ts`。

データ構造は `Map<FeatureKey, Fragment[]>`。posting は base 側 `Fragment` への参照そのもので、posting ごとのオブジェクトは作らない。

構築規則:

- 入力は base 側の `(fragment, features)` ペアの配列。
- 同じ `(featureKey, fragmentId)` は 1 度だけ posting に積む。1 fragment のキーは連続して投入されるので、posting 列の末尾の fragment id と比べるだけで重複排除できる。
- 特徴キー文字列は base index 構築時に intern 済み (`features/internFeatureKeys.ts`)。同じキーは 1 つの文字列インスタンスを共有する。
- これにより索引は **「どのキーがどの fragment に出現するか」** だけを答え、bag multiplicity は持たない。Jaccard ベースのスコアは bag を必要としないため十分。

挿入順は入力順 = 走査順 = 決定的。

## 4.2 候補検索

実装は `src/search/candidateSearch.ts`。

クエリ fragment ひとつに対する処理:

1. クエリ側の 3 系統 (token / statement / call) を **それぞれユニーク化** する (key の重複は 1 ヒットとして数える)。
2. 各キーで索引を引き、posting を fragment 単位で集約する。同じ base fragment id に対して `{ token, statement, call }` のヒット数を足し合わせ、`hitCounts` を作る。
3. **自己マッチ除外**: `posting.id === changedFragmentId` のものは捨てる (Whole-repo モード)。
4. **同一ファイル × 行範囲重なり除外**: `posting.filePath === changedFragment.filePath` かつ
   `[posting.startLine, posting.endLine]` と `[changedFragment.startLine, changedFragment.endLine]` が
   1 行でも交わる場合は捨てる。fragmentation で同じファイルから function / block / window を多粒度に
   切り出しているため、行範囲が交わる pair は同じ region を別の切り出しで比較しているだけで
   "クローン" として無意味な signal にしかならない。同一ファイルでも非重複ペア (隣接する 2 関数など)
   は通す。
   PR モードでは変更 fragment は head 側、posting は base 側の行番号を持つので、比較の前に変更 fragment の
   行範囲を diff の hunk で base 側の座標に写す (`src/diff/lineMap.ts`)。変更されていない行は上の hunk の
   増減ぶんずらし、hunk 内の行はその hunk の base 側範囲に、純粋な挿入は挿入位置の隙間に写す。
   リネームされたファイルは旧パスを base 側のファイルとして扱う。これにより、上に行が挿入されて位置が
   ずれた関数が自分の変更前の版とマッチすることも、たまたま同じ行番号にある無関係な base 側コードが
   除外されることもない。この場合 3. の id 一致による除外は使わない。
5. **OR 集合**: いずれか 1 系統でも 1 件でもヒットすれば候補に入る。これが要求仕様 §4.5 の「複数特徴系統の OR」に対応する。
6. **決定的ソート**:
   - `hitCounts.token + statement + call` の合計降順
   - 系統別 (token → statement → call) の降順
   - `baseFragmentId` の昇順
7. `config.search.maxCandidatesPerFragment` (デフォルト 100) で上限切り。

注意点:

- `hitCounts` は **クエリ側のユニーク key 数** を数えており、bag multiplicity ではない。したがって「同じ key を 5 回使った」という頻度情報はこの段階で消える。後段の Jaccard も set ベースなので、頻度信号は v1 ではどこにも生かしていない。
- ヒット数はあくまで「索引引きで何キー一致したか」であり、後段の総合スコアとは目的が違う (候補絞り込みの優先順位付けと、上限超え時の選別)。最終スコアは §5 の Jaccard で改めて計算する。

## 4.3 candidate truncation の影響

`maxCandidatesPerFragment` を超えると下位を切り捨てるため、recall が下がる可能性はある。デフォルト 100 はかなり広めに取っており、典型的な PR では切り捨てがほぼ発生しない想定。極端に多重度の高い fragment (テンプレート化された定型コードなど) でのみ効く。
