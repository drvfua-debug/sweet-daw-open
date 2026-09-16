# Sweet DAW Plugin Function Audit

Date: 2026-06-05

## Scope

- Checked `src/audio/plugins/pluginRegistry.ts` against `src/audio/plugins/PluginChain.ts`.
- Confirmed every insertable built-in plugin id has a corresponding audio node path.
- Checked whether plugin names/descriptions imply functionality that is not actually implemented.

## Result

- No completely disconnected built-in plugin ids were found.
- Fixed overly strong descriptions for:
  - `Sweet Vocal Formant Color`
  - `Sweet Vocoder Lite`
  - `Sweet Pitch Assist`
  - `Sweet Wavetable Carrier`

## Notes

- `Sweet Pitch Assist` is a short modulated-delay color/tightening effect, not full pitch correction.
- `Sweet Vocoder Lite` is a browser-local carrier/formant color effect, not a full analysis vocoder.
- `Sweet Wavetable Carrier` adds a parallel oscillator layer; it does not replace or re-synthesize the source stem.
- `Sweet De-Esser` uses a band-limited subtraction path around the sibilance range, so its behavior matches the de-esser label at MVP level.

## Follow-up

- A future deeper audit should render pink-noise and vocal/drum/bass test fixtures through every plugin and compare spectral/level deltas.
- UI parameter labels should eventually show common units where applicable: Hz, dB, ms, mix %, rate note values.
