# Sweet DAW Phase 3-5 Report

## Overview

Phase 3-5 adds three conservative mix decision tools for browser-first Sweet DAW:

- Sweet Low-End Translator (`sweet-low-end-translator`)
- Ambience Seat Planner
- Sweet Tilt EQ (`sweet-tilt-eq`) and Single File Mastering Tilt Balance

The goal is not to add louder or heavier processing. The goal is to keep clean Suno-style stems clearer by translating risky low sub into audible bass harmonics, protecting the center from ambience smear, and using broad tilt moves only when a safe tonal correction is needed.

## Phase 3: Sweet Low-End Translator

`sweet-low-end-translator` is a track-only mobile-safe saturation plugin.

It does not boost 20-60Hz directly. Instead, it:

- high-passes below the unsafe sub floor
- creates light harmonic content around 80-250Hz
- applies a sub guard shelf
- blends the processed path with a low dry/wet mix
- keeps output trim conservative

The AutoPluginPlanner proposes it only for bass stems when:

- bass is the likely low-end owner
- stem purity is acceptable
- 20-60Hz is strong but 120-250Hz / 250-500Hz audibility is weak
- Low-End King and Peak Culprit are not blocking the move

## Phase 4: Ambience Seat Planner

`AmbienceSeatPlan` organizes which stems can use the existing `bus-ambience`.

Rules:

- lead vocal, bass, kick/foundation drums stay dry or nearly dry
- support instruments get a short quiet ambience only when clean enough
- dirty, room-washy, cymbal-heavy, low-end-risk, or peak-risk tracks are reduced or blocked
- no new heavy IR/HRTF/3D processing is added in this phase

The Mix Doctor summary now reports a short Ambience Seat recommendation such as:

`Ambience Seat: Vocal / Bass / Kick protected dry; N support track(s) sent; M blocked.`

## Phase 5: Sweet Tilt EQ

`sweet-tilt-eq` is a broad track/master EQ.

Positive tilt gently lowers low shelf and lifts high shelf around the pivot. Negative tilt does the opposite.

For Single File Mastering:

Processing order is now:

1. Safety HPF
2. Tilt Balance
3. Tone Cleanup
4. Harshness Guard
5. Glue Compression
6. Pre-Limiter Clipper
7. Target Loudness
8. True Peak Limiter

`Loudness Only` bypasses Tilt Balance.

The AutoPluginPlanner proposes master Tilt EQ only for safe reference/streaming tonal imbalance and only when Low-End King and Peak Culprit are not failing.

## Safety Notes

- Bass, low-dominant stems, and lead vocal remain center-protected.
- Ambience and width do not carry the low band.
- Damage Guard can weaken Low-End Translator and Tilt EQ if the predicted result becomes muddy, harsh, or peak-risky.
- Existing AIMIX Safe / Balanced / Dense behavior is preserved; these additions are narrow planner and plugin extensions.

## Verification

Added focused tests for:

- low-end translator DSP and plugin registry
- tilt EQ plugin registry and parameter resolver
- ambience seat planning
- auto plugin planner Phase 3-5 behavior
- Single File Mastering Tilt Balance
