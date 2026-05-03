# Dogfooding session prompt

A reusable prompt for dogfooding ts-hotspots against an arbitrary TypeScript project. Fill in the target fields and paste the block below into a coding agent running inside the ts-hotspots repo.

The goal is to collect fresh observations on the **default output** each time, unbiased by prior sessions' conclusions.

---

## Prompt (copy from here)

Run one dogfooding session of ts-hotspots against the target below.

- **Target project (absolute path)**: `<<fill in>>`
- **Short slug for file names**: `<<fill in — e.g. my-app, lib-xyz>>`

You are working inside the ts-hotspots repo. ts-hotspots is a CLI that statically analyzes a TypeScript project and returns refactor-starting coordinates (`file:line`) as JSON. Read `docs/requirements.md` first to internalize the design intent and the axis system (quality / leverage categories, hotspot candidate gate logic) before observing.

### What to do

1. **Run the tool against the target.** From the ts-hotspots repo:
   ```
   node src/index.ts comp <<target path>> --format json > /tmp/ts-hotspots-<<slug>>-functions.json
   ```
   The default output contains only `hotspots` — the union of "co-occurrence ≥ 3 axes" and "discriminative axis top-3 rescue", with each candidate carrying its hit axes and raw values inline. This is the primary signal and is what we are evaluating.

   `<<target path>>` is a directory inside a git working tree; sources are picked up via `git ls-files`. Untracked files are skipped — commit before analyzing. Handle noise by tightening `--exclude` globs.

2. **Validate `hotspots` against real code.** Read the candidates top-down and open each coordinate. Judge whether each candidate's `axes[]` and `metrics` (raw values on hit axes) line up with an actual code smell. Classify into at least:

   - **True signal**: the coordinate is a legitimate refactor starting point.
   - **Structural false positive**: saturation from many identical values, interface-implementation boilerplate, accumulator-loop saturation (`let out = ""; while (...) { out += ... }` patterns inflate `mutationSiteCount` without indicating mutable state spread), etc. — structural facts, not code problems.
   - **Idiomatic false positive**: an axis saturated by a library-specific idiom in this project (e.g. `asKindOrThrow`, ORM query builders, certain React hooks).
   - **Boundary false positive**: external I/O, JSON parsing, CLI argument handling, and other boundaries where `any` / assertions are unavoidable.
   - **Barrel / shared-types high fan-in**: used as intended, not a problem.

   If this project has its own saturation pattern, name and record it. Do not force-fit it into an existing category.

3. **Assess the candidate gate and rescue net.** Look at the distribution of the `source` field (`coOccurrence` / `discriminativeTop` / `both`) to separate what co-occurrence catches from what the discriminative top-3 rescue catches. Note any coordinates you felt should have been candidates but were not (rescue-net misses).

4. **Write meta-observations** to `/tmp/ts-hotspots-dogfooding-<<slug>>.md` with these sections (do not commit it to the repo; treat it as a throwaway scratchpad):
   - Context (target scale, light characterization — abstract away anything confidential)
   - Key findings (effectiveness of axis co-occurrence / false-positive patterns / how the gate and rescue behave)
   - Reconsiderations of candidate logic or axis taxonomy (category assignment, gate thresholds, rescue conditions — only if you see validity problems)
   - Secondary implications (axis variance, barrel handling, etc.)
   - Next-action candidates
   - Non-goals

   **Writing rules**:
   - **Do not write specific refactor recommendations for the target code.** This is feedback on the tool, not a refactor proposal for the target project.
   - **Stay meta.** Individual coordinates appear only as minimal examples of false/true signal (file-name level; don't cite line numbers).
   - **Evaluate whether the output actually accelerated the agent's exploration.** Keep returning to the tool's reason for existing.

5. **Share the observation notes in chat** by pasting the `/tmp` file contents back into the conversation. No commit to the ts-hotspots repo.

### One-line reminder of the tool's purpose

ts-hotspots hands an agent **coordinates and evidence for "where reading yields the most hotspots"**. The evaluation axis is always the same: **does the output actually concentrate true refactor-starting signal for this project?** Some false positives are tolerable (the agent can read the raw code and decide). What is fatal is **true signal drowning in noise or failing to surface at all** — prioritize finding those patterns.

### Subcommand-specific false-positive categories

The Step 2 categories above (Structural / Idiomatic / Boundary / Barrel-or-shared-types high fan-in) were named while dogfooding `comp` and apply directly to it. Other subcommands have their own recurring false-positive shapes, recorded below as a stable vocabulary so successive sessions classify against the same names instead of re-deriving them. When you observe a fresh pattern that does not fit any of these, name and record it in the observation notes — and consider whether it deserves a permanent slot here.

#### `comp`
- Structural FP / Idiomatic FP / Boundary FP / Barrel or shared-types high fan-in (defined inline in Step 2 above).

#### `coch`
- **Same-dir sibling lockstep**: files in the same directory that import each other and naturally co-evolve. True coupling but trivially derivable from the import graph; surfacing it does little to accelerate exploration.
- **Central-file amplification**: a hub file (DB schema, root tRPC router, top-level `index.ts`) appears in N displayed pairs with N different partners. Each pair is individually defensible; collectively the agent learns the same fact N times.
- **Cluster-as-pairs**: when M files mutually co-change, the C(M, 2) pairs compete for top-N display slots, so one logical insight occupies multiple rows. The display layer collapses dense clusters into a single row, but residual pair-only fragments still surface as the long tail.
- **Floor-of-window lift inflation**: pairs at `support === minSupport` whose constituent files barely change at all (`min(changesOfA, changesOfB) === support`) produce mathematically-correct but evidence-thin lift values that look impressive in isolation. The score sort already deprioritises them; this is a reader-side caveat, not a ranking bug.

#### `arch` / `dup`
None recorded yet. Add as future dogfooding sessions surface stable patterns.

### Out of scope

- Actual refactor / fix proposals for the target project.
- Bug fixes or new axes for the tool itself. Record improvement ideas in the observation notes; do not implement.
