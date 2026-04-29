# pair diff: baseline=default vs variant=tools/bench/configs/ngram-2-to-6.json

range: HEAD~10..HEAD

## only in baseline (6)

- changed:  src/cli/runDetector.ts:11-34 (window)
  existing: test/e2e/helpers/tempRepo.ts:1-18 (window)
  scores:   combined=0.607 token=0.581 stmt=1.000 call=0.000 size=0.750
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|ImportDeclaration]

- changed:  src/cli/runDetector.ts:11-34 (window)
  existing: src/diff/pipeline.ts:1-11 (window)
  scores:   combined=0.600 token=0.635 stmt=1.000 call=0.000 size=0.458
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|ImportDeclaration]

- changed:  tools/bench/sweep.ts:241-249 (function)
  existing: src/features/callPropertyFingerprint.ts:158-162 (block)
  scores:   combined=0.414 token=0.146 stmt=1.000 call=0.000 size=0.556
  evidence: calls=[] props=[] stmts=[VariableStatement|ReturnStatement, VariableStatement|VariableStatement, VariableStatement|VariableStatement|ReturnStatement]

- changed:  tools/bench/sweep.ts:241-249 (function)
  existing: src/features/callPropertyFingerprint.ts:133-137 (block)
  scores:   combined=0.410 token=0.135 stmt=1.000 call=0.000 size=0.556
  evidence: calls=[] props=[] stmts=[VariableStatement|ReturnStatement, VariableStatement|VariableStatement, VariableStatement|VariableStatement|ReturnStatement]

- changed:  src/scoring/scoreCandidate.ts:6-86 (window)
  existing: src/scoring/scoreCandidate.ts:76-98 (function)
  scores:   combined=0.197 token=0.367 stmt=0.000 call=0.111 size=0.284
  evidence: calls=[] props=[PROP:inputs.calls, PROP:inputs.statements, PROP:inputs.tokens] stmts=[]

- changed:  src/domain/fragment.ts:1-21 (window)
  existing: src/report/jsonReport.ts:96-104 (function)
  scores:   combined=0.157 token=0.085 stmt=0.000 call=0.400 size=0.429
  evidence: calls=[] props=[PROP:f.endLine, PROP:f.startLine] stmts=[]

## only in variant (17)

- changed:  tools/bench/scale.ts:38-41 (block)
  existing: src/search/candidateSearch.ts:94-97 (block)
  scores:   combined=0.453 token=0.133 stmt=1.000 call=0.000 size=1.000
  evidence: calls=[] props=[] stmts=[ExpressionStatement|ExpressionStatement]

- changed:  tools/bench/sweepSelf.ts:51-54 (block)
  existing: src/search/candidateSearch.ts:94-97 (block)
  scores:   combined=0.453 token=0.133 stmt=1.000 call=0.000 size=1.000
  evidence: calls=[] props=[] stmts=[ExpressionStatement|ExpressionStatement]

- changed:  tools/bench/matchReport.ts:18-102 (window)
  existing: src/report/jsonReport.ts:13-104 (window)
  scores:   combined=0.430 token=0.095 stmt=1.000 call=0.000 size=0.924
  evidence: calls=[] props=[] stmts=[FunctionDeclaration|FunctionDeclaration, FunctionDeclaration|FunctionDeclaration|FunctionDeclaration, InterfaceDeclaration|FunctionDeclaration]

- changed:  tools/bench/index.ts:163-181 (function)
  existing: src/features/internal/syntaxKindName.ts:22-36 (function)
  scores:   combined=0.423 token=0.111 stmt=1.000 call=0.000 size=0.789
  evidence: calls=[] props=[] stmts=[ForOfStatement|ReturnStatement, VariableStatement|ForOfStatement, VariableStatement|ForOfStatement|ReturnStatement]

- changed:  src/scoring/sizeCompatibility.ts:9-15 (function)
  existing: src/features/internal/locateFragmentNode.ts:66-82 (function)
  scores:   combined=0.409 token=0.170 stmt=1.000 call=0.000 size=0.412
  evidence: calls=[] props=[] stmts=[VariableStatement|ReturnStatement, VariableStatement|VariableStatement, VariableStatement|VariableStatement|ReturnStatement]

