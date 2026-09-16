# Sweet DAW Final Heavy Audit

## Existing implementation status
- v0.1a Repair Visual: found
  - `SpectralRepairRegion`, `RepairViewState`, `RepairPreviewMode`, region sanitizers, default view state, waveform/STFT/heatmap UI, overlay rendering, and project state actions are present.
  - Main files: `src/daw/repair/repairTypes.ts`, `src/ui/views/SpectralRepairView.tsx`, `src/ui/components/SpectralCanvas.tsx`, `src/ui/components/WaveformDetailCanvas.tsx`, `src/daw/store/dawStore.ts`.
- v0.1b Preview and Delta: found
  - Processed, Removed-only, and Delta preview paths are connected to real audio via `buildClipRepairPreview` and `buildClipRepairAudio`.
  - Removed-only/Delta preview is safety attenuated by -12 dB.
  - Main files: `src/audio/repair/repairPreview.ts`, `src/ui/views/SpectralRepairView.tsx`, `src/audio/repair/repairPreview.test.ts`.
- v0.2a Repair Engine: found
  - De-click Lite, De-crackle Lite, De-ess Lite, De-harsh Lite, De-chirp Lite, and Low-end Tighten Lite are implemented through shared repair processors.
  - STFT helpers and DSP math helpers are present.
  - Main files: `src/audio/repair/repairProcessors.ts`, `src/audio/repair/stft.ts`, `src/audio/repair/dspMath.ts`, `src/audio/repair/repairAnalysis.ts`.
- v0.3a Unmask Matrix: found
  - AIMIX Unmask Matrix analysis, role/band priority, Reference Delta Assist, preview DSP, UI, FIX state, and export hook are present.
  - Preview and export share `applyUnmaskOperationsToChannels`.
  - Main files: `src/daw/aimixUnmask/aimixUnmaskTypes.ts`, `src/daw/aimixUnmask/unmaskAnalysis.ts`, `src/daw/aimixUnmask/unmaskDsp.ts`, `src/ui/daw/AimixUnmaskMatrixPanel.tsx`.

## Important files
- Repair model and migration:
  - `src/daw/repair/repairTypes.ts`
  - `src/daw/model/Project.ts`
  - `src/daw/project/ProjectSerializer.ts`
- Repair analysis / preview / DSP:
  - `src/audio/analysis/SpectralTileBuilder.ts`
  - `src/audio/repair/repairAnalysis.ts`
  - `src/audio/repair/repairPreview.ts`
  - `src/audio/repair/repairProcessors.ts`
  - `src/audio/repair/stft.ts`
  - `src/audio/repair/dspMath.ts`
- Unmask Matrix:
  - `src/daw/aimixUnmask/aimixUnmaskTypes.ts`
  - `src/daw/aimixUnmask/maskingBands.ts`
  - `src/daw/aimixUnmask/trackRole.ts`
  - `src/daw/aimixUnmask/unmaskAnalysis.ts`
  - `src/daw/aimixUnmask/unmaskDsp.ts`
  - `src/ui/daw/AimixUnmaskMatrixPanel.tsx`
- Export / render hook:
  - `src/audio/engine/OfflineRenderer.ts`
  - `src/daw/export/ProcessedStemPackage.ts`
  - `src/ui/daw/DawWorkspace.tsx`
- UI shell:
  - `src/ui/daw/AiMixAssistantPanel.tsx`
  - `src/ui/views/SpectralRepairView.tsx`
  - `src/ui/components/BottomNav.tsx`
  - `src/ui/daw/DawWorkspace.tsx`
- Tests:
  - `src/audio/repair/repairPreview.test.ts`
  - `src/audio/repair/repairProcessors.test.ts`
  - `src/daw/repair/repairTypes.test.ts`
  - `src/daw/aimixUnmask/unmaskAnalysis.test.ts`
  - `src/daw/aimixUnmask/unmaskDsp.test.ts`
  - Existing full suite currently reports 56 files / 231 tests passed.

