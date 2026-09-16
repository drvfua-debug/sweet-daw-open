---
name: sweet-daw-codex-skill
description: Guidance for AI coding agents and contributors working on Sweet DAW. Keep changes safe, reviewable, license-aware, mobile-conscious, and audio-quality focused.
---

# Sweet DAW Agent Guide

## Purpose

This file gives coding agents such as Codex the standing engineering rules for contributing to Sweet DAW.

Sweet DAW is an open-source, mobile-first browser audio workstation for repairing, mixing, and mastering AI-generated audio and stems. Core audio processing is designed to remain local to the browser.

Default repository:

```text
drvfua-debug/sweet-daw-open
```

Default branch:

```text
main
```

Use a focused feature or `codex/` branch for implementation work. Do not overwrite unrelated changes.

## Product direction

Sweet DAW is not trying to reproduce every feature of a desktop DAW. Its current focus is:

```text
Import
→ BPM Lock when needed
→ Repair / Arrange / Mix
→ AIMIX / Mix Doctor / Glow
→ Spatial
→ Mastering
→ Export
```

The engineering priority is reliable post-production for generated or imported audio under browser and mobile constraints.

## Core rules

### 1. Keep audio work non-destructive

Do not overwrite source audio. Preserve project recovery and reversible editing whenever practical.

### 2. Do not fake quality with loudness

Never treat a louder result as automatically better. Enhancer, clarity, mastering, and reference-matching changes should be evaluated at matched or comparable loudness when practical.

### 3. Protect mobile/browser constraints

Assume iPhone Safari/PWA is a first-class target. Consider:

- memory pressure,
- CPU cost,
- long-running offline renders,
- touch interaction,
- AudioContext lifecycle,
- browser decode/export limitations.

### 4. Keep automation bounded and inspectable

AIMIX, Mix Doctor, spatial planning, and mastering should prefer conservative, explainable changes over hidden or extreme processing.

### 5. Preserve playback/export consistency

Realtime preview and offline export should use compatible processing rules. A higher-quality offline implementation is acceptable when explicitly documented and tested.

### 6. Respect licensing and provenance

Do not add any of the following without explicit review:

- GPL/AGPL DSP or DAW code,
- external model weights,
- commercial sample libraries,
- third-party IR packs,
- native plug-in binaries,
- ffmpeg/Rubber Band or other WASM DSP bundles,
- copied code with unclear provenance.

Prefer browser-native Web Audio primitives, project-owned code, and permissively licensed dependencies.

## Audio quality principles

### Clarity before air

Do not use extreme high-frequency boost to compensate for weak vocal or instrument definition.

Evaluate problems in this order:

1. sub/low masking,
2. 500 Hz–2 kHz body/core,
3. 2–5 kHz presence/intelligibility,
4. 5–10 kHz clarity/attack,
5. 10–20 kHz air/sheen.

### Preserve the center

Avoid unnecessary widening of lead vocals, kick, bass, and other center-critical material. Low-end stability and mono compatibility matter more than maximum width.

### Fix mix problems before master problems

If loudness is limited by peaks or crest factor, identify likely track-level causes before applying stronger master limiting.

### Reference tracks are analysis targets

Reference audio must not enter normal playback/export routing unless an existing supported workflow explicitly requires it.

## Spatial rules

Spatial processing should reposition existing material rather than creating hidden duplicate audio layers.

Avoid automatically generating:

- left/right duplicate tracks,
- hidden chorus/doubling layers,
- extra audio clips solely for width.

Prefer:

- pan,
- clip pan automation,
- center protection,
- low-end mono safety,
- bounded width/depth decisions.

## Plug-in rules

When adding or changing a plug-in:

- register it explicitly,
- provide safe defaults and bypass behavior,
- keep mobile CPU cost reasonable,
- test finite output and level safety,
- document intentional realtime/offline differences,
- avoid unrelated DSP refactors.

High-frequency processors should guard against sibilance, brittle top end, and side-channel buildup.

## Project and schema rules

Do not change `Project.schemaVersion` casually. A schema change requires an explicit migration plan and backward-compatibility review.

Prefer optional metadata additions over breaking persistent project structures.

`.swtd` and JSON restore paths should remain compatible with supported older public files whenever practical.

## Security and privacy rules

Do not commit:

- credentials or tokens,
- `.env` files,
- private/user audio,
- commercial samples,
- local backups,
- build archives.

A change that uploads audio remotely, handles service credentials, adds analytics involving audio content, or introduces a remote processing API must be explicitly documented and security-reviewed.

## Working discipline

Before editing:

```bash
git status --short
git branch --show-current
git rev-parse --short HEAD
```

Prefer narrow reads and searches. Modify the minimum number of files required for the task and avoid unrelated formatting.

Recommended sequence:

```text
1. Inspect the specific code path.
2. Write or update focused tests.
3. Implement the smallest safe change.
4. Run typecheck.
5. Run focused tests or the full suite once.
6. Run build near the end.
7. Run AIMIX self-test for mix/mastering changes.
```

## Verification

Minimum public verification:

```bash
npm run typecheck
npm run test
npm run build
```

For AIMIX, reference, spatial, or mastering changes:

```bash
npm run aimix:selftest
```

When redistributable golden audio fixtures are available:

```bash
npm run audio:golden
```

## Manual listening checks

For audio-processing changes, compare at sensible matched levels and listen for:

- vocal front and intelligibility,
- painful consonants,
- fake or sandy air,
- weakened transients,
- low-mid buildup,
- kick/bass blur,
- over-compression,
- stereo/mono instability,
- render artifacts.

## Reporting

When an agent completes a task, report:

```text
Changed files:
- ...

Implemented:
- ...

Checks:
- typecheck: pass/fail/not run
- tests: pass/fail/not run
- build: pass/fail/not run
- AIMIX self-test: pass/fail/not run

Risks / limitations:
- ...
```

Do not claim audio quality improvements that were not supported by tests, metrics, or listening evidence.

## AI tooling is not a runtime dependency

Codex and other AI coding tools may help maintain Sweet DAW, but the application itself should remain usable without an AI API. Agent-generated contributions are held to the same review, test, security, and licensing requirements as human-written contributions.
