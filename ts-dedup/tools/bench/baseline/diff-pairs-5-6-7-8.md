# pair diff: baseline=default vs variant=tools/bench/configs/ngram-5-6-7-8.json

range: HEAD~10..HEAD

## only in baseline (60)

- changed:  tools/bench/loadFixtures.ts:1-26 (window)
  existing: src/cli/runDetector.ts:8-39 (window)
  scores:   combined=0.456 token=0.488 stmt=0.600 call=0.000 size=0.813
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|InterfaceDeclaration, ImportDeclaration|ImportDeclaration|InterfaceDeclaration|InterfaceDeclaration]

- changed:  src/domain/report.ts:1-76 (window)
  existing: src/config/config.ts:1-40 (window)
  scores:   combined=0.453 token=0.813 stmt=0.250 call=0.000 size=0.526
  evidence: calls=[] props=[] stmts=[InterfaceDeclaration|InterfaceDeclaration]

- changed:  src/domain/report.ts:8-85 (window)
  existing: src/config/config.ts:1-40 (window)
  scores:   combined=0.451 token=0.813 stmt=0.250 call=0.000 size=0.513
  evidence: calls=[] props=[] stmts=[InterfaceDeclaration|InterfaceDeclaration]

- changed:  src/indexer/extractFragments.ts:123-129 (block)
  existing: src/features/callPropertyFingerprint.ts:202-205 (block)
  scores:   combined=0.444 token=0.218 stmt=1.000 call=0.000 size=0.571
  evidence: calls=[] props=[] stmts=[ExpressionStatement|ContinueStatement]

- changed:  src/indexer/extractFragments.ts:123-129 (block)
  existing: src/features/callPropertyFingerprint.ts:206-209 (block)
  scores:   combined=0.444 token=0.218 stmt=1.000 call=0.000 size=0.571
  evidence: calls=[] props=[] stmts=[ExpressionStatement|ContinueStatement]

- changed:  src/indexer/extractFragments.ts:123-129 (block)
  existing: src/features/callPropertyFingerprint.ts:214-217 (block)
  scores:   combined=0.444 token=0.218 stmt=1.000 call=0.000 size=0.571
  evidence: calls=[] props=[] stmts=[ExpressionStatement|ContinueStatement]

- changed:  src/indexer/extractFragments.ts:123-129 (block)
  existing: src/features/internal/expressionText.ts:22-25 (block)
  scores:   combined=0.444 token=0.218 stmt=1.000 call=0.000 size=0.571
  evidence: calls=[] props=[] stmts=[ExpressionStatement|ContinueStatement]

- changed:  src/indexer/extractFragments.ts:123-129 (block)
  existing: src/features/internal/expressionText.ts:26-29 (block)
  scores:   combined=0.444 token=0.218 stmt=1.000 call=0.000 size=0.571
  evidence: calls=[] props=[] stmts=[ExpressionStatement|ContinueStatement]

- changed:  src/indexer/extractFragments.ts:123-129 (block)
  existing: src/features/internal/expressionText.ts:34-37 (block)
  scores:   combined=0.444 token=0.218 stmt=1.000 call=0.000 size=0.571
  evidence: calls=[] props=[] stmts=[ExpressionStatement|ContinueStatement]

- changed:  tools/bench/metrics.ts:232-240 (function)
  existing: src/diff/extractChangedFragments.ts:13-23 (function)
  scores:   combined=0.444 token=0.155 stmt=1.000 call=0.000 size=0.818
  evidence: calls=[] props=[] stmts=[IfStatement|VariableStatement, IfStatement|VariableStatement|VariableStatement, IfStatement|VariableStatement|VariableStatement|ReturnStatement]

- changed:  src/cli/listBaseSources.ts:1-19 (window)
  existing: src/indexer/buildCodebaseIndex.ts:1-10 (window)
  scores:   combined=0.442 token=0.632 stmt=0.455 call=0.000 size=0.526
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|InterfaceDeclaration]

