# README の初見ユーザ向け書き直し — 提案

> Status: 計画 (未着手・着手可)
> Scope: `README.md` のみ。CLI / スキーマ / `--help` 文言には触れない。

## Context

`README.md` を「ts-hotspots を初めて知るユーザ」の視点で読み直すと、以下 10 点で読みにくさが出る。CLAUDE.md の "User-facing docs" ルール (first-time reader 視点 / no internal jargon / rewrite over append / scale proportional) と照らしても、現状はいくつかルールに反している。

1. **冒頭が機構先行で問題後行。** 1 文目の "statically analyzes a TypeScript project and points coding agents at the spots most worth reading first" は機構の説明で、初見ユーザはまず「なぜそれが必要なのか」を知りたい。LLM エージェントが未知のリポジトリに投入されるシナリオ (=この CLI が解く問題) が冒頭に出てこない。
2. **アルゴリズム用語が前段で多用されている。** `Type-3 duplication` / `Brandes betweenness` / `SDP violation` / `PageRank` / `support / conditional probability / lift` / `reverse closure` / `co-occurrence` / `discriminative axis` などが本文中に説明なしで登場する。CLAUDE.md "No internal jargon" の精神に反する。これらは `docs/` か `--help` か、必要ならば末尾の "Algorithms" 付録に逃がすべき。
3. **Quick Start がない。** Install 節は `npm i -D ts-hotspots` で終わる。次に欲しいのは「ゼロから 1 コマンドで読める出力が出るまで」の最短路だが、それが提示されていない。
4. **出力の具体例がない。** 各サブコマンドのスキーマが散文で説明される ("Each entry in `hotspots[]` has `kind: ...`, a `ref` whose ...") が、10 行程度のサンプル JSON / Markdown を 1 個見せる方が圧倒的に速く伝わる。スキーマの逐語説明は `--verbose` の発見導線か、別の reference ページで足りる。
5. **オプション一覧が 4 サブコマンド分ほぼ重複している。** `--format` / `--exclude` / `--limit` / `--verbose` は 4 回ほぼ同じ文面で書かれている。共通オプション節を 1 つ作って、サブコマンドにはコマンド固有のオプションだけ残せば、本文量がおよそ半分になる。
6. **内部フィールド名が本文に漏れている。** `functionRankings` / `functionAxisMeta` / `functionCoOccurrence` / `aggregateChurn` などは `--verbose` 時の出力フィールド名で、初見の本文では知らなくていい。今は default 出力の説明と verbose 出力の説明が同じレベルで並んでおり、新規ユーザの認知負荷を上げている。
7. **`.ts-hotspots.json` 設定が architecture 節の中に埋もれている。** 設定ファイルはプロジェクトレベルの概念で、現状 arch のみで使われていても README 構造としてはトップレベル節に昇格させるのが素直。将来 `comp`/`dup`/`coch` 側に設定キーが増えても破綻しない。
8. **`Status: Under development.` が末尾に孤立。** 開発段階の情報は初見ユーザの判断材料 (採用するか / 様子見か) に直結するので、冒頭または独立した "Limitations" 節に出すべき。最終行 1 文では弱すぎる。
9. **「動かない条件」が散発的にしか書かれていない。** `git ls-files` 必須・未追跡ファイルはスキップ・スキーマは変わりうる・大規模リポジトリでの実行時間 — どれも README 中で軽く触れられているか触れられていないかで、まとまった "Limitations" 節がない。
10. **License / Contributing への言及がない。** OSS README としての最小期待を満たしていない。

## Approach

「現状の体裁を保ったまま局所修正する」のではなく、**章立てごと組み替える**。CLAUDE.md "Prefer rewriting over appending" を尊重するため。

新しい章立ては次の 8 つ。各章は短く保ち、「読み手が今そこで知りたいこと」だけを置く。スキーマの逐語説明・アルゴリズム名・運用配慮は本文から完全に外す (アルゴリズム付録もリンク誘導も置かない)。