- changed:  tools/bench/index.ts:72-181 (window)
  existing: src/diff/gitRunner.ts:6-68 (window)
  scores:   combined=0.407 token=0.125 stmt=1.000 call=0.000 size=0.573
  evidence: calls=[] props=[] stmts=[FunctionDeclaration|FunctionDeclaration, FunctionDeclaration|FunctionDeclaration|FunctionDeclaration, FunctionDeclaration|FunctionDeclaration|FunctionDeclaration|FunctionDeclaration]

- changed:  tools/bench/metrics.ts:206-206 (block)
  existing: src/report/collapsePairs.ts:26-26 (block)
  scores:   combined=0.405 token=0.764 stmt=0.000 call=0.000 size=1.000
  evidence: calls=[] props=[] stmts=[]

- changed:  tools/bench/loadFixtures.ts:63-66 (block)
  existing: src/diff/collectDiff.ts:62-71 (block)
  scores:   combined=0.405 token=0.163 stmt=1.000 call=0.000 size=0.400
  evidence: calls=[] props=[] stmts=[VariableStatement|ExpressionStatement]

- changed:  src/cli/runDetector.ts:8-55 (window)
  existing: src/diff/pipeline.ts:1-11 (window)
  scores:   combined=0.405 token=0.605 stmt=0.467 call=0.000 size=0.229
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|ImportDeclaration]

- changed:  src/report/markdownReport.ts:1-112 (window)
  existing: src/features/normalizedTokenNgram.ts:7-159 (window)
  scores:   combined=0.403 token=0.074 stmt=1.000 call=0.000 size=0.732
  evidence: calls=[] props=[] stmts=[FunctionDeclaration|FunctionDeclaration, FunctionDeclaration|FunctionDeclaration|FunctionDeclaration, FunctionDeclaration|FunctionDeclaration|FunctionDeclaration|FunctionDeclaration]

- changed:  src/cli/runDetector.ts:8-55 (window)
  existing: test/e2e/helpers/tempRepo.ts:1-18 (window)
  scores:   combined=0.401 token=0.558 stmt=0.467 call=0.000 size=0.375
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|ImportDeclaration]

- changed:  tools/bench/setupRepo.ts:38-42 (block)
  existing: src/cli/runDetector.ts:72-77 (block)
  scores:   combined=0.400 token=0.342 stmt=0.600 call=0.000 size=0.833
  evidence: calls=[] props=[] stmts=[ExpressionStatement|ExpressionStatement, VariableStatement|ExpressionStatement, VariableStatement|ExpressionStatement|ExpressionStatement]

- changed:  src/diff/collectDiff.ts:4-84 (window)
  existing: src/cli/listBaseSources.ts:2-59 (window)
  scores:   combined=0.305 token=0.297 stmt=0.250 call=0.200 size=0.716
  evidence: calls=[AWAIT_CALL:gitShow, CALL:isTypeScript, CALL:matchesAnyGlob] props=[PROP:config.exclude, PROP:config.globs] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|InterfaceDeclaration, ImportDeclaration|InterfaceDeclaration]

- changed:  tools/bench/index.ts:42-45 (block)
  existing: src/index.ts:8-12 (function)
  scores:   combined=0.304 token=0.168 stmt=0.333 call=0.286 size=0.800
  evidence: calls=[CALL:process.exit, CALL:process.write] props=[] stmts=[ExpressionStatement|ExpressionStatement]

- changed:  tools/bench/sweep.ts:56-59 (block)
  existing: src/index.ts:8-12 (function)
  scores:   combined=0.304 token=0.168 stmt=0.333 call=0.286 size=0.800
  evidence: calls=[CALL:process.exit, CALL:process.write] props=[] stmts=[ExpressionStatement|ExpressionStatement]

- changed:  src/scoring/scoreCandidate.ts:1-86 (window)
  existing: src/scoring/scoreCandidate.ts:76-98 (function)
  scores:   combined=0.194 token=0.362 stmt=0.000 call=0.111 size=0.267
  evidence: calls=[] props=[PROP:inputs.calls, PROP:inputs.statements, PROP:inputs.tokens] stmts=[]

- changed:  src/domain/fragment.ts:19-21 (function)
  existing: src/report/jsonReport.ts:96-104 (function)
  scores:   combined=0.183 token=0.174 stmt=0.000 call=0.400 size=0.333
  evidence: calls=[] props=[PROP:f.endLine, PROP:f.startLine] stmts=[]

