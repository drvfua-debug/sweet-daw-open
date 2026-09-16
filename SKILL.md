---
name: sweet-daw-codex-skill
description: Use this skill when working on the Sweet DAW repository, especially AIMIX, Spatial v2 no-layer, AIMIX Glow, Vocal Clarity, Density Guard, Mastering, Reference matching, plugin UI, export, and Codex implementation tasks. Keep changes safe, minimal, and audio-quality focused.
---

# Sweet DAW Codex Skill

## Purpose

This skill defines the standing rules for working on Sweet DAW.

Sweet DAW is not a generic DAW clone. Its current product direction is:

```text
A mobile-first AI/Suno stem polish workstation that can make uploaded stems approach or exceed the direct/reference WAV by improving balance, clarity, placement, density, and final export safety.
```

The current intended workflow is:

```text
1. AIMIX
   Match the Reference / direct WAV perceptually.
   Handle gain, tonal balance, vocal clarity, masking cleanup, density, and peak headroom.

2. Spatial
   Reposition image, distance, width, and depth.
   Spatial v2 is no-layer: do not create new audio tracks/clips.

3. Mastering
   Final loudness, true peak safety, final polish, and export.
```

## Repository

Default repository:

```text
drvfua-debug/sweet-daw
```

Current working branch usually used for this work:

```text
codex/aimix-clip-intelligence
```

Before editing, confirm the active branch and HEAD.

```bash
git status --short
git branch --show-current
git rev-parse --short HEAD
```

If there are existing uncommitted changes, do not overwrite them. Report the state first.

## Backup rule

Before any substantial change, create a backup branch.

Use a descriptive backup name, for example:

```bash
git branch backup/before-aimix-glow-mastering-conflict-guard
```

If the name already exists, add a timestamp.

```bash
git branch backup/before-aimix-glow-mastering-conflict-guard-$(date +%Y%m%d-%H%M%S)
```

If possible, create a work branch.

```bash
git checkout -b codex/<short-task-name>
```

If the environment requires direct work on the current branch, backup is still mandatory.

## Rate-limit discipline

Use narrow reads and narrow searches.

Do not repeatedly scan the whole repo.

Prefer this pattern:

```text
1. Read the specific files named in the task.
2. Use rg only for exact symbols or feature names.
3. Modify the minimum number of files.
4. Avoid unrelated formatting.
5. Run typecheck first.
6. Run focused tests if possible.
7. Run full build only once near the end.
```

Allowed search style:

```bash
rg -n "AIMIX Glow|Vocal Clarity|Stem Air Layer|Spatial v2|generatedTracks|Reference Match|singleFileMastering|harshnessGuard|Density Guard" src scripts
```

Avoid broad searches unless the narrow search fails.

## Core audio philosophy

### Do not fake quality with loudness

Never make a change that only sounds better because it is louder.

For any enhancer, clarity, glow, air, or mastering feature, preserve or display level-matched A/B whenever possible.

### Clarity before Air

Do not treat 10kHz+ Air as a substitute for 2-10kHz clarity.

Preferred priority:

```text
1. Sub / low masking check
2. 500Hz-2kHz vocal body / core
3. 2kHz-5kHz vocal presence / intelligibility
4. 5kHz-10kHz clarity / consonants / attack
5. 10kHz-20kHz air / sheen, only after the above is safe
```

If 2-10kHz is weak, hold or reduce 10kHz+ Air recovery.

### Avoid fake air

Fake air means:

```text
The top end is brighter, but the vocal/instrument core is still weak.
The result becomes thin, sharp, noisy, or AI-like.
```

When fake air risk is high, prefer:

```text
- vocal body/presence recovery
- support masking cleanup
- de-esser/harshness guard moderation
- density and peak control
```

Do not simply boost high shelves.

### Pro mix direction

A pro mix is not just wide, loud, or bright.

Aim for:

```text
- vocal stays front and intelligible
- kick/bass/drum core stays centered and stable
- support instruments leave room for the lead
- low-mid does not build up
- high-end is clear but not sandy or brittle
- peak headroom allows loudness without crushing
- mono compatibility remains acceptable
```

## Spatial v2 no-layer rules