## Safe extension points
- Analysis:
  - Repair analysis can extend `src/audio/repair/repairAnalysis.ts` and `src/audio/analysis/SpectralTileBuilder.ts`.
  - AIMIX masking analysis can extend `src/daw/aimixUnmask/unmaskAnalysis.ts`.
  - Reference and rendered mix analysis can extend `src/daw/mix/reference/*`, `src/daw/mix/renderDamageGuard.ts`, and `src/daw/mix/mixDoctorEngine.ts`.
- Preview:
  - Repair preview should continue using `buildClipRepairPreview` / `buildClipRepairAudio`.
  - Unmask preview should continue using `buildClipUnmaskPreview` / `buildClipUnmaskAudio` / `applyUnmaskOperationsToChannels`.
  - Any future preview should expose Original / Processed / Removed-only / Delta while keeping safety attenuation for removed material.
- Export:
  - `src/audio/engine/OfflineRenderer.ts` is the current safe hook point.
  - Repair export uses `buildClipRepairAudio(..., { fixedOnly: true })` inside `createRepairRenderBuffer`.
  - Unmask export uses `applyUnmaskOperationsToChannels(..., { fixedOnly: true })` in the same clip render path.
  - `renderProjectOffline`, `renderPreMasterOffline`, `renderTrackOffline`, and `renderAmbienceBusOffline` route through `scheduleClipSource` and are suitable for shared DSP connection.
- Project persistence:
  - `Project` stores `repairRegions`, `repairViewState`, and `aimixUnmaskState`.
  - Migration sanitizes all three fields in `migrateProjectWithReport`.
  - `.swtd` package export stores the full `Project` manifest through `src/daw/project/ProjectSerializer.ts`, so these fields are included with project metadata.
- UI:
  - Repair is already exposed as a dedicated view/tab through `BottomNav` / `DawWorkspace`.
  - AIMIX Unmask Matrix is embedded in `AiMixAssistantPanel` for the AIMIX section.
  - Mastering and Magic Polish live under the Mastering section of `AiMixAssistantPanel`.

## Risks
- Working tree state is dirty before Phase 0 documentation:
  - Several v0.1a-v0.3a files are still uncommitted/untracked, plus `.codex_backups/` is untracked.
  - Phase 0 does not modify or revert these changes. Commit discipline should be handled before large Phase 1 work.
- Build was not run during Phase 0:
  - Per Phase 0 guardrail, build is not run unless necessary. Typecheck and tests passed, but current optimized production build was not re-verified in this turn.
- Chunked processing is not yet present as a unified job queue:
  - Existing `AudioEngine` import has `AbortSignal` / progress support.
  - Spectral tile UI has local cancellation flags.
  - There is no reusable `SweetProcessingQueue`, chunk plan, shared progress model, pause/cancel API, or export queue yet.
- Export reporting is incomplete:
  - Repair and Unmask fixed operations are wired into export, but there is no unified export report that lists `applied`, `bypassed`, `not-wired`, or `failed` operations.
- Some standalone clip render callers need review in later phases:
  - `renderClipOffline` supports `repairRegions` and `unmaskOperations` options, but not every UI caller necessarily passes project-level operation lists. Project/track export paths are safer than isolated clip render paths.
- Large synchronous DSP can still block mobile UI:
  - Repair and Unmask processors use STFT/pure TS and are not chunked yet.
  - Phase 1 should introduce yielding, progress, cancellation, and chunk planning before adding heavier modules.
- Future transform placeholders exist:
  - `future_cqt`, `future_cwt`, `future_reassigned`, and `future_hpss` are type-level placeholders only. They must not be represented as implemented processing.
- Reference matching remains bounded but distributed:
  - Reference Delta concepts exist in multiple modules. Phase 2 should unify target profiles and bounded delta reports rather than adding another independent match layer.

## Recommended next phase
- Phase number: Phase 1
- Reason:
  - The current repair/unmask foundation is present and tests pass.
  - The largest architectural gap before heavier v0.4-v1.0 work is a shared chunked processing job queue with progress and cancellation.
  - Adding more DSP before chunking would increase iPhone Safari freeze risk.

## Commands executed
- command: `Get-Content C:\Users\pc\Downloads\SWEET_DAW_FINAL_HEAVY_SPLIT_V04_TO_V10_CODEX_UTF8.md -Encoding UTF8`
  - result: read successfully.
