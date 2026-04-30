# `ts-hotspots scan` 設計 RFC

> Status: Draft (M5)
> 目的: 段階2 で導入する `ts-hotspots scan` の挙動・スキーマ・デフォルトを決定する。
> 実装は行わない。決定後に M6 で実装する。

## 1. なぜ統合コマンドが必要か

段階1 で `ts-hotspots` (関数 hotspot) と `ts-hotspots dedup` (重複候補) は同じバイナリの 2 サブコマンドとして同居している。ただし出力は完全に別系統で、それぞれ独立した JSON / Markdown レポートを返す。

エージェントに「このリポジトリ、まずどこを読めばいい?」を委ねる場面では、両方の答えを揃えてからでないと判断できない:

- 関数の複雑度・churn が高い座標 (hotspot)
- 既存コードと重複している、あるいは PR が新たに重複を持ち込んだ座標 (dedup)

これを別々に走らせると、エージェント側で 2 つのレポートを同時に持ち、座標とスコア軸を自前で正規化し、dismissal も別系統で管理する負担が生まれる。`scan` の意義はこの「**統合された "気になる場所" のリスト**を 1 リクエスト・1 スキーマで返す」点にある。

副次的に得られるもの:

- CI 設定の単純化 (1 コマンド 1 出力)
- dismissal レジストリの統一 (M5 では論点として保留 — §8 参照)
- ユーザが最初に試すコマンドが 1 つに集約され、入口が単純になる

逆に統合しないでよい論拠も並べておく (採用判断は §3 で行う):

- hotspot は ts-morph + TypeChecker、dedup は git + typescript パーサ直叩きで、コスト構造がまったく違う。dedup whole-repo は数十秒〜分単位の重さがある一方、hotspot 単独は通常数秒で済む。常に両方走らせると軽い用途が遅くなる。
- 出力の自然な単位が違う (関数 ref vs. fragment 群)。同居スキーマで両方を素直に表現できるかは設計問題。

## 2. 想定ユースケース

`scan` が応えるべき主要ユースケースを 3 つ列挙する。各ケースは §6 で「スキーマ案で過不足なく応えられるか」を確認する基準として使う。

### UC1. エージェントへの初期コンテキスト投入

**シナリオ**: 開発者が「このリポジトリ、まずどこを読んでリファクタすべき?」をエージェントに尋ねる。`ts-hotspots scan | claude --permission-mode plan` のように直接パイプする。

**期待**: エージェントは両軸 (hotspot / dedup) を踏まえて「先に読むべき座標 N 件」を提案できる。重複の片方が hotspot にも入っているケースは、優先度が自然に上がるべき。

**運用**: ローカル / CLI 対話。dedup は whole-repo モード相当。実行時間は数秒〜数十秒を想定 (大きいリポジトリなら `--exclude` でチューニング)。

### UC2. PR レビュー時の CI レポート

**シナリオ**: PR 作成時に CI が `ts-hotspots scan --pr <revrange>` を走らせ、結果を PR コメントまたはアーティファクトとして残す。レビュアー / Copilot は変更行の周辺リスクを 1 画面で把握する。

**期待**: PR で新たに作り込まれた hotspot (複雑度の高い新関数 / 大きく書き換わった既存関数) と、PR 由来の重複候補 (head 側 fragment が base ツリーの何かと似ている) を同じレポートに並べて返す。

**運用**: `<revrange>` は GitHub Actions の `${{ github.event.pull_request.base.sha }}...${{ github.event.pull_request.head.sha }}` 相当を渡す想定。dedup は PR モード。hotspot 側は base / head どちらで計測するか決める必要がある (§4 で扱う)。

### UC3. 手動レビュー前 / 引き継ぎ時の repo オンボーディング

**シナリオ**: 新規担当者がコードベース全体を把握する前に「ホットゾーンと重複クラスタの地図」を 1 度だけ作る。出力は Markdown で人間にも読める形が望ましい。