Spatial must not create audio layers.

Do not add or reintroduce:

```text
- Spatial L / Spatial R generated tracks
- generated spatial clips
- duplicated source audio for width
- layer EQ
- layer gain
- automatic doubling
- automatic chorus-like width
```

Spatial v2 should only reposition existing material:

```text
- track pan
- clip pan automation
- center protect
- low-end mono safety
- vocal front protection
- support instrument placement
- depth/distance metadata or safe EQ if already supported
```

Past generated AIMIX Spatial layers may still need cleanup/removal compatibility. Keep removal functions if they are used for legacy projects, but do not generate new layers.

Spatial success should be judged by:

```text
- vocal front remains stable
- bass/kick do not blur
- low-mid does not increase
- Side/Mid moves toward Reference without phase collapse
- LUFS does not drop significantly
- correlation remains safe
```

## AIMIX rules

AIMIX owns:

```text
- Reference/direct-WAV perceptual matching
- vocal clarity
- support masking cleanup
- density and crest management
- peak headroom preparation
- safe tonal adjustment before Spatial/Mastering
```

AIMIX must not:

```text
- blindly brighten the master
- over-widen vocal/bass/drums
- process Reference tracks as normal work tracks
- rely on mastering limiter to solve mix problems
```

Reference tracks are analysis targets only. They must not be mixed into normal playback/export unless explicitly intended by an existing supported workflow.

## AIMIX Glow rules

AIMIX Glow is an enhancer for clarity, breath, gloss, and safe air.

It should behave as:

```text
A subtle vocal-keyed or mix-keyed polish layer, not a loudness cheat and not a constant noise/air bed.
```

Important principles:

```text
- Output Match should remain available and preferably default-on.
- Recover and Gloss are more important than raw Air.
- Air must be guarded by sibilance, harshness, fake-air, and high-side risk.
- If no vocal sidechain exists, intensity should be reduced.
- Glow must not create large loudness jumps.
```

Recommended default direction:

```text
preset: AI Stem Rescue
amount: moderate
recover: moderate
backup air: low-to-moderate
tame: moderate-to-strong
outputMatch: true
```

## Glow / Mastering conflict rule

Avoid this conflict:

```text
AIMIX Glow restores presence/clarity/gloss
↓
Single File Mastering tone cleanup / harshness guard cuts the same range back down
```

When AIMIX Glow is active, or when Vocal Clarity Gate reports 2-10kHz shortage:

```text
- weaken mastering 3.5kHz presence smoothing
- weaken 6.5kHz / 9.2kHz harshness guard unless sibilance risk is high
- keep true peak safety
- keep loudness targeting conservative
```

Mastering should focus on:

```text
- final loudness
- true peak ceiling
- final safety
- subtle glue
```

Mastering should not undo AIMIX clarity work.

## Vocal Clarity Gate rules

Vocal Clarity Gate should keep these bands separate:

```text
20-60Hz
500Hz-2kHz
2kHz-5kHz
5kHz-10kHz
10kHz-20kHz
Side/Mid
```

It should explicitly warn about:

```text
- sub masking
- vocal body shortage
- presence shortage
- clarity shortage
- ultra-air shortage
- false air success
- side shortfall
```

False Air Success means:

```text
10kHz-20kHz looks acceptable or high, but 500Hz-10kHz remains weak.
```

In that case, do not count air recovery as successful.

## Support masking rules

When vocal clarity is short, do not only boost the vocal.

Also check support roles:

```text
guitar
synth
keys
music
loop
other
fx
```

Use light subtractive moves only when the support track likely masks the vocal.

Safe ranges:

```text
300Hz-600Hz: mud/body cleanup
800Hz-1.5kHz: vocal body masking cleanup
2kHz-5kHz: narrow presence pocket cleanup
```

Do not over-cut supports. Do not remove musical identity.

The `other` role is risky. Treat it as mixed content. Prefer cleanup over enhancement.

## Density / loudness rules

If LUFS cannot reach Reference because true peak is near the ceiling, do not simply push master gain.

Treat it as a peak / crest / density problem.

Preferred response:

