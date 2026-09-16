# Contributing to Sweet DAW

Thanks for considering a contribution to Sweet DAW.

Sweet DAW is a mobile-first browser audio workstation, so changes should be evaluated not only for correctness but also for audio quality, reversibility, browser compatibility, licensing, and mobile CPU/memory cost.

## Development setup

Requirements: Node.js 22 and npm.

```bash
npm ci
npm run dev
```

Before submitting a change, run:

```bash
npm run typecheck
npm run test
npm run build
```

For changes that touch AIMIX, reference matching, spatial processing, or mastering, also run:

```bash
npm run aimix:selftest
```

## Contribution rules

- Keep audio edits non-destructive unless a destructive operation is explicitly designed and clearly surfaced to the user.
- Preserve playback/export processing consistency unless a documented offline-quality exception is required.
- Prefer browser-native Web Audio and project-owned DSP for core audio features.
- Do not add GPL/AGPL code, external models, third-party IR packs, commercial samples, or WASM DSP packages without a separate license/provenance review.
- Do not commit user audio, credentials, tokens, `.env` files, build archives, or local backups.
- Keep iPhone Safari/PWA constraints in mind for memory, CPU, touch interaction, and offline rendering.
- Add focused tests for DSP, export, project serialization, automated mix decisions, or state changes where practical.
- Avoid changes that appear better only because they are louder; use level-aware comparisons for audio-quality work.

## AI-assisted contributions

AI coding tools are welcome as development assistants, including tools such as Codex. The human contributor remains responsible for:

- understanding the submitted change,
- verifying licensing and provenance,
- reviewing generated code for security and correctness,
- running the relevant tests,
- documenting audio-quality or compatibility trade-offs.

Do not submit large generated changes that have not been reviewed or that obscure provenance.

## Issues

For bugs, include:

- browser and version,
- operating system/device,
- a minimal reproduction path,
- whether the issue affects playback, editing, analysis, export, or project restore,
- whether the behavior is mobile-only or reproducible on desktop.

Do not attach private or copyrighted audio unless you have the right to share it publicly. Prefer synthetic or redistributable fixtures when possible.

## Pull requests

Keep each pull request focused. Describe:

1. what changed,
2. why it changed,
3. how it was verified,
4. any audio-quality, mobile, performance, security, or licensing trade-offs.

Contributions are accepted under the repository's MIT License unless explicitly stated otherwise.
