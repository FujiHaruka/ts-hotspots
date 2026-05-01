## 目的

`dup` のクローングループ並び順を「リファクタリング価値」寄りに矯正する。現状の `aggregateScores.combined.max` だけだと「形が似ているか」しか測っておらず、「触ってもいない安定した重複」と「いま編集されていて発散リスクが高い重複」を同列に扱ってしまう。git churn (commit 回数) を leverage 軸として乗法で効かせ、同じ類似度なら ホットなグループが上に来るようにする。

`comp` 側で既に `commitCount` が leverage 軸として運用されているので、軸の意味論を `dup` でも同じに揃えることが副次目的。

## 現状認識

- 既存 churn コレクタ: `src/collectors/churn/commit-count.ts`。引数 `{ rootDir, files, window, ref, onWarning }`、戻り値 `Map<string, number>` (key はリポジトリ root 相対 posix path)。
  - `git log --first-parent -m --name-status -M` で 1 commit = 1 カウント、rename を `-M` で背走しつつ canonical path に集約。
  - 浅いクローン / 非 git / git 未インストールはすべて空 Map + stderr 警告で graceful skip (requirements.md:172)。
- comp 側の wiring: `src/cli.ts:358-401`。フラグは `--churn-window <N>` (既定 200)、`--churn-ref <ref>` (既定 `HEAD`)、`--no-churn`。collector 結果は `aggregator/aggregate.ts:56` で `metrics.commitCount` に焼き込み。
- dup 側のスコア型: `src/duplication/domain/candidate.ts` の `ScoreBreakdown` (5 軸 token/statement/call/size/length)、`CandidateScore.combined` がペア final。
- dup 側のグループ生成と並び替え:
  - PR mode: `src/duplication/report/buildCloneGroups.ts:175` でグループの `aggregateScores.combined = axis(combined[])` を構築、`:204-205` で `aggregateScores.combined.max` 降順でグループソート。
  - whole-repo mode: `src/duplication/report/buildCloneGroupsFromClusters.ts:217 / :246-247` も同形。
- 出力スキーマ: `serializeReport.ts` 経由で JSON / Markdown 双方に送出。グループには既に `aggregateScores`、メンバーには `file` (相対 posix) を含む。

`dup` の最終出力単位は **グループ**。ペアの並び順 (`ranking.ts`) ではなくグループの並び順を churn で動かすのが正しい作用点。

## Approach

「**ペアスコアは触らず、グループ最終スコアにだけ churn 増幅器を掛けて並び順を決める**」を採用する。

```
groupFinal = aggregateScores.combined.max × (1 + α · normalize(groupChurnMax))
```

- **集約は max** (会話で確定)。グループ各メンバーが指すファイルの commitCount を取り、**ファイル集合に対する max** (= 同じファイルに複数メンバーがあっても 1 回だけ計上)。
- **`(1 + …)` 形式**: churn=0 (浅いクローン / 新規ファイル / `--no-churn`) で増幅器が 1.0 になり、現挙動と完全互換。requirements.md:172 の zero-fill 方針と整合。
- **乗法 + leverage** で comp と同じ意味論。requirements.md:109,119 のメンタルモデル ("leverage 軸単独では候補化しない、quality 軸を増幅するだけ") をそのまま継承。
- **divergence (max - min) はメタデータのみ**。sort key には入れない (両方ホットの「協調修正コスト」ケースが落ちるため)。下流 agent / 人間レビュアが「max は高いが min も高い (協調修正)」と「max 高 + min 低 (サイレント分岐)」を読み分けられるよう、両方の値を JSON に同梱。
- **作用点はグループ並び替えのみ**。ペアスコア (`scoreCandidate.ts`) と `report/ranking.ts` のペアソートは触らない。pair-level の "weakest pair to evict" ロジック (`buildCloneGroups.ts:149`, `buildCloneGroupsFromClusters.ts:182`) も churn を見ない — そこは類似度の話で、refactor 価値の話ではない。
- **PR mode と whole-repo mode で同じ集計**。PR mode 専用の churn 強調 (= unify-comp-and-dup.md D9 の Z 案) はここでは扱わない。当面はどちらのモードでも `--churn-window 200` の窓を均等にかける。
- **comp とフラグ命名を完全一致**: `--churn-window`, `--churn-ref`, `--no-churn`。これにより両コマンド併用時の認知負荷ゼロ。

### 増幅器のパラメータ

```
amplifier = 1 + α · min(groupChurnMax, CHURN_CAP) / CHURN_CAP
```