- changed:  tools/bench/sweepSelf.ts:104-112 (function)
  existing: src/diff/extractChangedFragments.ts:13-23 (function)
  scores:   combined=0.441 token=0.149 stmt=1.000 call=0.000 size=0.818
  evidence: calls=[] props=[] stmts=[IfStatement|VariableStatement, IfStatement|VariableStatement|VariableStatement, IfStatement|VariableStatement|VariableStatement|ReturnStatement]

- changed:  tools/bench/sweep.ts:7-31 (window)
  existing: src/report/recommendationHint.ts:1-12 (window)
  scores:   combined=0.440 token=0.231 stmt=1.000 call=0.000 size=0.480
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|ImportDeclaration]

- changed:  tools/bench/matchReport.ts:1-27 (window)
  existing: src/cli/runDetector.ts:8-39 (window)
  scores:   combined=0.440 token=0.440 stmt=0.600 call=0.000 size=0.844
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|InterfaceDeclaration, ImportDeclaration|ImportDeclaration|InterfaceDeclaration|InterfaceDeclaration]

- changed:  src/cli/listBaseSources.ts:1-19 (window)
  existing: src/diff/pipeline.ts:1-11 (window)
  scores:   combined=0.436 token=0.604 stmt=0.455 call=0.000 size=0.579
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|InterfaceDeclaration]

- changed:  src/indexer/extractFragments.ts:123-129 (block)
  existing: src/features/callPropertyFingerprint.ts:210-213 (block)
  scores:   combined=0.431 token=0.185 stmt=1.000 call=0.000 size=0.571
  evidence: calls=[] props=[] stmts=[ExpressionStatement|ContinueStatement]

- changed:  src/indexer/extractFragments.ts:123-129 (block)
  existing: src/features/internal/expressionText.ts:30-33 (block)
  scores:   combined=0.431 token=0.185 stmt=1.000 call=0.000 size=0.571
  evidence: calls=[] props=[] stmts=[ExpressionStatement|ContinueStatement]

- changed:  src/indexer/extractFragments.ts:123-129 (block)
  existing: src/features/callPropertyFingerprint.ts:184-193 (block)
  scores:   combined=0.430 token=0.151 stmt=1.000 call=0.000 size=0.700
  evidence: calls=[] props=[] stmts=[ExpressionStatement|ContinueStatement]

- changed:  tools/bench/index.ts:10-56 (window)
  existing: src/report/evidence.ts:1-61 (window)
  scores:   combined=0.429 token=0.131 stmt=1.000 call=0.000 size=0.770
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|InterfaceDeclaration]

- changed:  tools/bench/scale.ts:4-61 (window)
  existing: src/search/candidateSearch.ts:1-79 (window)
  scores:   combined=0.428 token=0.137 stmt=1.000 call=0.000 size=0.734
  evidence: calls=[] props=[] stmts=[FunctionDeclaration|FunctionDeclaration, ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|InterfaceDeclaration]

- changed:  tools/bench/sweep.ts:241-249 (function)
  existing: src/report/jsonReport.ts:68-94 (function)
  scores:   combined=0.427 token=0.233 stmt=1.000 call=0.000 size=0.333
  evidence: calls=[] props=[] stmts=[VariableStatement|ReturnStatement, VariableStatement|VariableStatement, VariableStatement|VariableStatement|ReturnStatement]

- changed:  src/cli/listBaseSources.ts:1-19 (window)
  existing: src/scoring/scoreCandidate.ts:7-18 (window)
  scores:   combined=0.427 token=0.568 stmt=0.455 call=0.000 size=0.632
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|InterfaceDeclaration]

- changed:  tools/bench/setupRepo.ts:3-72 (window)
  existing: src/indexer/buildCodebaseIndex.ts:2-30 (window)
  scores:   combined=0.422 token=0.202 stmt=1.000 call=0.000 size=0.414
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|InterfaceDeclaration]

- changed:  src/report/collapsePairs.ts:1-74 (window)
  existing: src/features/callPropertyFingerprint.ts:4-119 (window)
  scores:   combined=0.421 token=0.143 stmt=1.000 call=0.000 size=0.638
  evidence: calls=[] props=[] stmts=[FunctionDeclaration|FunctionDeclaration, FunctionDeclaration|FunctionDeclaration|FunctionDeclaration, ImportDeclaration|FunctionDeclaration]