```text
1. Identify likely peak culprits.
2. Apply or suggest light track-level density/peak control.
3. Preserve important attacks.
4. Avoid heavy master limiting.
```

Density Guard should remain gentle.

Avoid:

```text
- strong compression on every track
- loud master limiter as the main fix
- automatic loudRelease escalation
```

## Peak Culprit Report goal

When implementing the next phase, add a report before strong auto-processing.

Report should identify:

```text
- track name
- role
- peak risk
- RMS contribution
- crest risk
- suggested action
```

Example output:

```text
Peak Culprit Report
1. Drums   high transient risk / soft density recommended
2. Other   peak-heavy and low RMS / inspect or reduce
3. Vocal   consonant spike / check de-esser
4. Guitar  pick transient / mild smoothing
```

v1 can be report-only. Do not immediately apply aggressive processing.

## UI rules

Make workflow states visually clear.

For AIMIX / Spatial / Mastering tabs or buttons, active state must be obvious:

```text
[1 AIMIX ACTIVE] [2 SPATIAL] [3 MASTERING]
```

or equivalent.

UI explanations should reinforce:

```text
AIMIX = Reference match / clarity / density
Spatial = image and distance placement, no layers
Mastering = final loudness and true peak safety
```

AIMIX Glow UI should show:

```text
- preset
- output match status
- vocal sidechain/fallback status
- before/after LUFS
- true peak
- presence deficit
- air deficit
- fake air risk
- actions/warnings
```

## File and schema rules

Do not change `Project.schemaVersion` unless the task explicitly requires a migration.

Prefer adding optional top-level export metadata over changing the persistent project schema.

JSON/SWTD audit summaries may be optional. Restoring older files must continue to work.

## Plugin rules

Do not change PluginChain DSP casually.

When adding or changing a plugin:

```text
- add descriptor in pluginRegistry
- add type support if needed
- add editor fields
- add PluginChain node only if necessary
- keep mobile CPU cost low
- include bypass behavior
- include safe defaults
- add tests for finite output and level safety
```

For high-frequency processors:

```text
- guard sibilance
- guard fake air
- guard side high buildup
- avoid constant noise beds
- output match or output trim should be available
```

## Testing order

Run typecheck first:

```bash
npm run typecheck
```

Run focused tests if possible:

```bash
npm run test -- src/daw/auto/autoReferenceMixPipeline.test.ts src/daw/mix/reference/referenceQualityGate.test.ts src/daw/aimixGlow/aimixGlow.test.ts src/daw/mastering/singleFileMastering.test.ts src/daw/aimixSpatial/aimixSpatialEngine.test.ts
```

If path-based tests are unsupported, run the full test suite once:

```bash
npm run test
```

Run build once near the end:

```bash
npm run build
```

Do not repeatedly run expensive tests unless required to isolate a failure.

## Manual listening checks

For any AIMIX / Glow / Mastering change, compare at matched loudness:

```text
AIMIX only
AIMIX + Glow
AIMIX + Glow + Mastering
```

Listen for:

```text
- vocal front and intelligibility
- painful consonants
- fake air / sandy top
- snare and hats thinning out
- low-mid buildup
- bass/kick blur
- density without flattening
- mono safety
```

## Reporting format

When finished, report concisely in this structure:

```text
Backup:
- ...

Changed files:
- ...

Implemented:
- ...

Not changed:
- Spatial v2 no-layer behavior
- Project schemaVersion
- Plugin DSP, unless explicitly changed
- Reference handling safety

Checks:
- npm run typecheck: pass/fail
- npm run test: pass/fail/not run
- npm run build: pass/fail/not run

Notes:
- audio quality risks
- recommended listening checks
- any remaining limitations
```

## Current recommended next task

Recommended next implementation theme:

```text
AIMIX Glow / Mastering Conflict Guard + Peak Culprit Report v1
```

Primary goals:

```text
1. Prevent Mastering from undoing AIMIX Glow clarity.
2. Weaken tone cleanup / harshness guard when Glow or 2-10kHz shortage requires it.
3. Add Peak Culprit Report v1.
4. Improve Glow same-LUFS A/B visibility.
```

Do this before adding stronger Air, stronger limiter, or more spatial features.
