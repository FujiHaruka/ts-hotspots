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
   node src/index.ts <<target path>> > /tmp/ts-hotspots-<<slug>>-functions.json
   ```
   The default output contains only `hotspots` — the union of "co-occurrence ≥ 3 axes" and "discriminative axis top-3 rescue", with each candidate carrying its hit axes and raw values inline. This is the primary signal and is what we are evaluating.

   If the target has no `tsconfig.json` at the root (e.g. a monorepo), pass the tsconfig you want to analyze directly. Handle errors (e.g. exclude out-of-scope paths with `--exclude`).

2. **Validate `hotspots` against real code.** Read the candidates top-down and open each coordinate. Judge whether each candidate's `axes[]` and `metrics` (raw values on hit axes) line up with an actual code smell. Classify into at least:

   - **True signal**: the coordinate is a legitimate refactor starting point.
   - **Structural false positive**: saturation from many identical values, interface-implementation boilerplate, etc. — structural facts, not code problems.
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

### Out of scope

- Actual refactor / fix proposals for the target project.
- Bug fixes or new axes for the tool itself. Record improvement ideas in the observation notes; do not implement.