| パラメータ | 既定 | 根拠 |
|---|---:|---|
| `α` (alpha) | **0.5** | 最大増幅 1.5x。combined=0.4 + churn 飽和 (=0.6) > combined=0.55 + churn 0 (=0.55) という入れ替わりが起きる程度。recall 重視 + 決定論を壊さない控えめ設定 |
| `CHURN_CAP` | **20** | comp の churn 軸は cap を持たない素のカウントだが、dup の増幅器は飽和点が必要。200 commit 窓で 20 commits 触られたファイルは "ホット" と呼んで差し支えない。dogfooding で sweep する余地あり |

## 変更ファイル

### 1. ドメイン拡張

- `src/duplication/domain/candidate.ts`: 変更なし (ペアスコアは無触で OK)。
- `src/duplication/domain/group.ts` (該当ファイル): `CloneGroup` 型に以下を追加:
  - `aggregateScores.combined.amplified: number` — 増幅後スコア。並び替えに使う key。
  - `aggregateChurn: { max: number; min: number; perFile: Record<string, number> }` — メタデータ。`perFile` はそのグループに登場するファイル → commitCount。
  - 既存の `aggregateScores.combined.{max,mean,…}` は無触 (互換性は問わないが、増幅前の値を見たい運用ニーズはある)。
- 各メンバーには churn を載せない (ファイル単位なので冗長、`aggregateChurn.perFile` で参照可能)。

### 2. グループ集約ヘルパー

- `src/duplication/scoring/churnAmplifier.ts` (新規):
  ```ts
  export function churnAmplifier(
    groupChurnMax: number,
    alpha: number,
    cap: number,
  ): number;
  ```
  cap=0 でも安全に 1.0 を返す。テストで境界 (churn=0, churn=cap, churn=cap+1, alpha=0) を網羅。
- `src/duplication/scoring/churnAmplifier.test.ts` (新規)。
- `src/duplication/scoring/index.ts`: re-export。

### 3. グループビルダーの両セアム

- `src/duplication/report/buildCloneGroups.ts`:
  - 関数引数に `churnByFile: ReadonlyMap<string, number> | undefined` を追加 (undefined 時は空 Map と同じ扱い)。
  - グループ集約時 (現 `:175` 付近) に `aggregateChurn` を計算 (メンバーが指す file セットの max/min/perFile)。
  - グループソート (現 `:204-205`) を `aggregateScores.combined.amplified` 降順に切り替え。同値時の tie-breaker (size / first member id) は無触。
- `src/duplication/report/buildCloneGroupsFromClusters.ts`: 同型修正 (`:217`, `:246-247`)。
- 既存テスト (`buildCloneGroups.test.ts`, `buildCloneGroupsFromClusters.test.ts`): 既存ケースは churn 空 Map で呼んで挙動不変、加えて churn 有りの新ケース (max=20 のグループが combined 高い churn=0 のグループを抜く) を 1 件ずつ追加。

### 4. JSON Report への配線

- `src/duplication/report/jsonReport.ts` / `serializeReport.ts`:
  - `buildJsonReport` の入力に `churnByFile` を追加し、両ビルダーに pass-through。
  - `serializeReport` では `aggregateChurn` をそのまま展開、`amplified` は最上位の sort key としてのみ使い JSON には `amplified` フィールドを露出 (デバッグしやすさのため)。verbose 時に `aggregateChurn.perFile` を出す、非 verbose では `{max, min}` のみ — 現 `aggregateScores` の verbose 切り分けに従う。

### 5. ランナー配線 (collectChurn 呼び出し)

- `src/duplication/cli/runDetector.ts` / `runWholeRepoDetector.ts`:
  - `WholeRepoOptions` / 対応する PR options に `churn?: { window: number; ref: string }` を追加 (undefined = 無効)。
  - 解析対象ファイル一覧 (= `sourceList` / 走査対象) を `SourceFileInfo[]` に変換して `collectChurn` を呼ぶ。
  - PR mode の `ref` は `args.headRef` (PR の head 側) を既定にする — diff/PR の対象 ref と整合。`--churn-ref` で上書き可能。
  - whole-repo mode の `ref` は `args.ref` を既定。
  - 失敗時 (collectChurn が空 Map を返す) は `onWarning` を `io.stderr` に流して継続。
- `src/duplication/cli/main.ts`:
  - `args.churn` が無効でなければ collector を呼んで `churnByFile` を作り、ランナーに渡す。
  - perfLog にフェーズ `churn` を 1 つ追加 (有効時のみ計測、`perfLog` 無効時はノーコスト)。

### 6. CLI フラグ

- `src/duplication/cli/args.ts`:
  - `PrModeArgs` / `WholeRepoModeArgs` に共通フィールド `churn: { enabled: boolean; window: number; ref: string | undefined }` を追加。
    - `enabled` 既定: `true`
    - `window` 既定: `200`
    - `ref` 既定: `undefined` (= mode ごとの ref を継承)
  - parseArgs に以下を追加:
    - `--churn-window <N>` (number, positive int)
    - `--churn-ref <ref>` (string)
    - `--no-churn` (boolean negation)
  - USAGE に 3 行追加。
