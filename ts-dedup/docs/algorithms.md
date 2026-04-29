# ts-dedup のアルゴリズム

ts-dedup は転置索引による候補絞り込みと、複数特徴量の Jaccard 再スコアを組み合わせて Type-3 重複を検出する。precision より recall を優先する設計で、最終判断は下流に委ねる (詳細は [requirements.md](./requirements.md))。

このドキュメントは内部アルゴリズムの解説をセクションごとに分割している。

1. [パイプライン概観](./algorithms/01-pipeline.md)
2. [フラグメント抽出](./algorithms/02-fragmentation.md)
3. [特徴量抽出](./algorithms/03-features.md)
4. [転置索引と候補検索](./algorithms/04-index-and-search.md)
5. [類似度スコアリング](./algorithms/05-scoring.md)
6. [報告判定](./algorithms/06-decision.md)
7. [レポート後処理](./algorithms/07-postprocess.md)
8. [決定性と Whole-repo モード](./algorithms/08-determinism.md)
