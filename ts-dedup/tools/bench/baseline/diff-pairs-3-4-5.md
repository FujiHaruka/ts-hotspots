# pair diff: baseline=default vs variant=tools/bench/configs/ngram-3-4-5.json

range: HEAD~10..HEAD

## only in baseline (9)

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

- changed:  src/indexer/extractFragments.ts:22-175 (function)
  existing: src/features/internal/locateFragmentNode.ts:115-170 (function)
  scores:   combined=0.364 token=0.211 stmt=0.750 call=0.091 size=0.364
  evidence: calls=[CALL:node.getEnd, CALL:node.getStart, CALL:ts.forEachChild] props=[] stmts=[ExpressionStatement|ReturnStatement, VariableStatement|ExpressionStatement, VariableStatement|ExpressionStatement|ReturnStatement]

- changed:  src/indexer/extractFragments.ts:192-248 (window)
  existing: src/features/internal/locateFragmentNode.ts:172-189 (function)
  scores:   combined=0.311 token=0.524 stmt=0.000 call=0.348 size=0.316
  evidence: calls=[] props=[PROP:node.kind, PROP:node.statements, PROP:ts.Block] stmts=[]

- changed:  src/diff/collectDiff.ts:5-89 (window)
  existing: src/report/jsonReport.ts:13-104 (window)
  scores:   combined=0.275 token=0.102 stmt=0.462 call=0.019 size=0.924
  evidence: calls=[] props=[PROP:f.filePath] stmts=[FunctionDeclaration|FunctionDeclaration, InterfaceDeclaration|FunctionDeclaration, InterfaceDeclaration|FunctionDeclaration|FunctionDeclaration]

- changed:  src/indexer/extractFragments.ts:22-175 (function)
  existing: src/features/internal/locateFragmentNode.ts:84-113 (function)
  scores:   combined=0.275 token=0.157 stmt=0.500 call=0.212 size=0.195
  evidence: calls=[CALL:node.getEnd, CALL:node.getStart, CALL:ts.forEachChild] props=[PROP:node.kind, PROP:ts.*, PROP:ts.SyntaxKind] stmts=[ExpressionStatement|ReturnStatement, VariableStatement|ExpressionStatement, VariableStatement|ExpressionStatement|ReturnStatement]

- changed:  src/scoring/scoreCandidate.ts:6-86 (window)
  existing: src/scoring/scoreCandidate.ts:76-98 (function)
  scores:   combined=0.197 token=0.367 stmt=0.000 call=0.111 size=0.284
  evidence: calls=[] props=[PROP:inputs.calls, PROP:inputs.statements, PROP:inputs.tokens] stmts=[]

- changed:  src/domain/fragment.ts:1-21 (window)
  existing: src/report/jsonReport.ts:96-104 (function)
  scores:   combined=0.157 token=0.085 stmt=0.000 call=0.400 size=0.429
  evidence: calls=[] props=[PROP:f.endLine, PROP:f.startLine] stmts=[]

## only in variant (19)

- changed:  tools/bench/index.ts:163-181 (function)
  existing: src/features/internal/syntaxKindName.ts:22-36 (function)
  scores:   combined=0.421 token=0.105 stmt=1.000 call=0.000 size=0.789
  evidence: calls=[] props=[] stmts=[ForOfStatement|ReturnStatement, VariableStatement|ForOfStatement, VariableStatement|ForOfStatement|ReturnStatement]

- changed:  src/report/dropLowSemanticEvidence.ts:24-32 (block)
  existing: src/features/internal/typeRanges.ts:65-70 (function)
  scores:   combined=0.417 token=0.125 stmt=1.000 call=0.000 size=0.667
  evidence: calls=[] props=[] stmts=[IfStatement|ExpressionStatement]

- changed:  tools/bench/metrics.ts:206-206 (block)
  existing: src/report/collapsePairs.ts:26-26 (block)
  scores:   combined=0.415 token=0.788 stmt=0.000 call=0.000 size=1.000
  evidence: calls=[] props=[] stmts=[]

- changed:  src/cli/runDetector.ts:8-55 (window)
  existing: test/e2e/helpers/tempRepo.ts:1-18 (window)
  scores:   combined=0.408 token=0.576 stmt=0.467 call=0.000 size=0.375
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|ImportDeclaration]

- changed:  tools/bench/index.ts:72-181 (window)
  existing: src/diff/gitRunner.ts:6-68 (window)
  scores:   combined=0.408 token=0.126 stmt=1.000 call=0.000 size=0.573
  evidence: calls=[] props=[] stmts=[FunctionDeclaration|FunctionDeclaration, FunctionDeclaration|FunctionDeclaration|FunctionDeclaration, FunctionDeclaration|FunctionDeclaration|FunctionDeclaration|FunctionDeclaration]

- changed:  src/cli/runDetector.ts:8-55 (window)
  existing: src/diff/pipeline.ts:1-11 (window)
  scores:   combined=0.406 token=0.607 stmt=0.467 call=0.000 size=0.229
  evidence: calls=[] props=[] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|ImportDeclaration]

- changed:  tools/bench/loadFixtures.ts:63-66 (block)
  existing: src/diff/collectDiff.ts:62-71 (block)
  scores:   combined=0.405 token=0.162 stmt=1.000 call=0.000 size=0.400
  evidence: calls=[] props=[] stmts=[VariableStatement|ExpressionStatement]

