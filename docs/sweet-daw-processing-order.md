# Sweet DAW Processing Order

This note fixes the intended processing order for preview/export safety.

## Offline Render Order

1. Clip / Region Repair
2. AIMIX Unmask
3. Track EQ / Plugin Chain
4. Track Pan / Spatial placement
5. Sends / Ambience
6. Master Bus
7. Export Peak Safety

Repair regions are clip-local and run before AIMIX Unmask. This keeps masking and ducking decisions working on the cleaned clip signal instead of repairing after the unmask stage.

Export peak safety stays last. Track or master processing must not add gain after the final export ceiling check.

## Preview / Export Parity

- Repair preview uses the same repair segment conversion as offline export.
- Removed / Difference preview is diagnostic and is not the final sound.
- Fixed repair regions are exported; unfixed draft regions are visual/editing candidates.
- AIMIX Unmask should be previewed/exported through the same DSP helpers where possible.

## UI Meaning

- Broad Track Cleanup changes track-level EQ/FX.
- Repair Regions affect selected time/frequency ranges.
- Reference tracks are analysis-only and must not be mixed into normal playback or WAV export.