- `src/duplication/cli/args.test.ts`: 既定値、各フラグ単独、`--no-churn` 時の他オプション無視ケース。

### 7. config 連携

- `src/duplication/config/config.ts`:
  - `scoring.churn: { alpha: number; cap: number }` を追加。
- `src/duplication/config/defaults.ts`:
  - `churn: { alpha: 0.5, cap: 20 }`。
- これによりヘルパー側で `config.scoring.churn.alpha` / `config.scoring.churn.cap` を使い回せる。CLI フラグ (`--churn-window`, etc.) は collector の挙動、config の `alpha` / `cap` は増幅器のパラメータ — 役割が違うので別レイヤに置く。

### 8. ドキュメント

- `docs/requirements.md`:
  - Part B (duplication) のスコアリング節に「churn による leverage 増幅」を 1 段落追加。
  - 既存の `commitCount` 説明 (`:94`) と意味論を相互参照。
- `docs/dedup/algorithms/05-scoring.md`: グループ並び替えの式に増幅器を追記。
- README: ユーザー向けには「同じ類似度ならホットなグループが上に来る」程度の 1〜2 行で十分 (CLAUDE.md「user-facing docs」ガイダンス: delta ではなく現挙動を書く)。フラグの説明は comp と共通なので既存セクションを統合。

## 完了基準

- `pnpm test` 緑 (新規テスト含めて全パス)。
- `pnpm bench` recall@all **0.95 維持** (churn は並び替えにのみ作用、足切りはしないので recall は不変が期待値。下がった場合は並び替えに副作用があるはずなので調査)。
- ts-dedup self-scan (`--whole-repo`) で:
  - **churn=0 のグループしかない fixture では top 順位が変わらない** (例: `--no-churn` 出力との完全一致)。
  - **実リポでの top 5 のうち少なくとも 2 つが、churn 増幅で順位入れ替わり** をスポット確認。
  - wall **+5% 以内** (collector は git log 1 回 + 軽い parser、files 数に対して O(commits × files))。
- `--no-churn` 指定時に出力 JSON が現挙動と **完全一致** (順序・aggregateChurn 不存在)。
- 浅いクローン環境で git log が部分的でも crash せず、`aggregateChurn.max = 0` で増幅器 1.0、stderr 警告 1 行を確認。

## リスク / 既知の制約

- **`α` / `CHURN_CAP` の校正**: 既定 `α=0.5, cap=20` は推測値。dogfooding で順位入れ替わりが過剰 / 過少なら sweep。`cap` を窓 (200) と連動させる案 (例: `cap = window × 0.1`) もあり得るが、まずは独立パラメータで様子見。
- **PR mode の churn 二重計上感**: PR の対象になっている = それ自体が "今触られている" シグナルなのに、さらに 200 commit 窓 churn を掛けると「常時 hot なファイルの PR」が極端に上位化する可能性。これは意図通り (refactor 価値が本当に高い) と扱うが、ユーザーフィードバック次第で `--no-churn` 推奨に倒す余地あり。
- **同一ファイル内に複数メンバーがあるグループ**: ファイル集合に対する max を取るので問題なし。`aggregateChurn.perFile` の cardinality がメンバー数より少ないことがある (これは正しい挙動)。
- **メンバーがリポ外のファイルを指すケース**: 通常起きないが、起きたら collector の Map に key が無い → `?? 0` で 0 扱い、increase 対象外。
- **グループソートの determinism**: 増幅後 score がペア score の関数 (× 増幅器) なので、入力同一なら出力同一。requirements / CLAUDE.md の "Determinism is a hard invariant" を満たす。
- **`combined.amplified` を JSON に出すかどうか**: デバッグ性 vs スキーマ膨張のトレードオフ。最初は出す方針 (verbose 時のみ)、ノイズだったら隠す。

## 後続候補 (本計画の範囲外)

- **PR mode 専用の "PR-derived churn 強調"** (unify-comp-and-dup.md D9 の Z 案): PR 内変更ファイルだけ churn を別計算し追加重みを乗せる。本計画の安定化後に検討。
- **divergence-aware 集約を sort key に組み込む** (例: tiebreaker として `aggregateChurn.max - aggregateChurn.min` を使う): メタデータを下流が活用してくれない場合のみ実装。
- **`α` / `cap` の自動チューニング**: bench fixture 上で sweep して "順位の安定性 × 価値ある順位入れ替わり率" を最大化。
- **per-function churn (`git log -L`)**: requirements.md:201 で却下済み。dup 側でも同じ理由で見送り。