- changed:  tools/bench/metrics.ts:59-64 (block)
  existing: src/report/evidence.ts:35-42 (block)
  scores:   combined=0.421 token=0.115 stmt=1.000 call=0.000 size=0.750
  evidence: calls=[] props=[] stmts=[ExpressionStatement|ContinueStatement]

- changed:  tools/bench/scale.ts:4-61 (window)
  existing: src/features/internal/locateFragmentNode.ts:1-82 (window)
  scores:   combined=0.420 token=0.123 stmt=1.000 call=0.000 size=0.707
  evidence: calls=[] props=[] stmts=[FunctionDeclaration|FunctionDeclaration, ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|InterfaceDeclaration]

- changed:  src/report/recommendationHint.ts:1-12 (window)
  existing: src/report/jsonReport.ts:1-24 (window)
  scores:   combined=0.419 token=0.486 stmt=0.583 call=0.000 size=0.500
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|ImportDeclaration]

- changed:  tools/bench/sweep.ts:7-31 (window)
  existing: src/report/jsonReport.ts:1-24 (window)
  scores:   combined=0.419 token=0.371 stmt=0.583 call=0.000 size=0.960
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|ImportDeclaration]

- changed:  tools/bench/index.ts:10-56 (window)
  existing: src/cli/listBaseSources.ts:1-54 (window)
  scores:   combined=0.419 token=0.080 stmt=1.000 call=0.000 size=0.870
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|InterfaceDeclaration]

- changed:  src/cli/listBaseSources.ts:1-19 (window)
  existing: src/report/recommendationHint.ts:1-12 (window)
  scores:   combined=0.417 token=0.543 stmt=0.455 call=0.000 size=0.632
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|InterfaceDeclaration]

- changed:  src/report/dropSameFileOverlap.ts:38-47 (block)
  existing: src/features/internal/typeRanges.ts:65-70 (function)
  scores:   combined=0.417 token=0.141 stmt=1.000 call=0.000 size=0.600
  evidence: calls=[] props=[] stmts=[IfStatement|ExpressionStatement]

- changed:  tools/bench/sweep.ts:241-249 (function)
  existing: src/features/callPropertyFingerprint.ts:158-162 (block)
  scores:   combined=0.414 token=0.146 stmt=1.000 call=0.000 size=0.556
  evidence: calls=[] props=[] stmts=[VariableStatement|ReturnStatement, VariableStatement|VariableStatement, VariableStatement|VariableStatement|ReturnStatement]

- changed:  tools/bench/sweep.ts:131-142 (function)
  existing: src/features/internal/syntaxKindName.ts:22-36 (function)
  scores:   combined=0.413 token=0.084 stmt=1.000 call=0.000 size=0.800
  evidence: calls=[] props=[] stmts=[ForOfStatement|ReturnStatement, VariableStatement|ForOfStatement, VariableStatement|ForOfStatement|ReturnStatement]

- changed:  src/cli/main.ts:4-18 (window)
  existing: src/cli/runDetector.ts:11-23 (window)
  scores:   combined=0.412 token=0.472 stmt=0.455 call=0.000 size=0.867
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|InterfaceDeclaration]

- changed:  src/report/jsonReport.ts:4-81 (window)
  existing: src/scoring/scoreCandidate.ts:5-98 (window)
  scores:   combined=0.410 token=0.218 stmt=0.800 call=0.000 size=0.830
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|ImportDeclaration]

- changed:  tools/bench/sweep.ts:241-249 (function)
  existing: src/features/callPropertyFingerprint.ts:133-137 (block)
  scores:   combined=0.410 token=0.135 stmt=1.000 call=0.000 size=0.556
  evidence: calls=[] props=[] stmts=[VariableStatement|ReturnStatement, VariableStatement|VariableStatement, VariableStatement|VariableStatement|ReturnStatement]