- command: `Get-Content C:\Users\pc\Downloads\SWEET_DAW_FINAL_HEAVY_SPLIT_PHASE_PROMPTS_UTF8\sweet_daw_final_split_prompts\00_MASTER_README.md -Encoding UTF8`
  - result: read successfully.
- command: `Get-Content C:\Users\pc\Downloads\SWEET_DAW_FINAL_HEAVY_SPLIT_PHASE_PROMPTS_UTF8\sweet_daw_final_split_prompts\01_PHASE_0_AUDIT.md -Encoding UTF8`
  - result: read successfully.
- command: `rg -n "RepairRegion|RepairViewState|removed-only|removed_only|delta preview|spectrogram|DeChirp|De-Chirp|De-Harsh|DeClick|De-Click|Low-End Tighten|lowend_tighten|Unmask Matrix|AIMIX|Reference Delta|OfflineAudioContext|exportWav|render|plugin chain|Magic Polish|ProcessingQueue|chunk|progress|cancel|Abort" src docs public scripts package.json`
  - result: found current repair, unmask, render, AIMIX, Magic Polish, and limited progress/cancel references.
- command: `git status --short`
  - result: dirty working tree with prior modified/untracked v0.1a-v0.3a files and backup folder.
- command: `Test-Path node_modules; Test-Path docs`
  - result: both exist; `npm install` not run.
- command: `Get-Content` on selected repair/unmask/export files
  - result: reviewed current implementation points.
- command: `npm run typecheck`
  - result: pass.
- command: `npm run test`
  - result: pass, 56 test files / 231 tests.
- command: `npm run build`
  - result: not run. Phase 0 guardrail says build is generally not run unless necessary.

## Stop reason
- Phase 0 only requested.
- Existing v0.1a / v0.1b / v0.2a / v0.3a status is documented.
- No new DSP, UI, queue, export behavior, or dependencies were implemented.
- Next work should begin with Phase 1 only.

## Next prompt
```md
前回の `docs/sweet-daw-final-heavy-audit.md` を確認し、`SWEET_DAW_FINAL_HEAVY_SPLIT_V04_TO_V10_CODEX_UTF8.md` の Phase 1 だけを実行してください。Chunked Processing Job Queue v0.4を実装します。重い解析・preview・exportを分割実行できる基盤、progress、cancel、chunk plan、testsを追加してください。Phase 2へ進まず停止してください。
```

## Phase D Export Truth Addendum

### Ordered Phase Status
1. Phase 0: Audit / Guardrail / Split Plan
2. Phase 1: Chunked Processing Job Queue
3. Phase 2: Reference Stem Delta / Target Profiles
4. Phase 3: Spectral Editor Pro Lite
5. Phase 4: Final Repair Modules
6. Phase 5: Master Polish Render Graph
7. Phase 6: Export Queue Persistence
8. Phase 7: QA / Performance / Docs
9. Phase A: Export Truth / Report Accuracy
10. Phase B: Clip Export / Cancel / Progress
11. Phase C: DSP Correctness
12. Phase D: Reference Delta / Mobile Safety / Docs

### Phase D Fixes
- Reference Delta PCM analysis samples multiple log-spaced frequencies inside each band and multiple windows across the file.
- Reference Delta reports keep `analysisWindowCount`; confidence is reduced when long material is judged from too few windows.
- Final Repair `transient-sustain-split` is analysis-only and is not listed as an applied audio module.
- Final Repair uses a block envelope fallback on long inputs to reduce iPhone Safari memory pressure.
- `sweet-vocal-duck-eq` is no longer a silent bypass when inserted directly. It applies a small vocal-space EQ dip; AIMIX can still use the same settings as ducking metadata.
- Public guide wording must keep `applied`, `bypassed`, and `not-wired` aligned with actual export audio.

## Phase 1 v0.4 Addendum