- changed:  src/report/markdownReport.ts:1-112 (window)
  existing: src/features/normalizedTokenNgram.ts:7-159 (window)
  scores:   combined=0.404 token=0.076 stmt=1.000 call=0.000 size=0.732
  evidence: calls=[] props=[] stmts=[FunctionDeclaration|FunctionDeclaration, FunctionDeclaration|FunctionDeclaration|FunctionDeclaration, FunctionDeclaration|FunctionDeclaration|FunctionDeclaration|FunctionDeclaration]

- changed:  src/cli/listBaseSources.ts:1-19 (window)
  existing: src/domain/posting.ts:1-13 (window)
  scores:   combined=0.403 token=0.587 stmt=0.333 call=0.000 size=0.684
  evidence: calls=[] props=[] stmts=[ImportDeclaration|InterfaceDeclaration, ImportDeclaration|InterfaceDeclaration|InterfaceDeclaration, InterfaceDeclaration|InterfaceDeclaration]

- changed:  src/scoring/sizeCompatibility.ts:9-15 (function)
  existing: src/features/internal/locateFragmentNode.ts:66-82 (function)
  scores:   combined=0.401 token=0.149 stmt=1.000 call=0.000 size=0.412
  evidence: calls=[] props=[] stmts=[VariableStatement|ReturnStatement, VariableStatement|VariableStatement, VariableStatement|VariableStatement|ReturnStatement]

- changed:  src/diff/collectDiff.ts:4-84 (window)
  existing: src/cli/listBaseSources.ts:2-59 (window)
  scores:   combined=0.313 token=0.316 stmt=0.250 call=0.200 size=0.716
  evidence: calls=[AWAIT_CALL:gitShow, CALL:isTypeScript, CALL:matchesAnyGlob] props=[PROP:config.exclude, PROP:config.globs] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|InterfaceDeclaration, ImportDeclaration|InterfaceDeclaration]

- changed:  tools/bench/index.ts:42-45 (block)
  existing: src/index.ts:8-12 (function)
  scores:   combined=0.309 token=0.179 stmt=0.333 call=0.286 size=0.800
  evidence: calls=[CALL:process.exit, CALL:process.write] props=[] stmts=[ExpressionStatement|ExpressionStatement]

- changed:  tools/bench/sweep.ts:56-59 (block)
  existing: src/index.ts:8-12 (function)
  scores:   combined=0.309 token=0.179 stmt=0.333 call=0.286 size=0.800
  evidence: calls=[CALL:process.exit, CALL:process.write] props=[] stmts=[ExpressionStatement|ExpressionStatement]

- changed:  src/indexer/extractFragments.ts:1-217 (window)
  existing: src/features/normalizedTokenNgram.ts:2-159 (window)
  scores:   combined=0.306 token=0.250 stmt=0.429 call=0.022 size=0.728
  evidence: calls=[] props=[PROP:sourceFile.text, PROP:ts.SyntaxKind] stmts=[FunctionDeclaration|FunctionDeclaration, ImportDeclaration|FunctionDeclaration, ImportDeclaration|FunctionDeclaration|FunctionDeclaration]

- changed:  src/indexer/extractFragments.ts:3-248 (window)
  existing: src/features/internal/locateFragmentNode.ts:1-271 (window)
  scores:   combined=0.304 token=0.287 stmt=0.242 call=0.129 size=0.908
  evidence: calls=[CALL:node.getEnd, CALL:node.getStart, CALL:ts.forEachChild] props=[PROP:node.body, PROP:node.kind, PROP:node.statements] stmts=[FunctionDeclaration|FunctionDeclaration, FunctionDeclaration|FunctionDeclaration|FunctionDeclaration, FunctionDeclaration|FunctionDeclaration|FunctionDeclaration|FunctionDeclaration]

- changed:  src/diff/pipeline.ts:2-50 (window)
  existing: src/cli/runDetector.ts:9-157 (window)
  scores:   combined=0.266 token=0.359 stmt=0.273 call=0.040 size=0.329
  evidence: calls=[NEW:Map] props=[PROP:file.filePath] stmts=[ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration, ImportDeclaration|ImportDeclaration|ImportDeclaration|InterfaceDeclaration]

- changed:  tools/bench/formatMarkdown.ts:49-106 (function)
  existing: src/report/markdownReport.ts:20-38 (function)
  scores:   combined=0.221 token=0.351 stmt=0.104 call=0.083 size=0.328
  evidence: calls=[CALL:String, CALL:lines.join, CALL:lines.push] props=[] stmts=[ExpressionStatement|ExpressionStatement, ExpressionStatement|ExpressionStatement|ExpressionStatement, ExpressionStatement|ExpressionStatement|ExpressionStatement|ExpressionStatement]

- changed:  src/scoring/scoreCandidate.ts:1-86 (window)
  existing: src/scoring/scoreCandidate.ts:76-98 (function)
  scores:   combined=0.202 token=0.384 stmt=0.000 call=0.111 size=0.267
  evidence: calls=[] props=[PROP:inputs.calls, PROP:inputs.statements, PROP:inputs.tokens] stmts=[]

- changed:  src/domain/fragment.ts:19-21 (function)
  existing: src/report/jsonReport.ts:96-104 (function)
  scores:   combined=0.175 token=0.153 stmt=0.000 call=0.400 size=0.333
  evidence: calls=[] props=[PROP:f.endLine, PROP:f.startLine] stmts=[]

