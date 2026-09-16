# Sweet DAW

> Open-source, mobile-first audio post-production for AI-generated stems — in the browser, with core audio processing kept local.

[![CI](https://github.com/drvfua-debug/sweet-daw-open/actions/workflows/ci.yml/badge.svg)](https://github.com/drvfua-debug/sweet-daw-open/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Sweet DAW is an MIT-licensed browser DAW focused on repairing, arranging, mixing, and mastering AI-generated audio and stems. It is designed for phone-first workflows, including iPhone Safari / PWA use, while remaining useful on desktop browsers.

The project is generator-agnostic: it works with user-provided WAV audio and does not require an account, credential, or unofficial API integration with any music-generation service. Core audio processing is designed to run locally in the browser rather than uploading source audio to a remote processing service.

## Why Sweet DAW?

Generative music tools can create songs and stems quickly, but the last mile still matters: timing, masking, vocal clarity, stereo placement, repair, loudness, and export safety. Those tasks are usually handled in a desktop DAW or another cloud service.

Sweet DAW explores a different path: an open, browser-native post-production layer for generative audio that is portable, inspectable, privacy-conscious, and usable from a phone.

The project is especially interested in the engineering space between:

- generative music output and conventional DAW workflows,
- browser-native Web Audio DSP and desktop-class post-production concepts,
- automated mix decisions and reversible human control,
- mobile constraints and reliable offline rendering.

## Highlights

- **Mobile-first timeline** — import and arrange up to 12 stems, with clip move, trim, split, duplicate, delete, and track operations.
- **Non-destructive workflow** — original audio is not overwritten; edits and exports create new project/audio outputs.
- **BPM Lock** — browser-side tempo analysis and bounded material rendering for eligible full-length stems.
- **Repair tools** — spectral/repair analysis, repair planning, previews, and processing modules.
- **AIMIX** — role-aware mix proposals, A/B evaluation, bounded adjustments, FIX, and polish stages.
- **Mix Doctor / Reference analysis** — analysis-driven decisions for masking, clarity, density, placement, and reference deltas.
- **Spatial processing** — controlled pan, width, depth, center protection, and low-end safety without generating hidden duplicate tracks.
- **Built-in DSP** — EQ, compressor, limiter, saturation, peak maximization, delay, reverb, de-essing, gating, modulation, transient shaping, multiband processing, and more.
- **Mastering and export safety** — loudness/peak planning, artifact guards, streaming/offline rendering paths, and WAV export.
- **Portable projects** — `.swtd` packages can include project state and audio assets; JSON export is available for metadata-only workflows.

## Local-first audio processing

Sweet DAW's core audio path is implemented with browser Web Audio primitives and project-owned TypeScript/JavaScript DSP.

The open-source snapshot intentionally does **not** bundle:

- model weights,
- commercial samples,
- external IR libraries,
- native VST/AUv3 binaries,
- third-party WASM DSP binaries,
- user audio,
- credentials or `.env` files.

A future change that introduces remote audio upload, credential handling, external models, or copyleft DSP dependencies must be explicitly documented and reviewed before release.

## Processing workflow

```text
Import
  ↓
BPM Lock (when needed)
  ↓
Repair / Arrange / Mix
  ↓
AIMIX / Mix Doctor / Glow
  ↓
Spatial
  ↓
Mastering
  ↓
WAV / project export
```

### BPM Lock

BPM Lock is an offline material-render tool rather than an insert plug-in. It analyzes a rhythmic reference in the browser, builds a shared tempo map, and renders corrected material before downstream mix processing. This keeps timeline changes ahead of EQ, dynamics, spatial processing, and mastering.

### AIMIX

AIMIX is a decision layer for improving balance, masking, vocal clarity, density, peak headroom, and reference alignment without treating louder as automatically better.

The intended workflow is:

1. proposal,
2. level-aware A/B evaluation,
3. manual adjustment,
4. FIX to commit the chosen project changes,
5. optional polish.

### Playback and export

The engine is designed to keep realtime playback and offline export behavior aligned. Some processors intentionally use a lighter realtime preview and a higher-quality offline pass where appropriate, such as lookahead peak processing during final export.

## Architecture

Sweet DAW is a client-side Next.js / React application built around Web Audio.

```text
src/audio/   audio engine, DSP, analysis, repair, export
src/daw/     project model, automated mix decisions, mastering, spatial logic
src/ui/      mobile-first DAW interface and editing views
scripts/     deterministic audio checks and regression tooling
```

Primary technologies:

- Next.js 15
- React 19
- TypeScript
- Zustand
- Web Audio API
- Vitest

The project can also be built as a static web application.

## Project status

**v0.1.0 is the initial open-source release.**

Sweet DAW is still evolving. Project formats, DSP behavior, and UI contracts may change as the public contributor workflow matures. The current repository already includes automated type checking, unit/regression tests, production build verification, and an AIMIX self-test in CI.

The near-term focus is reliability and openness rather than adding the largest possible feature count. See [ROADMAP.md](ROADMAP.md).

## Development

Requirements: Node.js 22 and npm.

```bash
npm ci
npm run dev
```

Open:

- `http://localhost:3000`
- `http://localhost:3000/daw`

### Verification

```bash
npm run typecheck
npm run test
npm run build
npm run aimix:selftest
```

The GitHub Actions workflow runs the same core checks. An optional audio golden regression runs when redistributable golden fixtures are present.

## AI-assisted maintenance

AI coding tools, including Codex, are used as development assistants for tasks such as issue triage, test generation, code review support, documentation, regression analysis, and release checks.

They are **not** a runtime requirement for Sweet DAW. Contributors and maintainers remain responsible for correctness, licensing, security, and audio-quality decisions. Agent-facing repository guidance is documented in [SKILL.md](SKILL.md).

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

Project participation is also covered by the [Code of Conduct](CODE_OF_CONDUCT.md), and current decision-making and maintainer responsibilities are documented in [GOVERNANCE.md](GOVERNANCE.md).

Useful starting areas include:

- Safari / mobile audio reliability,
- audio regression testing,
- performance and memory use,
- accessibility and touch UX,
- documentation,
- DSP validation,
- safe import/export behavior.

Security-sensitive reports should follow [SECURITY.md](SECURITY.md).

## Open-source and dependency policy

Sweet DAW is released under the **MIT License**. See [LICENSE](LICENSE).

Third-party dependency and redistribution notes are documented in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). The current release does not intentionally vendor GPL/AGPL DAW or DSP implementations into the project core.

## Third-party music services

Sweet DAW can process user-provided audio generated by third-party tools, including services such as Suno. Sweet DAW is an independent project and is not an official product or integration of those services. The reviewed local workflow does not require service credentials, account automation, or an unofficial service API client.

## Release provenance

The public repository was created from a reviewed source snapshot with private development history excluded. The public release baseline and publication checks are described in [docs/OPEN_SOURCE_RELEASE.md](docs/OPEN_SOURCE_RELEASE.md).

## License

MIT © 2026 drvfua-debug and Sweet DAW contributors.