### Implemented Scope
- Added the internal Chunked Processing Job Queue foundation for heavy Sweet DAW operations.
- Added a reusable chunk planner for duration/sample-rate based analysis, preview, and export workloads.
- Added a cancellable `SweetProcessingQueue` and `runChunked` helper with progress snapshots and UI-yielding between chunks.
- Added a bounded analysis cache and a type-only worker protocol placeholder for future worker wiring.
- Added focused unit tests for chunk planning, progress, cancel, queue state, and cache behavior.

### Added Files
- `src/lib/audio/processingTypes.ts`
- `src/lib/audio/chunkPlan.ts`
- `src/lib/audio/processingJobs.ts`
- `src/lib/audio/analysisCache.ts`
- `src/lib/audio/workerProtocol.ts`
- `src/lib/audio/processingJobs.test.ts`

### Deliberately Not Connected Yet
- UI progress display is not connected in Phase 1.
- Repair / Unmask / export DSP call sites are not migrated to the queue yet.
- Web Worker execution is not implemented; the worker protocol is only a stable future contract.
- Phase 2 work was not started.

### Validation
- `npm run typecheck`: pass.
- `npm run build`: pass.
- Phase 1 repair verification rerun: `npx vitest run src/lib/audio/processingJobs.test.ts` passed, 1 file / 7 tests.

### Current Risk
- Phase 1 internal queue tests now pass after the repair verification.
- The queue is still intentionally internal-only; UI wiring and DSP/export migration remain later-phase work.

### Recommended Next Prompt
```md
前回の `docs/sweet-daw-final-heavy-audit.md` とPhase 1のChunked Processing Job Queue v0.4を確認し、次の指示ファイルに従ってPhase 2だけを実行してください。Phase 3へ進まず停止してください。
```

## Phase 2 v0.5 Addendum

### Implemented Scope
- Added Reference Stem Delta 2 / Target Profile System v0.5 as a bounded advisory layer.
- Added shared Target Profile presets for Safe, Balanced, Loud, Club Low-End, Vocal Forward, and Custom.
- Added stem role profiles so role-specific delta remains explicit and master-only analysis does not pretend to separate stems.
- Added bounded band delta report generation from existing Mix Doctor band energy reports.
- Added conversion helpers that AIMIX and Master Polish can consume as safe hints.
- Added a minimal AIMIX Reference options UI card with Target Profile selector, bounded delta summary, confidence, warnings, and Apply to AIMIX / Apply to Master Polish buttons.

### Added Files
- `src/lib/audio/referenceDelta.ts`
- `src/lib/audio/targetProfiles.ts`
- `src/lib/audio/stemRoleProfiles.ts`
- `src/lib/audio/__tests__/referenceDelta.test.ts`

### Changed Files
- `src/ui/daw/AiMixAssistantPanel.tsx`

### Deliberately Not Changed
- Existing AIMIX DSP behavior was not changed.
- Existing Magic Polish / Single File Mastering DSP behavior was not changed.
- Existing Unmask Matrix operations were not migrated to the new hints yet.
- No 100% match EQ, source separation, ML, WASM, WebGPU, or Phase 3 work was added.

### Validation
- `npx vitest run src/lib/audio/__tests__/referenceDelta.test.ts`: pass, 1 file / 6 tests.
- `npm run typecheck`: pass.
- `npm run build`: pass.

### Current Risk
- The Target Profile card is connected as a safe UI handoff only. Deeper automatic use inside Unmask Matrix proposal scoring and Master Polish internals remains a later phase.
- Existing Reference Delta logic in `src/daw/mix/reference` remains in place; Phase 2 adds a bounded shared layer rather than replacing old behavior.

### Recommended Next Prompt
```md
前回の `docs/sweet-daw-final-heavy-audit.md` とPhase 2のReference Stem Delta 2 / Target Profile System v0.5を確認し、次の指示ファイルに従ってPhase 3だけを実行してください。Phase 4へ進まず停止してください。
```

## Phase 3 v0.6 Addendum

