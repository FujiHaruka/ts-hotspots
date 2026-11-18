# 2. フラグメント抽出

比較の基本単位は **fragment**。1 つのソースファイルから複数粒度で切り出される。実装は `src/indexer/extractFragments.ts`。

## 3 つの粒度

各 fragment は AST を `ts.forEachChild` で再帰走査しながら以下を発火する。出現順は走査順 = 決定的。

### function フラグメント
- 対象: `FunctionDeclaration` / `MethodDeclaration` / `ArrowFunction` / `FunctionExpression` / `Constructor` / `GetAccessor` / `SetAccessor`
- 本体 (`.body`) を持たないもの (ambient / abstract) は除外する。
- ネストする内側関数も別 fragment として発火する (外と内の特徴量を混ぜないため、両方を独立に索引する)。

### block フラグメント
- 対象: `if` / `for` / `for-in` / `for-of` / `while` / `do-while` / `try` / `catch` / `switch`
- 外側のブロックと内側のブロックを **両方** 発火する。

### window フラグメント (sliding window)
- 対象: `statements` 配列を持つコンテナ (`Block` / `ModuleBlock` / `CaseClause` / `DefaultClause`)
- ファイル直下 (`SourceFile`) の文は window にしない。ファイル直下の文は関数・クラス・定数などの宣言で、関数の本体はすでに function fragment として索引されている。宣言を 5〜10 個並べた window は数百行に膨らみ、§7.2 の collapse で最大の包含ペアが残るため、内側の関数単位の一致を 1 つの巨大なペアに吸収してしまう。
- 設定の `statementWindowSizes` (デフォルト `[5, 10, 20]`) と `statementWindowStride` (デフォルト 3) で複数のサイズと stride を指定し、文の連続部分を切り出す。
- **末尾フォールバック**: 各サイズについて、stride のリズムから外れて末尾の文が一度もウィンドウに含まれないことが起きないよう、最後尾を含むウィンドウを 1 つ追加で発火する。
- **短ブロックフォールバック**: 文数が最小ウィンドウサイズ未満なら、ブロック全体を 1 つの window として発火する (1 文のみのブロックはスキップ)。

## なぜ複数粒度を混在させるのか

関数全体の重複と、関数の途中の数行の重複は別の現象であり、どちらも検出対象にしたい。粒度を 1 つに固定すると、片方を逃す。粒度ごとに独立な fragment として索引することで、両方が候補として浮上する余地を作っている。

ただし副作用として、同一の論理コードが function / block / window として 3 重に索引されるため、レポート段で **崩し落とし** が必須になる (§7)。

## fragment id

`${filePath}#${startLine}-${endLine}-${kind}` を基本形とし、同じ行範囲・粒度の衝突 (同じ行に並ぶ複数のアロー関数等) は走査順に `-2`, `-3` ... の suffix を付ける。実装は `src/indexer/internal/fragmentId.ts`。これにより id は決定的かつ一意。
