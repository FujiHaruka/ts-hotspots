# 3. 特徴量抽出

各 fragment から 3 系統の **feature key** を抽出する。実装は `src/features/`。

すべての key には系統プリフィクス (`token:`, `statement:`, `call:`) が付く。これにより 1 つの転置索引で 3 系統を区別なく扱える。

## 3.1 正規化トークン n-gram (`token:`)

実装は `normalizedTokenNgram.ts`。

1. fragment の文字範囲を `ts.Scanner` で走査する。
2. **型注釈の除去**: あらかじめソース全体の `TypeNode` の範囲を集めておき、その範囲内のトークンは捨てる。型導入の `:` (例: `x: Foo` の `:`) も別途除去する。
3. **正規表現の再スキャン**: スキャナはデフォルトでは `/foo/` を `/` `foo` `/` に分けてしまう。事前に正規表現リテラルの位置を AST から集めておき、該当位置の `/` トークンが出たら `reScanSlashToken` で再解釈し、単一の `REGEX` トークンを emit する。
4. **正規化マップ** (`normalizeToken.ts`):
   - 識別子 → `ID`
   - 文字列 / テンプレート文字列の各部 → `STR`
   - 数値 / BigInt → `NUM`
   - true/false → `BOOL`、null → `NULL`
   - キーワード・記号は短い大文字記号 (`IF`, `RETURN`, `LBRACE`, `EQEQEQ` …) に写す
   - 未知の `SyntaxKind` は `ts.SyntaxKind[kind]` のフォールバック名にする (TS の API 進化に対し決定性を保つため)
5. 設定の `tokenNgramSizes` (デフォルト `[3, 4, 5, 6]`) で各 n について隣接 n 個を `" "` で連結し、`token:<tok> <tok> ...` を emit する。
6. **bag semantics**: 同じ n-gram が複数回現れたら複数回 push する。索引側はキー単位で重複排除するが、後段スコアの set 化前にはこのまま保持される。

設計意図: 識別子・リテラルを正規化することで、変数名やリテラル値を変えただけのコピーをひとつのキーに収束させ、Type-3 重複として拾えるようにする。一方で型注釈は意図的に落としており、「同じロジックで型だけ違う」コードも一致させる。

## 3.2 文種別 n-gram (`statement:`)

実装は `statementKindNgram.ts`。

1. fragment が含む **直下の文** の `SyntaxKind` だけを並べる。例: 関数なら関数本体 Block の `statements`、`if` なら then/else 各分岐の文を連結したもの。`locateFragmentNode.ts` の `collectDirectStatements` がこれを担う。
2. ネストした構造 (内側の `if`、内側の関数等) は **1 要素** として扱う。例えば外側の if の `else` 内に `if` があった場合、外側から見るとそれは `IfStatement` 1 要素。内側の if は別 fragment として独立に索引されるので、信号は重複しない。
3. `statementNgramSizes` (デフォルト `[2, 3, 4, 5]`) で各 n について `<kind>|<kind>|...` を `statement:` プレフィクスで emit する。

設計意図: トークンレベルでは似ていなくても、「if → for → return の順番」のような **制御構造の並び** が一致するパターンを拾う。識別子差異への耐性が最も高い軸。

## 3.3 呼び出し / プロパティ指紋 (`call:`)

実装は `callPropertyFingerprint.ts`。

fragment の AST 部分木を再帰的に歩き、以下の形で 1 ノード = 1 key を emit する:

| AST ノード | 出力 key | 例 |
|---|---|---|
| `CallExpression` (識別子 callee) | `call:CALL:<name>` | `foo()` → `call:CALL:foo` |
| `CallExpression` (メソッド呼び) | `call:CALL:<leftmost>.<finalName>` | `a.b.c()` → `call:CALL:a.c` |
| 上記が `await` の中 | `call:AWAIT_CALL:...` | `await client.get()` → `call:AWAIT_CALL:client.get` |
| `NewExpression` | `call:NEW:<name>` | `new UserRepo()` → `call:NEW:UserRepo` |
| `PropertyAccessExpression` (callee 以外) | `call:PROP:<leftmost>.<name>` | `response.status` (read) → `call:PROP:response.status` |
| `ElementAccess` 文字列キー | `call:PROP:<leftmost>.<key>` | `obj["x"]` → `call:PROP:obj.x` |
| `ElementAccess` 動的キー | `call:PROP:<leftmost>.*` | `obj[i]` → `call:PROP:obj.*` |
| `this` / `super` の callee | `call:CALL:this` / `call:CALL:super` | |
| 解析不能な複雑式 | `call:CALL:*` | shape は残し中身は伏せる |

実装のポイント:

- **callee の二重カウント回避**: 呼び出しの直接 callee となるプロパティアクセス (`a.b()` の `a.b` 部分) は `subjects` セットに登録し、PROP key としては再 emit しない。これが無いと 1 メソッド呼び出しが CALL と PROP の両方を発火してしまう。
- **transparent wrapper の解除**: `(expr)`, `expr!`, `expr as T`, `expr satisfies T`, `<T>expr` は通り抜ける。`await (client.get())` でも awaited として扱う。
- **leftmost identifier**: ロングチェーン (`a.b.c.d.e()`) は `a` (左端の識別子) と `e` (右端のメソッド名) の組だけ取り出す。途中のプロパティ名はノイズが多いので捨てる。

設計意図: 呼び出し先 / プロパティ名は **意味量が高く正規化したくない** ので識別子トークン正規化とは別枠。同じ API を使っている = 同じ振る舞いをしている可能性が高い、という強い信号として扱う。

## 3 系統の独立性

3 系統は互いに独立に作られ (`extractFeatures.ts`)、`config.features.enabled` で個別に on/off できる。off にした系統は索引にも入らないし、スコア式でも重みが除外される (§5)。