### Implemented Scope
- Added Spectral Editor Pro Lite v0.6 foundation for time/frequency selection and non-destructive brush-region creation.
- Added shared spectral editor selection, brush operation, preview, and problem heatmap types.
- Added brush operation helpers that map Pro Lite brush actions into existing `SpectralRepairRegion` data, so created operations are saved through the existing project repair region path.
- Added lightweight brush DSP helpers for time attenuation, local click smoothing, existing lite repair DSP handoff, removed material calculation, and problem heatmap score projection.
- Added a Spectral Editor panel to the existing Spectral Repair view with brush operation selector, time/frequency selection sliders, brush amount, heatmap summary, Add Brush Region, and Duplicate selected region controls.
- Added drag selection support to `SpectralCanvas` for rectangle time/frequency selection while preserving existing region hit selection.

### Added Files
- `src/lib/audio/spectralEditorTypes.ts`
- `src/lib/audio/spectralSelection.ts`
- `src/lib/audio/spectralBrushOps.ts`
- `src/lib/audio/__tests__/spectralBrushOps.test.ts`
- `src/components/daw/SpectralEditorPanel.tsx`

### Changed Files
- `src/ui/components/SpectralCanvas.tsx`
- `src/ui/views/SpectralRepairView.tsx`

### Deliberately Not Added
- No ML, WASM, WebGPU, CQT, CWT, HPSS, source separation, or full spectral inpainting.
- No destructive audio overwrite.
- No new Project schema field was added; brush operations become existing repair regions when the user presses Add Brush Region.
- Export behavior remains the existing fixed `SpectralRepairRegion` path. If an operation is not fixed, it remains preview/editing state only.

### Validation
- `npx vitest run src/lib/audio/__tests__/spectralBrushOps.test.ts`: pass, 1 file / 5 tests.
- `npm run typecheck`: pass.
- `npm run build`: pass.

### Current Risk
- The Pro Lite selection itself is transient UI state until converted into a repair region.
- Low-frequency `band-attenuate` falls back to existing safe repair behavior rather than a new dedicated IIR/FIR design.
- Problem heatmap is lightweight and frame-score based, not a high-resolution RX/SpectraLayers-style edit map.

## Phase 4 v0.7 Addendum

### Implemented Scope
- Added Final Repair Modules v0.7 as pure browser-local DSP helpers.
- Added shared params and result types for De-Reverb / Tail Shorten Lite, Peak Restore / Unlimiter Lite, Hum / Tone / Whistle Reducer Lite, Plosive / Breath / Mouth Click Tamer Lite, Stereo Phase Guard, and Transient/Sustain Split Utility.
- Added a single reusable `applySweetFinalRepairModulesToChannels` function so preview/export call sites can use the same DSP path in a later wiring phase.
- Added `analyzeTransientSustain` with transient and sustain envelopes, transient density, and sustain smear score.
- Added removed-material output by subtracting processed audio from the original audio, matching the existing removed-only/delta preview direction.
- Added low-end protection for bass-focused Hum / Tone Reducer use so likely musical fundamentals are not treated as hum by default.
- Kept all processing deterministic, local, and dependency-free.

### Added Files
- `src/lib/audio/finalRepairModules.ts`
- `src/lib/audio/__tests__/finalRepairModules.test.ts`

### Deliberately Not Added
- No ML, server-side processing, WASM, WebGPU, CQT, CWT, HPSS, or source separation.
- No full dereverb or true ML unlimiter.
- No new heavy dependencies.
- No Phase 5 work was started.
- UI/export call sites were not forcibly migrated in Phase 4; the new pure DSP function is ready for safe wiring later.

### Validation
- `npx vitest run src/lib/audio/__tests__/finalRepairModules.test.ts`: pass, 1 file / 8 tests.
- `npm run typecheck`: pass.
- `npm run build`: pass.

### Current Risk
- De-Reverb / Tail Shorten Lite is a safe sustain attenuation helper, not a full dereverb model.
- Peak Restore / Unlimiter Lite restores transient contrast gently and will not reconstruct heavily clipped peaks.
- Hum / Tone / Whistle detection is intentionally conservative to avoid removing bass fundamentals or musical tones.
- Phase 4 modules are available as shared DSP but still need a later UI/export wiring pass if they should be user-facing controls.

## Phase 5 v0.8 Addendum