**期待**: hotspot 上位 N 件と dedup 群上位 M 件が、ファイルごと・領域ごとに俯瞰できるレポートを返す。詳細は各候補から個別の「読むべき座標」を辿れる。

**運用**: 一度きりの実行で時間制約は緩い。dedup は whole-repo モード。`--format markdown` で人間向け、`--format json` で後処理用、両方を選べる必要がある。

## 3. 既存コマンドとの関係

3 つの選択肢を検討する。

| 案 | 概要 | 評価 |
|---|---|---|
| A | `scan` は alias。中身は既存 2 コマンドを順に呼んで報告層で結合する | 実装コストは小さいが、両者の出力は別系統スキーマで整合性が取りにくい |
| B | `scan` を第一級の新コマンドにし、既存の `ts-hotspots [path]` / `ts-hotspots dedup` は残す | 入口を `scan` に集約しつつ、既存の用途 (片側だけ走らせたい) も壊さない |
| C | `scan` 導入とともに既存 2 コマンドを deprecate。今後は `scan --only hotspots` / `scan --only dedup` で代替する | API 表面は最小化されるが、既存利用者 (CI スクリプト含む) を壊す |

**採用: 案 B**。

理由:

- 段階1 で既存コマンドのインターフェース・出力スキーマは安定済みで、これを破ることに見合うメリットがない。dogfooding 用の `dedup --whole-repo --phase-timings` のような細かい調整は `scan` 経由ではなく直接サブコマンドを叩く方が自然。
- `scan` は「両方を一発で取りたい」というユースケースに応えるための加算的な追加。減算 (既存削除) はしない。
- 将来 `scan` が安定したら、README の "Quick start" 推奨を `scan` に寄せていく形で穏やかに重心移動する。

つまり 0.x 系では:

```
ts-hotspots [path]                  既存。関数 hotspot だけが欲しいときの最短経路
ts-hotspots dedup [args...]         既存。重複検出だけが欲しいときの最短経路
ts-hotspots scan [args...]          新規。両方を 1 レポートで取りたいときの推奨経路
```

の 3 並列で運用する。

## 4. CLI シェイプとデフォルト挙動

### 4.1 シェイプ

```
ts-hotspots scan [path] [options]
```

`path` は `ts-hotspots [path]` と同じ意味 (省略時は cwd)。dedup の対象 git リポジトリは原則として `path` から解決する (tsconfig が置かれた階層からリポジトリルートを上方探索)。

主要オプション:

| オプション | 意味 | 既定 |
|---|---|---|
| `--pr <revrange>` | PR モード。dedup を PR モードで実行し、hotspot もこの diff を踏まえる (§8 で扱う) | unset |
| `--whole-repo` | リポジトリ全体を対象にする。`--pr` と排他 | unset |
| `--include-dedup` | whole-repo モードで dedup を有効にする | off |
| `--only <hotspots\|dedup>` | 片側だけ実行する | unset = 両方 |
| `--format <markdown\|json>` | 出力形式 | markdown |
| `--top <N>` | hotspot の top-N | 5 |
| `--limit <N\|all>` | dedup 群の上限 | 20 |
| `--exclude <glob...>` | 両軸に共通で適用するパス除外 | hotspot / dedup それぞれの既定 |
| `--no-code` | dedup レポートから fragment ソースを落とす | off (= ソース含む) |
| その他 | 既存サブコマンドの flag は名前衝突しない範囲で透過的に受け取る (例: `--metrics`, `--churn-window`, `--phase-timings`) | — |

### 4.2 デフォルト挙動 (どの組み合わせで何が走るか)

|  | hotspots | dedup |
|---|---|---|
| `scan` (引数なし) | ✓ (cwd) | × |
| `scan <path>` | ✓ | × |
| `scan --pr <range>` | ✓ (range 込み) | ✓ (PR モード) |
| `scan --whole-repo` | ✓ | × (`--include-dedup` で ✓) |
| `scan --whole-repo --include-dedup` | ✓ | ✓ (whole-repo モード) |
| `scan --only hotspots ...` | ✓ | × |
| `scan --only dedup --pr <range>` | × | ✓ (PR モード) |
| `scan --only dedup --whole-repo` | × | ✓ (whole-repo モード) |