- changed:  tools/bench/loadFixtures.ts:53-71 (function)
  existing: src/features/internal/locateFragmentNode.ts:84-113 (function)
  scores:   combined=0.410 token=0.116 stmt=1.000 call=0.000 size=0.633
  evidence: calls=[] props=[] stmts=[ExpressionStatement|ReturnStatement, VariableStatement|ExpressionStatement, VariableStatement|ExpressionStatement|ReturnStatement]

- changed:  tools/bench/scale.ts:56-61 (function)
  existing: src/indexer/extractFragments.ts:91-98 (block)
  scores:   combined=0.408 token=0.084 stmt=1.000 call=0.000 size=0.750
  evidence: calls=[] props=[] stmts=[IfStatement|ReturnStatement, VariableStatement|IfStatement, VariableStatement|IfStatement|ReturnStatement]

- changed:  src/report/markdownReport.ts:63-129 (window)
  existing: src/features/callPropertyFingerprint.ts:121-221 (window)
  scores:   combined=0.406 token=0.098 stmt=1.000 call=0.000 size=0.663
  evidence: calls=[] props=[] stmts=[FunctionDeclaration|FunctionDeclaration, FunctionDeclaration|FunctionDeclaration|FunctionDeclaration, FunctionDeclaration|FunctionDeclaration|FunctionDeclaration|FunctionDeclaration]

- changed:  tools/bench/matchReport.ts:122-130 (block)
  existing: src/features/internal/typeRanges.ts:100-111 (block)
  scores:   combined=0.405 token=0.076 stmt=1.000 call=0.000 size=0.750
  evidence: calls=[] props=[] stmts=[IfStatement|IfStatement, VariableStatement|IfStatement, VariableStatement|IfStatement|IfStatement]

- changed:  src/indexer/extractFragments.ts:192-248 (window)
  existing: src/diff/gitRunner.ts:6-68 (window)
  scores:   combined=0.404 token=0.035 stmt=1.000 call=0.000 size=0.905
  evidence: calls=[] props=[] stmts=[FunctionDeclaration|FunctionDeclaration, FunctionDeclaration|FunctionDeclaration|FunctionDeclaration, FunctionDeclaration|FunctionDeclaration|FunctionDeclaration|FunctionDeclaration]

- changed:  src/cli/runWholeRepoDetector.ts:18-204 (window)
  existing: src/report/evidence.ts:1-61 (window)
  scores:   combined=0.404 token=0.179 stmt=1.000 call=0.000 size=0.326
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|InterfaceDeclaration]

- changed:  tools/bench/sweep.ts:241-249 (function)
  existing: src/scoring/scoreCandidate.ts:40-67 (function)
  scores:   combined=0.403 token=0.178 stmt=1.000 call=0.000 size=0.321
  evidence: calls=[] props=[] stmts=[VariableStatement|ReturnStatement, VariableStatement|VariableStatement, VariableStatement|VariableStatement|ReturnStatement]

- changed:  tools/bench/index.ts:163-181 (function)
  existing: src/diff/pipeline.ts:21-39 (function)
  scores:   combined=0.403 token=0.258 stmt=0.667 call=0.000 size=1.000
  evidence: calls=[] props=[] stmts=[ForOfStatement|ReturnStatement, VariableStatement|ForOfStatement, VariableStatement|ForOfStatement|ReturnStatement]

- changed:  src/cli/runDetector.ts:19-60 (window)
  existing: src/domain/posting.ts:1-13 (window)
  scores:   combined=0.403 token=0.608 stmt=0.429 call=0.000 size=0.310
  evidence: calls=[] props=[] stmts=[ImportDeclaration|InterfaceDeclaration, ImportDeclaration|InterfaceDeclaration|InterfaceDeclaration, InterfaceDeclaration|InterfaceDeclaration]

- changed:  tools/bench/index.ts:10-56 (window)
  existing: src/indexer/buildCodebaseIndex.ts:2-30 (window)
  scores:   combined=0.403 token=0.103 stmt=1.000 call=0.000 size=0.617
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|InterfaceDeclaration]

- changed:  tools/bench/formatJson.ts:25-44 (function)
  existing: src/features/internal/locateFragmentNode.ts:32-40 (block)
  scores:   combined=0.402 token=0.142 stmt=1.000 call=0.000 size=0.450
  evidence: calls=[] props=[] stmts=[VariableStatement|ReturnStatement]