### Implemented Scope
- Added Master Polish 2 / Unified Render Graph v0.8 as a bounded, shared browser-local processing layer.
- Added a canonical render order description for Source / clip edit, RepairRegion pre-cleanup, Track plug-ins, Track gain/pan/routing, AIMIX Unmask / Priority Ducking, Track summing, Master repair safety pass, Master Polish 2, Limiter / ceiling / export normalization, and WAV / `.swtd` terminal save.
- Added `SweetMasterPolish2Params` and `SweetMasterPolish2Report` with sanitize/default helpers.
- Added `applySweetMasterPolish2ToChannels`, reusing Final Repair Modules v0.7 and the existing Single File Mastering engine so preview/export can call the same DSP function in later wiring.
- Added Target Profile and Reference Delta hint support through existing bounded profile helpers.
- Added optional Project master-state persistence for `master.masterPolish2`, with migration sanitization for old JSON/SWTD projects.

### Added Files
- `src/lib/audio/masterPolishTypes.ts`
- `src/lib/audio/masterPolishRenderGraph.ts`
- `src/lib/audio/__tests__/masterPolishRenderGraph.test.ts`

### Changed Files
- `src/daw/model/Project.ts`

### Deliberately Not Added
- No new limiter engine was introduced; existing Single File Mastering limiter/ceiling behavior is reused.
- No Phase 6 work was started.
- No UI overhaul was added in Phase 5.
- Existing playback/export graph code was not destructively rewritten; the unified graph is documented and exposed as a safe shared layer first.

### Validation
- `npx vitest run src/lib/audio/__tests__/masterPolishRenderGraph.test.ts`: pass, 1 file / 4 tests.
- `npm run typecheck`: pass.
- `npm run build`: pass.

### Current Risk
- Master Polish 2 is available as shared DSP and persisted settings, but deeper UI controls and automatic export call-site replacement remain later wiring work.
- The unified graph records the intended order and current connection assumptions; any future AudioEngine/OfflineRenderer migration should keep this test-covered order.
- Equal-loudness A/B is report-only in this phase and is not printed into exported audio.

### Recommended Next Prompt
```md
前回の `docs/sweet-daw-final-heavy-audit.md` とPhase 5のMaster Polish 2 / Unified Render Graph v0.8を確認し、`SWEET_DAW_FINAL_HEAVY_SPLIT_V04_TO_V10_CODEX_UTF8.md` のPhase 6だけを実行してください。Phase 7へ進まず停止してください。既存のMaster Polish 2 shared DSPとProject保存形式を壊さないでください。
```

### Recommended Next Prompt
```md
前回の `docs/sweet-daw-final-heavy-audit.md` とPhase 4のFinal Repair Modules v0.7を確認し、`SWEET_DAW_FINAL_HEAVY_SPLIT_V04_TO_V10_CODEX_UTF8.md` のPhase 5だけを実行してください。Phase 6へ進まず停止してください。既存のFinal Repair modulesを壊さず、Preview/Exportで同じDSP関数を使う方針を維持してください。
```

### Recommended Next Prompt
```md
前回の `docs/sweet-daw-final-heavy-audit.md` とPhase 3のSpectral Editor Pro Lite v0.6を確認し、次の指示ファイルに従ってPhase 4だけを実行してください。Phase 5へ進まず停止してください。
```
## Phase 7 v1.0 Addendum

### Implemented Scope
- Added QA / Performance Budget / Mobile Safety / Docs v1.0 coverage.
- Added final-heavy cross-module QA tests for zero-amount transparency, channel length/finite output safety, peak restore ceiling safety, phase guard low-side-only behavior, De-Chirp / De-Click safety, bounded Reference Delta, band-limited AIMIX Unmask, Master Polish finite output, and export `not-wired` reporting.
- Added DAW store QA tests for RepairRegion add/duplicate/FIX/bypass/delete, old project migration safety, Master Polish target profile defaults, and queue cancellation summary state.
- Replaced the public Sweet DAW guide with clean Japanese text matching the current AIMIX / Spatial / Mastering / Repair / Export Report workflow.
- Added a release checklist with build, audio, safety, iPhone/PWA, performance budget, and release-note checks.

