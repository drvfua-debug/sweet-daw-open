# Sweet DAW Roadmap

Sweet DAW is an open-source, mobile-first browser DAW for repairing, mixing, and mastering AI-generated audio and stems.

The roadmap prioritizes reliability, transparent DSP behavior, privacy-conscious local processing, and contributor-friendly engineering over feature count.

## Principles

1. **Local first** — core audio processing should run in the browser whenever practical.
2. **Non-destructive by default** — imported audio should remain recoverable and edits should be reversible.
3. **Quality without loudness tricks** — automated processing should be evaluated with level-aware comparisons.
4. **Mobile is a first-class target** — Safari/PWA memory, CPU, touch, and offline-render constraints matter.
5. **Inspectable automation** — automated mix decisions should be bounded, explainable, and reversible.
6. **License-aware extensibility** — new DSP, models, samples, IRs, or binaries require explicit provenance and license review.

## Current release line — v0.1.x

### Reliability

- harden iPhone Safari / PWA playback and offline rendering,
- improve memory budgeting for large stems and long projects,
- expand import validation and recovery behavior,
- strengthen playback/export processing consistency.

### Audio quality and regression testing

- expand deterministic DSP tests,
- build redistributable golden-audio fixtures for regression testing,
- improve loudness-matched A/B validation,
- extend peak, density, stereo, and artifact safety checks.

### Contributor experience

- maintain issue and pull-request templates,
- document architecture and DSP boundaries,
- make focused test commands easier to discover,
- label beginner-friendly documentation and test tasks after the public issue tracker is active.

## Near term

### Mixing and reference workflows

- improve reference-quality validation before automated matching,
- refine masking and vocal-clarity decisions,
- improve peak-culprit reporting and density guidance,
- keep automated changes bounded and reversible.

### Repair

- improve spectral repair visualization and previews,
- add stronger validation around repair artifacts,
- expand tests for repair processors and STFT behavior.

### Performance

- reduce mobile memory pressure during analysis and export,
- improve chunked and streaming render paths,
- profile high-cost plug-ins and large-project UI updates.

### Accessibility and mobile UX

- improve keyboard and screen-reader semantics where practical,
- strengthen touch-target sizing and accidental-edit protection,
- improve status feedback for long-running local analysis/render operations.

## Later

- define a safer public extension interface for project-owned or permissively licensed DSP,
- expand portable project interoperability and export metadata,
- investigate additional browser-native audio analysis primitives,
- improve contributor automation for issue triage, test generation, review, release checks, and security maintenance.

## AI-assisted maintenance

The maintainer uses AI coding tools, including Codex, to assist with repository maintenance. Planned uses include:

- issue triage,
- focused test generation,
- pull-request review support,
- documentation maintenance,
- regression analysis,
- release verification,
- security-oriented code review.

AI tooling is a maintainer aid, not a runtime dependency of Sweet DAW.

## Non-goals

Sweet DAW is not currently trying to:

- replace every feature of a desktop DAW,
- depend on unofficial APIs from music-generation services,
- require proprietary cloud audio processing for the core workflow,
- bundle commercial sample libraries or unreviewed model weights,
- trade audio quality for maximum loudness or feature count.

Roadmap items are directional and may change as real users, contributors, browser constraints, and audio regression evidence accumulate.