設計上のキー判断:

- **既定では dedup を走らせない**。`scan` 単独は素早くフィードバックが返る形を保ち、dedup の起動コストを払う場面を明示にする。
- **PR モードでは dedup を既定で含める**。PR モードでの dedup は「変更 fragment だけを検索側に回す」ので whole-repo に比べて軽く、UC2 が一次目的なら同居させる方が自然。
- **whole-repo dedup は明示 opt-in**。UC1 / UC3 のいずれも `--include-dedup` を意識して付ける場面と判断する。
- **`--only` は対称的なフィルタ**。`--only hotspots` と `--only dedup` のどちらでも同じスキーマ (該当しない側は空配列) を返し、消費側に分岐を持ち込まない。
- **既存 flag の透過**。`scan` 経由でも各サブコマンドの細かい挙動を制御できるようにする (実装は §5 のスキーマに合わせて整理)。名前衝突するもの (`--exclude`) は scan 側で 1 つにまとめ、内部で両軸に渡す。

## 5. 統合 JSON スキーマ案

### 5.1 設計判断

スキーマ全体を貫く 4 つの判断を先に固定する。

1. **座標は構造化表現を正とする**。`{ file, startLine, endLine }` を一次表現とし、`location: "file:start-end"` 文字列は人間表示用の派生フィールドとして併記する。エージェントは `Read` tool に行範囲を直接渡すため、文字列を再パースさせない方が摩擦が少ない。
2. **スコア軸は正規化しない**。hotspot 軸 (`cognitiveComplexity`, `sloc` など) は原始指標で値域がばらばら、dedup 軸 (`combined`, `tokenOverlap` など) は 0..1 の類似度確信度。両者は意味論が違うので 0..1 への揃え込みは行わず、それぞれ native な形のまま保持する。代わりに各候補に `priority: "high" | "medium" | "low"` の **粗い順序情報** を付与し、両軸間の相対比較が必要な場面のための寄せ集め指標とする。`priority` は dedup / hotspot 各々のゲート判定からの派生で、軸合成ではないことに注意 (詳細は §5.3 / §5.4)。
3. **hotspots と duplications は別配列で並べる**。両軸を 1 本の `items[]` に混ぜると統一順序キーが要るが、自然な比較軸が無い (hotspot は co-occurrence, dedup は群サイズ × 類似度)。読み手が必要なら統合できる形を維持しつつ、デフォルト出力は分離する。
4. **既存スキーマの語彙は流用する**。`HotspotCandidate` / `CloneGroup` の名前は段階1 で定着しているので、`scan` の中でもそのまま使う。新規導入は最小限。

### 5.2 トップレベル形状

```ts
type ScanReport = {
  status: "ok";
  tool: { name: "ts-hotspots"; version: string };

  // どのスコープで走ったか
  scope: ScanScope;

  project: {
    tsconfigPath: string;
    rootDir: string;
    sourceFileCount: number;
    functionCount: number;
  };

  // 関数 hotspot 軸。--only dedup なら省略
  hotspots?: HotspotsSection;

  // 重複検出軸。--only hotspots、または whole-repo で --include-dedup なし時は省略
  duplications?: DuplicationsSection;

  // dismissal レジストリの状態 (両軸共通レジストリ案。§8 で論点扱い)。空なら省略
  dismissed?: DismissedSummary;
};

type ScanScope =
  | { mode: "default"; path: string }
  | { mode: "pr"; baseRef: string; headRef: string; threeDot: boolean }
  | { mode: "whole-repo"; ref: string };
```

省略可能な top-level フィールドの規則:

- `--only` で除外された側の section は **キーごと存在しない** (空オブジェクトでもない)。消費側は `if (report.hotspots) ...` で分岐しやすくする。
- 計測されたが結果が 0 件の場合は section は **存在し**、内部の配列が空になる (例: `duplications.groups = []`)。
- 「該当なし」と「未計測」を JSON 側で区別できる、という不変条件を保つ。

### 5.3 `hotspots` セクション

```ts
type HotspotsSection = {
  candidates: ScanHotspot[];
  // --full 相当の追加は v1 では含めない。必要なら後で `--full` を scan にも引き継ぐ
};

type ScanHotspot = {
  priority: "high" | "medium" | "low";
  ref: {
    location: string;            // "file:start-end" 派生表記
    coords: Coordinate;          // 一次表現
    name: string;
    kind: string;                // "FunctionDeclaration" | "MethodDeclaration" | ...
  };
  axes: FunctionAxisId[];        // hit した軸の配列
  metrics: Partial<Record<FunctionAxisId, number>>;
  dismissalId: string;
};

type Coordinate = { file: string; startLine: number; endLine: number };
```

`priority` の付け方:

- **high**: 既存の co-occurrence ゲート (quality 軸 ≥ 1 を含む 3 軸以上) を満たす。
- **medium**: discriminative top-3 救済 (quality 軸単独で top-3 入り、軸が degenerate でない) を満たす。
- **low**: scan の `--top` を緩める将来拡張のためのプレースホルダ。v1 では出さない。

これは段階1 の `HotspotCandidate.source` (`coOccurrence` / `discriminativeTop` / `both`) に 1:1 対応する写像で、新規ゲートを足しているわけではない。

### 5.4 `duplications` セクション

```ts
type DuplicationsSection = {
  mode: "pr" | "whole-repo";
  scope: {
    base: ScopeStats;
    changed?: ScopeStats;        // mode === "pr" のときのみ
  };
  pipeline: { candidatePairs: number; reportedPairs: number };
  groups: ScanCloneGroup[];
};

type ScanCloneGroup = {
  priority: "high" | "medium" | "low";
  anchor?: ScanFragment;         // PR モードのみ; whole-repo は undefined
  members: ScanGroupMember[];
  size: number;                  // anchor + members.length (PR) / members.length (whole-repo)
  aggregateScores: AggregateScores;   // 既存 CloneGroup と同じ
  sharedEvidence: Evidence;
  recommendationHint: RecommendationHint;
};

type ScanFragment = {
  location: string;              // "file:start-end"
  coords: Coordinate;
  kind: string;                  // "function" | "block" | "window"
  code?: string;                 // --no-code で省略
};

type ScanGroupMember = {
  fragment: ScanFragment;
  scores: PairScores;            // 既存
  evidence: Evidence;            // 既存
};
```

`priority` の付け方:

- **high**: `aggregateScores.combined.median ≥ 0.6` かつ `size ≥ 3`、もしくは `combined.max ≥ 0.8`。
- **medium**: それ以外で `shouldReport` を通過したもの (= 既存 dedup の出力と同じ)。
- **low**: v1 では出さない。

閾値は M6 実装時に dogfooding で調整する前提。

### 5.5 `dismissed` セクション

段階1 の `DismissedSummary` と互換:

```ts
type DismissedSummary = {
  active: number;
  filteredThisRun: number;
  prunedThisRun: number;
};
```

ただし「dedup 群を dismiss できるか」は §8 の論点に残す。v1 では hotspot 軸の dismissal だけが反映される (= 既存挙動と一致)。

### 5.6 サンプル出力 (PR モード, `--only` なし)