- changed:  tools/bench/matchReport.ts:136-147 (function)
  existing: src/features/internal/locateFragmentNode.ts:255-261 (block)
  scores:   combined=0.402 token=0.109 stmt=1.000 call=0.000 size=0.583
  evidence: calls=[] props=[] stmts=[ForOfStatement|ReturnStatement, VariableStatement|ForOfStatement, VariableStatement|ForOfStatement|ReturnStatement]

- changed:  src/cli/runWholeRepoDetector.ts:18-204 (window)
  existing: src/cli/listBaseSources.ts:1-54 (window)
  scores:   combined=0.401 token=0.179 stmt=1.000 call=0.000 size=0.289
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|InterfaceDeclaration]

- changed:  tools/bench/sweep.ts:151-165 (function)
  existing: src/index_/invertedIndex.ts:22-36 (function)
  scores:   combined=0.362 token=0.125 stmt=0.667 call=0.063 size=1.000
  evidence: calls=[NEW:Map] props=[] stmts=[ForOfStatement|ReturnStatement, VariableStatement|ForOfStatement, VariableStatement|ForOfStatement|ReturnStatement]

- changed:  tools/bench/sweep.ts:151-165 (function)
  existing: src/features/internal/syntaxKindName.ts:22-36 (function)
  scores:   combined=0.349 token=0.097 stmt=0.667 call=0.053 size=1.000
  evidence: calls=[NEW:Map] props=[] stmts=[ForOfStatement|ReturnStatement, VariableStatement|ForOfStatement, VariableStatement|ForOfStatement|ReturnStatement]

- changed:  src/diff/collectDiff.ts:5-89 (window)
  existing: src/cli/listBaseSources.ts:2-59 (window)
  scores:   combined=0.332 token=0.331 stmt=0.250 call=0.280 size=0.682
  evidence: calls=[AWAIT_CALL:gitShow, CALL:isTypeScript, CALL:lower.endsWith] props=[PROP:config.exclude, PROP:config.globs] stmts=[FunctionDeclaration|FunctionDeclaration, ImportDeclaration|InterfaceDeclaration, InterfaceDeclaration|FunctionDeclaration]

- changed:  src/cli/args.ts:227-238 (function)
  existing: src/search/candidateSearch.ts:69-79 (function)
  scores:   combined=0.311 token=0.226 stmt=0.333 call=0.143 size=0.917
  evidence: calls=[CALL:out.push] props=[] stmts=[ForOfStatement|ReturnStatement, VariableStatement|ForOfStatement, VariableStatement|ForOfStatement|ReturnStatement]

- changed:  src/report/collapsePairs.ts:23-57 (function)
  existing: src/report/jsonReport.ts:41-66 (function)
  scores:   combined=0.310 token=0.351 stmt=0.269 call=0.071 size=0.743
  evidence: calls=[] props=[PROP:pair.baseFragment, PROP:pair.changedFragment] stmts=[ForOfStatement|VariableStatement, ForOfStatement|VariableStatement|VariableStatement, VariableStatement|ForOfStatement]

- changed:  src/report/jsonReport.ts:53-81 (function)
  existing: src/report/collapsePairs.ts:23-57 (function)
  scores:   combined=0.309 token=0.351 stmt=0.241 call=0.065 size=0.829
  evidence: calls=[] props=[PROP:pair.baseFragment, PROP:pair.changedFragment] stmts=[ForOfStatement|VariableStatement, ForOfStatement|VariableStatement|VariableStatement, VariableStatement|ForOfStatement]

- changed:  src/diff/collectDiff.ts:4-84 (window)
  existing: src/cli/listBaseSources.ts:1-54 (window)
  scores:   combined=0.301 token=0.277 stmt=0.267 call=0.217 size=0.667
  evidence: calls=[AWAIT_CALL:gitShow, CALL:isTypeScript, CALL:matchesAnyGlob] props=[PROP:config.exclude, PROP:config.globs] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|InterfaceDeclaration, ImportDeclaration|InterfaceDeclaration]

