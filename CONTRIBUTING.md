# Contributing to Sweet DAW

Thanks for considering a contribution.

## Development setup

```bash
npm install
npm run dev
```

Before submitting a change, run:

```bash
npm run typecheck
npm run test
npm run build
```

For changes that touch AIMIX or mastering, also run:

```bash
npm run aimix:selftest
```

## Contribution rules

- Keep audio edits non-destructive.
- Preserve playback/export processing parity unless a documented exception is required.
- Prefer browser-native Web Audio and project-owned DSP for core audio features.
- Do not add GPL/AGPL code, external models, third-party IR packs, or WASM DSP packages without a separate license review.
- Do not commit user audio, commercial samples, credentials, tokens, `.env` files, build ZIPs, or local backups.
- Keep mobile Safari/PWA constraints in mind for memory, CPU, touch interaction, and offline rendering.
- Add focused tests for DSP, export, project-serialization, or state changes where practical.

## Pull requests

Keep each pull request focused. Describe:

1. what changed,
2. why it changed,
3. how it was verified,
4. any audio-quality, mobile, performance, or licensing trade-offs.

Contributions are accepted under the repository's MIT License unless explicitly stated otherwise.