```json
{
  "status": "ok",
  "tool": { "name": "ts-hotspots", "version": "0.3.0" },
  "scope": {
    "mode": "pr",
    "baseRef": "origin/main",
    "headRef": "HEAD",
    "threeDot": true
  },
  "project": {
    "tsconfigPath": "/repo/tsconfig.json",
    "rootDir": "/repo",
    "sourceFileCount": 412,
    "functionCount": 2871
  },
  "hotspots": {
    "candidates": [
      {
        "priority": "high",
        "ref": {
          "location": "src/billing/charge.ts:120-188",
          "coords": { "file": "src/billing/charge.ts", "startLine": 120, "endLine": 188 },
          "name": "applyDiscount",
          "kind": "FunctionDeclaration"
        },
        "axes": ["cognitiveComplexity", "maxNestingDepth", "callerCount"],
        "metrics": { "cognitiveComplexity": 38, "maxNestingDepth": 6, "callerCount": 14 },
        "dismissalId": "a3f9c2..."
      }
    ]
  },
  "duplications": {
    "mode": "pr",
    "scope": { "base": { "files": 410, "fragments": 4012, "lines": 38291, "fragmentsByKind": { "function": 1812, "block": 1421, "window": 779 }, "excludedFiles": 12 }, "changed": { "files": 5, "fragments": 47, "lines": 612, "fragmentsByKind": { "function": 12, "block": 19, "window": 16 }, "excludedFiles": 0 } },
    "pipeline": { "candidatePairs": 134, "reportedPairs": 6 },
    "groups": [
      {
        "priority": "medium",
        "anchor": { "location": "src/billing/charge.ts:50-110", "coords": { "file": "src/billing/charge.ts", "startLine": 50, "endLine": 110 }, "kind": "function" },
        "members": [
          { "fragment": { "location": "src/billing/legacyCharge.ts:80-140", "coords": { "file": "src/billing/legacyCharge.ts", "startLine": 80, "endLine": 140 }, "kind": "function" }, "scores": { "combined": 0.71, "tokenOverlap": 0.78, "statementKindSimilarity": 0.81, "callOverlap": 0.55, "sizeCompatibility": 0.9, "lengthScore": 0.5 }, "evidence": { "sharedCalls": ["CALL:findCustomer"], "sharedProperties": ["PROP:user.tier"], "matchedStatementKinds": ["IfStatement|ReturnStatement"], "matchedTokenNgramsSample": ["ID DOT ID", "IF ID DOT ID"] } }
        ],
        "size": 2,
        "aggregateScores": { "combined": { "min": 0.71, "median": 0.71, "max": 0.71 }, "tokenOverlap": { "min": 0.78, "median": 0.78, "max": 0.78 }, "statementKindSimilarity": { "min": 0.81, "median": 0.81, "max": 0.81 }, "callOverlap": { "min": 0.55, "median": 0.55, "max": 0.55 } },
        "sharedEvidence": { "sharedCalls": ["CALL:findCustomer"], "sharedProperties": ["PROP:user.tier"], "matchedStatementKinds": ["IfStatement|ReturnStatement"], "matchedTokenNgramsSample": ["ID DOT ID", "IF ID DOT ID"] },
        "recommendationHint": { "confidence": "medium", "likelyRefactoring": "extract-function", "riskFlags": [] }
      }
    ]
  },
  "dismissed": { "active": 3, "filteredThisRun": 1, "prunedThisRun": 0 }
}
```

## 6. ユースケース別の充足確認

§2 で挙げた 3 ユースケースが §5 のスキーマで過不足なく応えられるかを確認する。

### UC1. エージェントへの初期コンテキスト投入

**実行**: `ts-hotspots scan --whole-repo --include-dedup | claude --permission-mode plan`

**消費側のロジック (擬似)**:
```
top = []
top.push(...hotspots.candidates.filter(h => h.priority === "high"))
top.push(...duplications.groups.filter(g => g.priority === "high"))
sort top by some heuristic (例: hotspot は axes.length, dedup は size + aggregateScores.combined.median)
read each ref/anchor via Read tool using `coords.{file,startLine,endLine}`
```

**スキーマで足りるか**:

- ✓ `priority` で粗ふるい
- ✓ `coords` で `Read` tool 直接呼び出し
- ✓ `axes` / `metrics` (hotspot) と `recommendationHint` / `sharedEvidence` (dedup) で「なぜ気になるか」の根拠を提示できる
- ✓ `dismissed` が空でなければ「過去に dismiss した同種の判断」の存在を示せる

**過不足**: なし。`location` 文字列は冗長だがエージェント向け Markdown レンダリングで活躍する想定なので残置。

### UC2. PR レビュー時の CI レポート

**実行**: `ts-hotspots scan --pr "$BASE...$HEAD" --format markdown > report.md` を CI で実行し、PR コメントに貼る。

**消費側のロジック (擬似)**:
```
header: scope.mode + scope.baseRef + scope.headRef を冒頭に
section A: hotspots.candidates から high のみ表示
section B: duplications.groups から PR モード anchor を持つもののみ表示
footer: project.functionCount / duplications.pipeline.{candidatePairs, reportedPairs} で情報密度を要約
```

**スキーマで足りるか**:

- ✓ `scope.mode === "pr"` と `baseRef` / `headRef` でヘッダ生成
- ✓ `duplications.mode === "pr"` のとき `anchor` が必ず付くので「変更側 fragment」を識別できる
- ✓ `duplications.scope.changed` が PR モード限定で同居するので scope サマリも作れる
- ✓ `--no-code` を渡せば PR コメント長を抑えられる (大きな fragment ソースの転載を避ける)

**過不足**: PR モードでの hotspot 側の挙動 (「変更ファイル周辺のみ候補化するか、tree 全体を候補化するか」) はスキーマでなくセマンティクスの判断で、§8 の論点に残す。**スキーマ自体は変更不要**。

### UC3. 手動レビュー / 引き継ぎ時の repo オンボーディング

**実行**: `ts-hotspots scan --whole-repo --include-dedup --format markdown > overview.md` を一度だけ。

**消費側のロジック (擬似)**:
```
人間が overview.md を読む。
hotspot は "axes hit が多い順", dedup は "size 大きい順" にざっと眺める。
気になるところだけエディタで開く。
JSON も並行に出力 (`--format json`) しておけば、後日カテゴリ別集計などに使える。
```

**スキーマで足りるか**:

- ✓ `project.functionCount` / `duplications.scope.base` で全体規模が把握できる
- ✓ `duplications.groups[].size` で「N 箇所コピーがある巨大クラスタ」が一目で見える
- ✓ `aggregateScores.{min,median,max}` で群内のバラツキ (= 緩い類似と固い類似の混在) を把握できる
- ✓ Markdown 出力時に `recommendationHint.likelyRefactoring` を 1 行サマリとして使える

**過不足**: なし。ただしこのユースケースでは "重複群が同じファイル内に集中している" ような構造が見えるとオンボーディングに役立つ。これは新フィールドではなく Markdown レンダラー側の集計で対応する想定。

### 横断確認

3 ユースケースに共通して必要なフィールドが揃っているかをチェックリスト化する。

| 必要事項 | スキーマ位置 | 状態 |
|---|---|---|
| 「どのスコープで走ったか」の同定 | `scope` | ✓ |
| 行範囲付き座標 | `*.coords` | ✓ |
| 人間表示用のラベル | `*.location` | ✓ |
| 軸ごとの根拠 | `axes` / `metrics` (hotspot), `evidence` / `sharedEvidence` (dedup) | ✓ |
| 群サマリ統計 | `aggregateScores` | ✓ |
| 統合フィルタ用の粗いランク | `priority` | ✓ |
| dismiss の状態 | `dismissed` | △ (dedup 群の dismissal は §8 で要決定) |
| 計測されなかったことを判別 | section の有無で判別 | ✓ |

**結論**: §5 のスキーマで主要 3 ユースケースを過不足なくカバーする。残課題は dismissal の取り扱いと PR モード hotspot のセマンティクス (両方とも §8 で扱う)。

## 7. エージェント誘導文サンプル

> TODO

## 8. 未解決の論点
