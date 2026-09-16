# Sweet DAW Final Heavy Release Checklist

## Build
- [ ] `npm run typecheck`
- [ ] `npm run test`
- [ ] `npm run build`

## Manual Audio Checks
- [ ] Vocal stem with sibilance
- [ ] AI full mix with chirp or metallic highs
- [ ] Clipped drum loop
- [ ] Bass-heavy stem mix
- [ ] Wide stereo pad
- [ ] Old `.swtd` project load
- [ ] Export with tail
- [ ] Export report correctness

## Safety Checks
- [ ] Amount `0` produces no audible or numerical change
- [ ] Preview and export use the same DSP function for connected operations
- [ ] `not-wired` warning is visible when an operation is saved but not connected to export
- [ ] Control-style plugins either explain their status clearly or produce direct insert DSP when inserted
- [ ] Cancel stops queued jobs
- [ ] Mobile progress remains visible during heavy processing
- [ ] No full-band widen by default
- [ ] No high exciter by default
- [ ] No ML, WebGPU, WASM, server-side processing, or new heavy dependency
- [ ] `.swtd` does not persist full spectrogram matrices, worker buffers, or raw PCM caches

## Performance Budget
- [ ] UI main-thread blocking should stay around 50 ms or less per interactive action
- [ ] Mobile chunk processing target is 0.5 to 1.0 seconds of audio per chunk
- [ ] Long analysis/export tasks show progress and cancel controls
- [ ] Large `Float32Array` buffers are copied only when needed
- [ ] Spectral preview cache is downsampled or multi-resolution
- [ ] Full project audio is not duplicated into project metadata

## iPhone Safari / PWA Checks
- [ ] Normal Safari launch
- [ ] PWA home-screen launch
- [ ] Portrait layout can scroll to export controls
- [ ] Arrange track list can scroll to lower tracks
- [ ] Export progress overlay is visible
- [ ] Import does not include AppleDouble `._*.wav` sidecar files
- [ ] Large project remains responsive enough to cancel queued processing

## Release Notes
- [ ] Mention that estimated LUFS/true peak are lightweight browser estimates
- [ ] Explain that Reference audio is analysis-only unless the user deliberately routes it
- [ ] Warn that high boost, stereo widen, limiter drive, and exciter can make AI material worse
- [ ] Explain `applied`, `bypassed`, and `not-wired` in export reports
- [ ] Confirm original files are never overwritten