```
# ts-hotspots
[1 行タグライン + 開発段階バナー]

## Why                          ← 問題提示 (LLM エージェント x 未知 TS リポジトリ)
## What it surfaces             ← 4 サブコマンドの「答えてくれる質問」を 1 行ずつ
## Quick start                  ← install → 1 コマンド → 模式的な出力サンプル
## Subcommands                  ← 各 ~10 行: 何を出すか / いつ使うか / コマンド例 / 模式出力 / 固有オプション
  ### complexity (comp)
  ### duplication (dup)
  ### architecture (arch)
  ### cochange (coch)
## Common options               ← --format / --exclude / --limit / --verbose を 1 箇所に集約
## Configuration                ← .ts-hotspots.json をトップレベルへ昇格
## Dismissing false positives   ← 概ね現行を維持
## Limitations                  ← 開発段階・git 必須・未追跡スキップ・スキーマ変動・ベンチ未保証
```

License 節は置かない (リポジトリの `LICENSE` ファイルで自明)。

CLAUDE.md の "Keep scale proportional" に従い、現状 ~210 行の README を **120–150 行** まで圧縮することを目標にする。情報を捨てるのではなく、本文から `--help` / `--verbose` 自己発見導線へ再配置する。

各サブコマンド節は同じテンプレに揃える (1 段落の用途 → サンプルコマンド → 模式的な出力サンプル → 固有オプションの bullet)。今は段落構造がバラバラで、4 つの節を読み進める途中で粒度が変わる。

アルゴリズム名 (Brandes / PageRank / Type-3 / SDP / lift / support / confidence) は本文から削除する。「どんなアルゴリズムを使っているか」は README の関心ではなく、必要なら実装 (`src/`) と `docs/plans/` を読めば足りる。付録もリンク誘導も置かない。

出力スキーマの逐語説明も本文から削除し、別の `docs/output-schema.md` も作らない。JSON のキー名 (`hotspots` / `score` / `metrics` / `members` など) は十分自己記述的で、模式出力を 1 つ見せれば形は伝わる。詳細は `--verbose` で出力させて発見してもらう。アクティブ開発中にスキーマリファレンスを別建てで維持するのは陳腐化コストに見合わない。

## Per-section breakdown

各節について「現状」→「提案」を列挙する。書き下し例は要点だけ示し、実装段階で文言を詰める。

### 1. 冒頭タグライン + 開発段階バナー

**現状**: 機構先行の長文 1 文と 4 つのサブコマンド bullet。Status は最終行。

**提案**: タグラインを 1 行に短縮し、その直下に開発段階を明示する小さなバナー。例:

```markdown
# ts-hotspots

Static analysis that tells AI coding agents which files in your TypeScript repo to read first.

> Status: under active development. Output schemas may change between minor versions.
```

### 2. `## Why`

**現状**: 該当節なし。冒頭の機構説明がこの役を半端に兼ねている。

**提案**: 2–3 段落で問題を提示する。「LLM エージェントが未知の TS リポジトリに投入されたとき、どこから読むべきかを決める静的シグナルがない」「人間レビュアーは経験で知るが、エージェントは毎回ゼロから探索する」「ts-hotspots は座標 (file:line) と数値証拠だけを返し、判断はエージェントに委ねる」あたり。アルゴリズム名は出さない。

### 3. `## What it surfaces`

**現状**: 冒頭直後の 4 bullet (各 1 行 + 「Best for "..."」)。文言は概ね良いが用語が混ざる。

**提案**: 4 bullet を維持。ただし用語をユーザ語彙に置換 (Type-3 → "near-duplicate"、Brandes betweenness → "central files in the dependency graph"、support/lift → "frequently change together")。"Best for" 質問形式は維持 — 良い。

### 4. `## Quick start`

**現状**: 該当節なし。`## Install` のみで止まる。

**提案**: install から最小例まで 1 章にまとめる:

```markdown
## Quick start

```bash
npm i -D ts-hotspots             # requires Node.js 24+
npx ts-hotspots complexity       # markdown report to stdout
npx ts-hotspots complexity | claude --permission-mode plan
```

The default output is a Markdown document containing a short instruction
block followed by a JSON code block — pipeable straight into an agent.
The JSON shape (schematic):

```jsonc
{
  "hotspots": [
    {
      "kind": "complexity",
      "ref": { "location": "src/foo.ts:42-87", ... },
      "score": { "axis": "...", "value": ... },
      "metrics": { ... },
      "dismissalId": "comp:..."
    },
    ...
  ]
}
```
```

サンプルは模式的にする (具体的な数値や軸名は `...` で省く)。理由: スキーマがアクティブ開発中で変わりうる ("Status" バナーで明言済み) ため、実出力ベースの貼り付けは陳腐化する。模式に留めれば「形は分かる、詳細は `--verbose` か `--help` で」という導線が自然に成立する。

