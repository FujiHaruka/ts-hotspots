# npm 公開準備プラン

## Context

`package.json` には `bin` / `main` / `exports` / `files` / `prepublishOnly` が
すでに揃っており、`pnpm build` で `dist/` が出力される状態。一方で、実際に
`npm publish` する前に解消すべき欠落・不整合が複数ある。

調査で判明した事実:

- **パッケージ名 `ts-dedup` は npm 上で先取りされている。**
  `npm view ts-dedup` は `amit-t` が公開済みの別パッケージ
  (`A lightweight, pluggable TypeScript library for time-bound
  deduplication ...`) を返す。**現名のままでは publish できない。**
- **`typescript` が runtime で必須だが未宣言。** `src/features/*.ts` などが
  `import ts from "typescript"` しており、コンパイル後の `dist/` も同様に
  `typescript` を require する。ところが `package.json` の
  `dependencies` / `peerDependencies` は空。インストール先で必ず
  `Cannot find module 'typescript'` になる。
- **`main` / `exports` が CLI エントリ (`#!/usr/bin/env node` 付き) を指している。**
  ライブラリとして import される使い方を想定していないなら、CLI 専用
  パッケージとして `main` / `exports` は外すのが正しい。
- **`files` に `LICENSE` を含むが、リポジトリに `LICENSE` ファイルが存在しない。**
  `license: MIT` だけ宣言してある状態。
- **メタ情報が空または欠落。** `description: ""`、`keywords` / `author` /
  `homepage` / `bugs` / `engines` が未設定。npm レジストリ表示と検索性に直結。
- **README の Install セクションが "not yet published to npm" のまま。**
- **`prepublishOnly` は build のみで、typecheck / test を踏んでいない。**
  publish 直前に壊れたコードを止める網がない。

## Approach

公開可能・かつインストール後に実際に動く状態を、次の 5 ステップで担保する。

1. **名前衝突の解消** — 名前を変える。スコープ付き
   (`@fujiharuka/ts-dedup`) を第一候補にすると、bin 名・ブランド・README
   をほぼ書き換えずに済む。スコープなしを取りたい場合は `tsdedup` /
   `ts-clones` / `ts-dupes` が空いている (確認済み)。bin 名は
   `ts-dedup` のまま残せる (パッケージ名と独立)。
2. **runtime dependency の整合** — `typescript` を `dependencies` に追加。
   CLI として `npx` 経由で動くことが前提なので、`peerDependencies` ではなく
   通常の依存にする。利用者側のバージョン整合を強制する必要はない。
3. **公開サーフェスを CLI に絞る** — CLI 専用方針確定。`main` / `exports` を
   削除し、bin だけを公開 API とする。
4. **メタ情報と LICENSE の充足** — `description` / `keywords` / `author` /
   `homepage` / `bugs` / `engines.node` を埋め、`LICENSE` (MIT) を
   リポジトリに置く。`files` の宣言と一致させる。
5. **`dist` をリポジトリから外す** — `.gitignore` に `dist/` を追加し
   `git rm -r --cached dist` で追跡を外す。`files` ホワイトリストが
   publish 時に `dist` を同梱するので公開には影響しない。
6. **公開前検証** — `prepublishOnly` に `typecheck` と `test` を追加し、
   `npm pack --dry-run` で同梱物を、`npm pack` + 別ディレクトリへの
   `npm install <tgz>` で実インストール後に `ts-dedup --help` 相当が
   動くことを確認した上で初回 publish する。

ポイントは「名前を決める」「`typescript` を deps に入れる」「公開面を CLI
だけに絞る」の 3 点が同時にブロッカーで、残りは品質・体裁の問題という整理。

## Per-file breakdown

### `package.json`

- `name` を確定 (推奨: `@fujiharuka/ts-dedup`、もしくは `tsdedup` 等)。
- `description` を 1 行で埋める (README の冒頭文を流用)。
- `keywords`: `["typescript", "duplication", "clone-detection",
  "code-review", "static-analysis"]` 程度。