### Added Files
- `src/lib/audio/__tests__/finalHeavyQa.test.ts`
- `src/daw/store/dawStore.finalHeavyQa.test.ts`
- `docs/sweet-daw-final-heavy-release-checklist.md`

### Changed Files
- `public/sweet_daw_guide.html`
- `docs/sweet-daw-final-heavy-audit.md`

### Deliberately Not Added
- No Phase 8 work was started.
- No new DSP behavior was introduced for Phase 7; this phase focuses on QA and documentation.
- No ML, WASM, WebGPU, server-side processing, source separation, or new heavy dependency was added.

### Validation
- Targeted QA tests: `npx vitest run src/lib/audio/__tests__/finalHeavyQa.test.ts src/daw/store/dawStore.finalHeavyQa.test.ts` passed, 2 files / 10 tests.
- `npm run typecheck`: pass.
- `npm run test`: pass, 64 files / 275 tests.
- `npm run build`: pass.

### Current Risk
- The public guide is static documentation; it should be rechecked visually after deployment.
- Export report UI is compact by design. More detailed export history can be added later if users need it.

### Recommended Next Prompt
```md
前回の `docs/sweet-daw-final-heavy-audit.md` と Phase 7 v1.0 の QA / Performance Budget / Mobile Safety / Docs を確認し、次の Phase だけを実行してください。既存 QA テスト、export report、guide、release checklist を壊さず、typecheck/test/build の上限を守ってください。
```

## Phase 6 v0.9 Addendum

### Implemented Scope
- Added Export Queue / Analysis Cache / Project Persistence v0.9 foundation.
- Added `SweetExportProcessingReport`, applied-operation statuses, persisted analysis summary types, and sanitizers.
- Added a chunked PCM export queue helper that reports progress, supports cancellation, estimates loudness/true-peak before and after processing, and records applied/bypassed/not-wired operations.
- Connected master WAV export to the queue/report path while preserving the existing offline render and WAV encoder behavior.
- Added lightweight project persistence for `exportReports` and `analysisCacheSummary` with migration sanitization for old JSON/SWTD projects.
- Added Files view UI for the latest export report, including applied/not-wired/warning counts plus Copy/JSON report actions.
- Added the existing export overlay progress bar for queue chunks during master WAV export.

### Added Files
- `src/lib/audio/exportProcessingTypes.ts`
- `src/lib/audio/exportQueue.ts`
- `src/lib/audio/__tests__/exportQueue.test.ts`

### Changed Files
- `src/daw/model/Project.ts`
- `src/daw/store/dawStore.ts`
- `src/ui/daw/DawWorkspace.tsx`
- `src/ui/views/FileManager.tsx`
- `docs/sweet-daw-final-heavy-audit.md`

### Deliberately Not Added
- No Phase 7 work was started.
- No new heavy dependencies, ML, WASM, WebGPU, CQT, CWT, HPSS, server-side processing, or source separation were added.
- No destructive rewrite of `OfflineRenderer` or the existing WAV export encoder was performed.
- Heavy analysis buffers and raw PCM caches are not persisted in `.swtd`; only lightweight summaries are saved.

### Validation
- `npx vitest run src/lib/audio/__tests__/exportQueue.test.ts`: pass, 1 file / 4 tests.
- `npm run typecheck`: pass.
- `npm run build`: pass.
- `npm run test`: pass, 62 files / 265 tests.

### Current Risk
- Master WAV export now records queue/report metadata, but the current offline render itself is still produced by the existing `OfflineRenderer` before queue post-processing.
- `masterPolish2`, repair, and AIMIX Unmask export statuses are reportable; future phases should keep report wiring honest when deeper render graph migration happens.
- Export report UI is intentionally compact; a fuller export history panel can be added later if needed.

### Recommended Next Prompt
```md
前回の `docs/sweet-daw-final-heavy-audit.md` と Phase 6 v0.9 の Export Queue / Analysis Cache / Project Persistence を確認し、`SWEET_DAW_FINAL_HEAVY_SPLIT_V04_TO_V10_CODEX_UTF8.md` の Phase 7 だけを実行してください。Phase 8 へ進まず停止してください。既存の export report / project persistence / queue cancellation を壊さず、必要なテストを追加してください。
```