- changed:  tools/bench/sweep.ts:175-212 (function)
  existing: src/report/markdownReport.ts:20-38 (function)
  scores:   combined=0.295 token=0.376 stmt=0.235 call=0.120 size=0.500
  evidence: calls=[CALL:String, CALL:lines.join, CALL:lines.push] props=[] stmts=[ExpressionStatement|ExpressionStatement, ExpressionStatement|ExpressionStatement|ExpressionStatement, ExpressionStatement|ExpressionStatement|ExpressionStatement|ExpressionStatement]

- changed:  src/scoring/internal/jaccardWithIntersection.ts:13-35 (window)
  existing: src/scoring/internal/jaccard.ts:12-34 (function)
  scores:   combined=0.263 token=0.352 stmt=0.000 call=0.111 size=1.000
  evidence: calls=[CALL:large.has] props=[] stmts=[]

- changed:  src/scoring/internal/jaccardWithIntersection.ts:13-35 (window)
  existing: src/scoring/internal/intersection.ts:8-23 (function)
  scores:   combined=0.232 token=0.360 stmt=0.000 call=0.091 size=0.696
  evidence: calls=[CALL:large.has] props=[] stmts=[]

- changed:  src/scoring/scoreCandidate.ts:6-86 (window)
  existing: src/scoring/scoreCandidate.ts:76-98 (function)
  scores:   combined=0.197 token=0.367 stmt=0.000 call=0.111 size=0.284
  evidence: calls=[] props=[PROP:inputs.calls, PROP:inputs.statements, PROP:inputs.tokens] stmts=[]

## only in variant (6)

- changed:  tools/bench/loadFixtures.ts:63-66 (block)
  existing: src/diff/pipeline.ts:33-36 (block)
  scores:   combined=0.427 token=0.068 stmt=1.000 call=0.000 size=1.000
  evidence: calls=[] props=[] stmts=[VariableStatement|ExpressionStatement]

- changed:  tools/bench/matchReport.ts:18-102 (window)
  existing: src/report/jsonReport.ts:13-104 (window)
  scores:   combined=0.407 token=0.036 stmt=1.000 call=0.000 size=0.924
  evidence: calls=[] props=[] stmts=[FunctionDeclaration|FunctionDeclaration, FunctionDeclaration|FunctionDeclaration|FunctionDeclaration, InterfaceDeclaration|FunctionDeclaration]

- changed:  src/cli/runDetector.ts:19-60 (window)
  existing: src/domain/report.ts:1-46 (window)
  scores:   combined=0.403 token=0.457 stmt=0.429 call=0.000 size=0.913
  evidence: calls=[] props=[] stmts=[InterfaceDeclaration|InterfaceDeclaration, InterfaceDeclaration|InterfaceDeclaration|InterfaceDeclaration, InterfaceDeclaration|InterfaceDeclaration|InterfaceDeclaration|InterfaceDeclaration]

- changed:  src/diff/collectDiff.ts:44-84 (function)
  existing: src/cli/listBaseSources.ts:21-54 (function)
  scores:   combined=0.401 token=0.131 stmt=0.739 call=0.217 size=0.829
  evidence: calls=[AWAIT_CALL:gitShow, CALL:isTypeScript, CALL:matchesAnyGlob] props=[PROP:config.exclude, PROP:config.globs] stmts=[ExpressionStatement|VariableStatement, ExpressionStatement|VariableStatement|ForOfStatement, ExpressionStatement|VariableStatement|ForOfStatement|ReturnStatement]

- changed:  src/scoring/internal/jaccardWithIntersection.ts:28-30 (block)
  existing: src/scoring/internal/jaccard.ts:24-28 (block)
  scores:   combined=0.346 token=0.465 stmt=0.000 call=0.500 size=0.600
  evidence: calls=[CALL:large.has] props=[] stmts=[]

- changed:  src/scoring/internal/jaccardWithIntersection.ts:28-30 (block)
  existing: src/scoring/internal/intersection.ts:16-20 (block)
  scores:   combined=0.329 token=0.505 stmt=0.000 call=0.333 size=0.600
  evidence: calls=[CALL:large.has] props=[] stmts=[]