### 5. `## Subcommands`

**現状**: 4 サブコマンドが `## Hotspot candidates: ...` などバラバラの見出しレベル / 命名で並ぶ。各節の段落構成も粒度がそろっていない。

**提案**: `### complexity (comp)` 形式に統一。各節は次のテンプレに揃える:

```
### complexity (comp)

[1 段落: 何を surface するか / いつ使うか — 用語フリー]

```bash
ts-hotspots complexity                   # 一番典型的な使い方
ts-hotspots complexity --diff origin/main...
```

Each hotspot reports `ref.location`, the axis it ranked highest on,
and the raw metric values that triggered it. (See `--verbose` for the
full per-axis breakdown.)

Command-specific options:
- `--metrics <list>` ... [comp 固有のものだけ。--format/--exclude/--limit/--verbose は出さない]
```

スキーマの逐語説明 ("Each entry has `kind`, `ref`, `score` ...") は削除。Quick start の模式 JSON で全体の形は伝えてあるので、サブコマンド節では「何が出るか」を 1–2 文で要約するだけにする。フィールドの正式定義が必要な人は `--verbose` で実物を見る。

### 6. `## Common options`

**現状**: 該当節なし。各サブコマンド節で同じ 4 オプションが繰り返されている。

**提案**: 1 章にまとめる。

```markdown
## Common options

These work across all four subcommands:

- `--format markdown|json` — output format (default: markdown)
- `--limit <N|all>` — cap `hotspots[]` at the top N (default: 20)
- `--exclude <glob>` — extra path glob to drop (repeatable)
- `--verbose` — emit the rich schema (per-axis details, summaries, raw inputs)

Run `ts-hotspots <subcommand> --help` for the full list, including
subcommand-specific flags.
```

これで各サブコマンド節は固有オプションだけ列挙すればよくなる。

### 7. `## Configuration`

**現状**: architecture 節の `### Optional config` として埋もれている。

**提案**: トップレベルに昇格。`.ts-hotspots.json` の役割と現状サポートされているキーをここで一覧する (現状は `architecture.downweight` のみ)。将来他コマンドが設定キーを追加してもここを伸ばすだけで済む。

### 8. `## Dismissing false positives`

**現状**: 概ね良い。1 個だけ問題: `dismissalId` の prefix 一覧 (`comp:` / `dup:` / `arch:` / `coch:`) が箇条書きで並んでおり、初見ユーザはほぼ気にしない情報。

**提案**: 説明文を維持。prefix 表は「each report's `dismissalId` is unique to that hotspot's underlying source — edits invalidate it automatically」程度に短縮し、4 つの prefix 例の列挙は削除 (どれを dismiss するかは出力に含まれているから、prefix 体系を覚える必要はない)。

### 9. `## Limitations`

**現状**: 末尾 `## Status` の "Under development." 1 行のみ。

**提案**: 正直な制約一覧に拡張。

```markdown
## Limitations

- Under active development; output schemas may change between minor versions.
- Sources are enumerated via `git ls-files`. Run inside a git working tree
  and commit before analyzing — untracked files are skipped.
- The architecture and cochange pipelines are O(graph size) / O(window × pair count);
  very large repos may need `--exclude` or `--max-files-per-commit` tuning.
- Dismissals are stored per-machine (`~/.config/ts-hotspots/...`),
  not shared across teammates.
```

冒頭バナーと役割が重なる点 (status) はあえて両方に置く: バナーは「読む前の警告」、Limitations は「採用判断のチェックリスト」として機能が違う。

## 確定事項 (ユーザ判断済み)

- **アルゴリズム名は完全除去**。付録もリンク誘導も置かない。「どんなアルゴリズムを使っているか」は README の関心ではない。
- **出力サンプルは模式的**。実出力ベースの貼り付けはアクティブ開発中のスキーマ変動で陳腐化するため避ける。
- **License 節は置かない**。リポジトリの `LICENSE` ファイルで自明。
- **`docs/output-schema.md` は作らない**。JSON のキー名が自己記述的で、模式出力 + `--verbose` で発見可能なため、別建てのスキーマリファレンスは陳腐化コストに見合わない。

## Deferred

- **README の翻訳 (日本語版)。** 現状 README は英語のみ。日本語ユーザ向けに `README.ja.md` を別途作る案はあるが、本提案のスコープ外。
