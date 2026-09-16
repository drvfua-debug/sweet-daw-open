# Third-Party Notices

Sweet DAW itself is released under the MIT License. This repository also references and depends on third-party packages under their own licenses.

## Direct runtime dependencies

The versions below reflect the resolved dependency set in `package-lock.json` at the open-source preparation baseline.

| Package | Resolved version | License |
| --- | ---: | --- |
| Next.js (`next`) | 15.5.18 | MIT |
| React (`react`) | 19.2.6 | MIT |
| React DOM (`react-dom`) | 19.2.6 | MIT |
| Zustand (`zustand`) | 5.0.13 | MIT |
| Lucide React (`lucide-react`) | 0.468.0 | ISC |

Development dependencies are also governed by their respective upstream licenses. `package-lock.json` is the authoritative record of the resolved dependency graph for this snapshot.

## Transitive image-tooling packages

The resolved Next.js dependency graph can include `sharp` and platform-specific `@img/sharp-libvips-*` optional packages. In the current lockfile:

- `sharp` declares Apache-2.0.
- platform-specific `@img/sharp-libvips-*` packages declare LGPL-3.0-or-later.

Sweet DAW's browser audio DSP does not use libvips, and the static PWA audio pipeline is implemented with Web Audio APIs and project-owned TypeScript/JavaScript DSP. If you redistribute a build that bundles or ships optional image-processing binaries, review the applicable upstream license and notice requirements for that distribution.

## Audio/DSP posture

The current Sweet DAW source does not intentionally vendor or import GPL/AGPL DAW or DSP implementations. Built-in audio processing is implemented with browser Web Audio primitives and project-owned code. No external IR library, VST/AUv3 plug-in binary, ONNX model, or third-party WASM DSP binary is included in the open-source preparation snapshot.

Reference projects and technologies mentioned in documentation are not automatically dependencies and are not licensed as part of Sweet DAW.

## Upstream notices

Keep upstream copyright and license notices intact when redistributing third-party source or binaries. In particular, consult the license distributed with each installed package rather than relying only on this summary.

This file is an engineering inventory, not legal advice.
