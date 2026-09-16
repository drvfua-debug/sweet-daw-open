# Sweet DAW Engine Processing Order

This document records the Sweet DAW browser render path as implemented in `src/audio/engine/OfflineRenderer.ts` and `src/audio/engine/MasterBus.ts`.

The goal is to keep preview/export behavior explainable on mobile Safari while preserving a path toward a shared Sweet DAW / SSTO audio core. This file documents Sweet DAW only.

## Engine Quality Modes

Sweet DAW uses `EngineQualityMode` to separate lightweight preview work from offline export work:

- `mobile-preview`: light analysis, no heavy candidate render, minimal true-peak estimate.
- `mobile-export`: offline render with browser-safe memory budget, true peak 2x, Peak Maximizer capped at 2x.
- `desktop-preview`: balanced preview, more room for candidate render than mobile.
- `desktop-export`: highest browser-safe path, true peak 4x, Peak Maximizer may use 4x.
- `analysis-only`: no audio rewrite intent; reports and suggestions only.

Reports should preserve the selected mode and the effective processing budget. If a mobile budget caps Peak Maximizer oversampling or skips heavy candidate work, the render warning/report must say so.

## Offline Track Path

The exported track path is:

```text
clip_region_repair
→ aimix_unmask
→ clip_gain
→ clip_pan
→ clip_insert_chain
→ track_corrective_eq
→ character
→ compressor_leveler
→ insert_plugin_chain
→ vocal_duck
→ vocal_image_layer
→ pan_spatial
→ track_gain
→ sends_ambience
```

Reference tracks are analysis-only and are excluded from normal playback/export rendering.

## Master Path

The master path is:

```text
mix_bus_trim
→ master_corrective_eq
→ master_compressor
→ master_insert_chain
→ master_gain
→ limiter_or_peak_maximizer
→ final_output_trim
→ export_peak_safety
```

When `sweet-peak-maximizer` is enabled in the master insert chain, the realtime/Web Audio limiter is disabled in the master bus to avoid double limiting. The offline renderer then applies Peak Maximizer after the Web Audio render and performs final peak safety.

## Vocal Stem Conceptual Order

Vocal stems should follow this conceptual order:

```text
1. Clip Gain / Fader
2. Artifact / Repair
3. Corrective EQ
4. De-esser / Harsh Guard
5. Compressor / Leveler
6. Tone EQ / AIMIX Glow
7. Vocal Forward / Automation
8. Spatial Send
9. Final Safety
```

The exact implementation remains split between clip processing, track chain, plugin chain, and master/export safety, but tests pin the key ordering constraints.