- `author`: `Haruka Fuji <haruka@example.com>` (公開可なら) または GitHub ID。
- `homepage`: `https://github.com/FujiHaruka/ts-dedup#readme`。
- `bugs`: `https://github.com/FujiHaruka/ts-dedup/issues`。
- `engines.node`: 実行確認している `>=22` が無難 (Node 24 で開発中、
  `--experimental-transform-types` などは bench 専用なので runtime は
  もっと低くて良い。要再確認)。
- `dependencies` セクションを追加し `"typescript": "^5.x"` を入れる
  (現環境は v6 系だが npm 公開済みは 5.x が最新の可能性 — 要確認)。
- `main` / `exports` を**削除** (CLI 専用にするため)。
- `prepublishOnly` を `pnpm clean && pnpm typecheck && pnpm test &&
  pnpm build` に拡張。
- `publishConfig`: スコープ付きにした場合は `{"access": "public"}` を
  追加 (デフォルト private を回避)。

### `LICENSE` (新規)

- MIT ライセンス本文を配置。`files` 配列の宣言とリポジトリ実体を一致させる。

### `README.md`

- `## Install` を書き換え。`npm i -g <pkg>` / `npx <pkg>` の手順に差し替え、
  「clone してビルド」セクションは削除または `## Develop` 配下に縮小。
  CLAUDE.md のドキュメント方針 ("write the doc as it should read today")
  に沿って差分を残さない。

### `tsconfig.build.json` (要確認)

- 現状 `declaration: false`。CLI 専用方針なら型は出さなくて良い。
  ライブラリ用途を後で開く時に `declaration: true` + `exports.types` を
  足す方針で、今回は触らない。

### CI / workflow (任意)

- 初回は手元から `npm publish` で十分。リリース運用が見えてきた段階で
  GitHub Actions の `release.yml` を別タスクとして検討。今回のスコープ外。

## Validation steps

1. `pnpm clean && pnpm build && npm pack --dry-run` で同梱物 (dist + README +
   LICENSE のみ) を確認。`src/`、`docs/`、`tools/`、`test/` が漏れていないか
   見る。
2. `npm pack` で生成された tarball を `mktemp -d` 上に
   `npm install <abs-path-to-tgz>` し、`./node_modules/.bin/ts-dedup
   --help` 相当 (引数なしで usage 出力など) が走ることを確認。
   ここで `Cannot find module 'typescript'` が出ないこと = step 2 の
   依存修正が効いている確認。
3. (スコープ付きの場合) `npm publish --access public --dry-run` で
   レジストリ向けの最終チェック。
4. `npm login` 済みであることを確認し、`npm publish` (スコープ付きなら
   `--access public`)。
5. 公開後、別ディレクトリで `npx <pkg-name>` してインストール経由で
   再現確認。

### `.gitignore`

- `dist/` を追加。続けて `git rm -r --cached dist` でトラッキングから外す。
  `files` ホワイトリストで publish 時には同梱されるので、リポジトリから
  消えても npm 公開物には影響しない。

## Out of scope

- 自動リリース (changesets / semantic-release / GH Actions) の整備
- ライブラリ API の公開 (`exports` を後日復活させる場合の設計)
- CHANGELOG の運用ルール (初回 publish には不要)

## Open questions

- **名前**: `@fujiharuka/ts-dedup` でいくか、スコープなしで取り直すか。
  bin 名と CLAUDE.md / README のブランドを変えたくなければスコープ付き推奨。
- **`engines.node` の下限**: 動作確認したい最低バージョンは。`>=22` で
  問題ないか、`>=20` まで下げるか。
- **`typescript` のバージョン範囲**: `^5` で書くか `>=5` で広く取るか。
  TypeScript 6 が npm に出ている場合は `>=5` 推奨。
