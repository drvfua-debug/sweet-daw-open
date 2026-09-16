"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Activity, CheckCircle2, Eye, EyeOff, Play, Plus, Radar, ScanSearch, Square, Trash2 } from "lucide-react";
import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import { buildSpectralTile, type SpectralTile } from "@/audio/analysis/SpectralTileBuilder";
import { audioBufferRegistry } from "@/audio/engine/AudioBufferRegistry";
import { analyzeRepairIssues, createRepairRegionsFromAnalysis } from "@/audio/repair/repairAnalysis";
import { buildClipRepairPreview, type RepairPreviewResult } from "@/audio/repair/repairPreview";
import { SpectralEditorPanel } from "@/components/daw/SpectralEditorPanel";
import type { Clip, Project } from "@/daw/model/Project";
import type { MixDoctorReport, SpectralEditOp, SpectralRepairReport } from "@/daw/mix/mixDoctorTypes";
import { createManualRepairRegion, suggestRepairRegionsForClip } from "@/daw/repair/repairPlanner";
import {
  REPAIR_OPERATION_LABELS,
  REPAIR_PROBLEM_LABELS,
  createSpectralRepairRegion,
  type RepairProblemType,
  type RepairViewState,
  type SpectralRepairRegion,
} from "@/daw/repair/repairTypes";
import { SpectralCanvas } from "@/ui/components/SpectralCanvas";
import { WaveformDetailCanvas } from "@/ui/components/WaveformDetailCanvas";
import { RepairMapPanel } from "@/ui/daw/RepairMapPanel";
import type { SweetSpectralBrushOperationKind, SweetSpectralProblemHeatmapFrame, SweetSpectralSelection } from "@/lib/audio/spectralEditorTypes";
import { brushOperationToRepairRegion, buildSpectralProblemHeatmapFrames, createSpectralBrushOperation } from "@/lib/audio/spectralBrushOps";
import { createSweetSpectralSelection, updateSweetSpectralSelection } from "@/lib/audio/spectralSelection";

type SpectralRepairViewProps = {
  project: Project;
  peaksByFileId: Record<string, PeakSummary>;
  selectedTrackId: string | null;
  selectedClipId: string | null;
  positionSec: number;
  onSelectClip: (clipId: string | null) => void;
  onSeek: (positionSec: number) => void;
  onUpdateViewState: (patch: Partial<RepairViewState>) => void;
  onUpsertRegion: (region: SpectralRepairRegion) => void;
  onDeleteRegion: (regionId: string) => void;
  onToggleRegion: (regionId: string, enabled?: boolean) => void;
  onFixRegion: (regionId: string, fixed?: boolean) => void;
  mixDoctorReport?: MixDoctorReport | null;
  spectralRepairReport?: SpectralRepairReport | null;
  onAnalyzeRepair?: () => void;
  onApplySpectralRepair?: (ops: SpectralEditOp[]) => void;
  onToast?: (message: string) => void;
};

const PROBLEM_OPTIONS: RepairProblemType[] = [
  "sibilance",
  "metallic_high",
  "hiss",
  "mud",
  "rumble",
  "click",
  "clipping",
  "reverb_smear",
  "phase_risk",
  "vocal_plastic",
  "low_end_blur",
];

export function SpectralRepairView({
  project,
  peaksByFileId,
  selectedTrackId,
  selectedClipId,
  positionSec,
  onSelectClip,
  onSeek,
  onUpdateViewState,
  onUpsertRegion,
  onDeleteRegion,
  onToggleRegion,
  onFixRegion,
  mixDoctorReport = null,
  spectralRepairReport = null,
  onAnalyzeRepair,
  onApplySpectralRepair,
  onToast,
}: SpectralRepairViewProps) {
  const [manualProblem, setManualProblem] = useState<RepairProblemType>("mud");
  const [tile, setTile] = useState<SpectralTile | null>(null);
  const [isBuildingTile, setIsBuildingTile] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<string | null>(null);
  const [matchPreviewLoudness, setMatchPreviewLoudness] = useState(false);
  const [previewResult, setPreviewResult] = useState<RepairPreviewResult | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [brushKind, setBrushKind] = useState<SweetSpectralBrushOperationKind>("attenuate");
  const [brushAmount, setBrushAmount] = useState(0.5);
  const [spectralSelection, setSpectralSelection] = useState<SweetSpectralSelection>(() => createSweetSpectralSelection({ startSec: 0, endSec: 0.5, minHz: 120, maxHz: 8000, shape: "rectangle" }));
  const [heatmapFrames, setHeatmapFrames] = useState<SweetSpectralProblemHeatmapFrame[]>([]);
  const previewContextRef = useRef<AudioContext | null>(null);
  const previewSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const selectedClip = useMemo(() => resolveSelectedClip(project, selectedClipId, selectedTrackId), [project, selectedClipId, selectedTrackId]);
  const selectedTrack = selectedClip ? project.tracks.find((track) => track.id === selectedClip.trackId) ?? null : null;
  const selectedFile = selectedClip ? project.files.find((file) => file.id === selectedClip.fileId) ?? null : null;
  const selectedPeaks = selectedClip ? peaksByFileId[selectedClip.fileId] : undefined;
  const viewState = project.repairViewState;
  const relevantRegions = useMemo(() => {
    if (!selectedClip) return project.repairRegions;
    return project.repairRegions.filter((region) => region.clipId === selectedClip.id || region.fileId === selectedClip.fileId || region.trackId === selectedClip.trackId);
  }, [project.repairRegions, selectedClip]);
  const selectedRegion = project.repairRegions.find((region) => region.id === viewState.selectedRegionId) ?? relevantRegions[0] ?? null;
  const stopPreview = () => {
    const source = previewSourceRef.current;
    if (source) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // The source may already be stopped by the browser.
      }
      source.disconnect();
    }
    previewSourceRef.current = null;
    setIsPreviewing(false);
  };

  useEffect(() => {
    return () => {
      stopPreview();
      void previewContextRef.current?.close();
      previewContextRef.current = null;
    };
  }, []);

  useEffect(() => {
    setPreviewResult(null);
    stopPreview();
  }, [selectedClip?.id, viewState.previewMode]);
  useEffect(() => {
    if (!selectedClip) {
      setHeatmapFrames([]);
      return;
    }
    setSpectralSelection(createSweetSpectralSelection({
      startSec: selectedClip.timelineStartSec,
      endSec: selectedClip.timelineStartSec + Math.min(0.5, selectedClip.durationSec),
      minHz: 120,
      maxHz: 8000,
      shape: "rectangle",
      featherTimeSec: 0.03,
      featherHz: 120,
    }));
    setHeatmapFrames([]);
  }, [selectedClip?.id, selectedClip?.timelineStartSec, selectedClip?.durationSec]);


  const playRepairPreview = async () => {
    if (!selectedClip) return;
    const sourceBuffer = audioBufferRegistry.getBuffer(selectedClip.fileId);
    if (!sourceBuffer) {
      setPreviewResult({
        original: [],
        processed: [],
        removed: [],
        preview: [],
        appliedRegionIds: [],
        warnings: ["Source audio is not decoded yet. Re-import or restore the asset first."],
        metrics: { originalRmsDb: -180, processedRmsDb: -180, rmsDeltaDb: 0, matchGainDb: 0 },
      });
      return;
    }

    stopPreview();
    const result = buildClipRepairPreview(sourceBuffer, selectedClip, relevantRegions, {
      previewMode: viewState.previewMode,
      matchLoudness: matchPreviewLoudness,
    });
    setPreviewResult(result);

    const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) {
      setPreviewResult({ ...result, warnings: [...result.warnings, "This browser does not support AudioContext preview."] });
      return;
    }

    const context = previewContextRef.current ?? new AudioContextCtor();
    previewContextRef.current = context;
    if (context.state === "suspended") await context.resume();

    const audioBuffer = createPreviewAudioBuffer(context, result.preview, sourceBuffer.sampleRate);
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);
    source.onended = () => {
      previewSourceRef.current = null;
      setIsPreviewing(false);
    };
    previewSourceRef.current = source;
    setIsPreviewing(true);
    source.start();
  };

  useEffect(() => {
    if (!selectedClip || viewState.viewMode === "waveform") {
      setTile(null);
      return;
    }
    const buffer = audioBufferRegistry.getBuffer(selectedClip.fileId);
    if (!buffer) {
      setTile(null);
      return;
    }
    let cancelled = false;
    setIsBuildingTile(true);
    const timer = window.setTimeout(() => {
      const nextTile = buildSpectralTile(buffer, {
        startSec: selectedClip.sourceStartSec,
        durationSec: Math.min(selectedClip.durationSec, 24),
        timeBins: viewState.viewMode === "artifact_heatmap" ? 84 : 104,
        freqBins: 72,
        minDb: viewState.minDb,
        maxDb: viewState.maxDb,
      });
      if (!cancelled) {
        setTile(nextTile);
        setIsBuildingTile(false);
      }
    }, 20);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [selectedClip, viewState.viewMode, viewState.minDb, viewState.maxDb]);

  const scanSelectedClip = () => {
    if (!selectedClip) return;
    const fallbackCandidates = suggestRepairRegionsForClip(project, selectedClip.id, peaksByFileId);
    for (const candidate of fallbackCandidates) {
      const { score: _score, reason: _reason, ...region } = candidate;
      onUpsertRegion(region);
    }

    const buffer = audioBufferRegistry.getBuffer(selectedClip.fileId);
    if (!buffer) {
      setHeatmapFrames([]);
      setAnalysisStatus(`Peak scan added ${fallbackCandidates.length} region(s). Decode the source audio for v0.2a analysis.`);
      return;
    }

    const durationSec = Math.min(selectedClip.durationSec, Math.max(0.05, buffer.duration - selectedClip.sourceStartSec), 30);
    const frameCount = Math.max(1, Math.floor(durationSec * buffer.sampleRate));
    const startFrame = Math.max(0, Math.floor(selectedClip.sourceStartSec * buffer.sampleRate));
    const channels = Array.from({ length: Math.max(1, buffer.numberOfChannels) }, (_, channelIndex) => {
      const source = buffer.getChannelData(channelIndex);
      const output = new Float32Array(frameCount);
      for (let index = 0; index < frameCount; index += 1) output[index] = source[startFrame + index] ?? 0;
      return output;
    });
    const analysis = analyzeRepairIssues(channels, buffer.sampleRate, { durationSec });
    setHeatmapFrames(buildSpectralProblemHeatmapFrames(analysis));
    const regions = createRepairRegionsFromAnalysis({
      analysis,
      clip: selectedClip,
      fileId: selectedClip.fileId,
      trackId: selectedClip.trackId,
      maxRegions: Math.max(0, 20 - fallbackCandidates.length),
      minScore: 0.58,
    });
    for (const region of regions) onUpsertRegion(region);
    const warningText = analysis.warnings.length > 0 ? ` ${analysis.warnings.length} warning(s).` : "";
    setAnalysisStatus(`v0.2a analysis added ${regions.length} region(s). Peak scan added ${fallbackCandidates.length}.${warningText}`);
  };
  const createManualRegion = () => {
    if (!selectedClip) return;
    const region = createManualRepairRegion({ project, clipId: selectedClip.id, positionSec, problemType: manualProblem });
    if (region) onUpsertRegion(region);
  };

  const createBrushRegion = () => {
    if (!selectedClip) return;
    const operation = createSpectralBrushOperation({
      kind: brushKind,
      amount: brushAmount,
      selection: spectralSelection,
      label: brushKind,
    });
    const region = brushOperationToRepairRegion(operation, { clip: selectedClip, fileId: selectedClip.fileId, trackId: selectedClip.trackId });
    onUpsertRegion(region);
    onUpdateViewState({ selectedRegionId: region.id, viewMode: viewState.viewMode === "waveform" ? "stft" : viewState.viewMode });
  };

  const duplicateSelectedRegion = () => {
    if (!selectedRegion) return;
    const duplicate = createSpectralRepairRegion({
      ...selectedRegion,
      id: undefined,
      startSec: selectedRegion.startSec + 0.02,
      endSec: selectedRegion.endSec + 0.02,
      fixed: false,
      enabled: true,
    });
    onUpsertRegion(duplicate);
    onUpdateViewState({ selectedRegionId: duplicate.id });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 overflow-hidden text-daw-text">
      <section className="shrink-0 rounded-2xl border border-daw-line bg-daw-panel p-2 sm:p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="text-[10px] font-black uppercase tracking-[0.22em] text-daw-cyan">Sweet Repair Visual v0.1a</p>
            <h2 className="truncate text-base font-black sm:text-lg">Repair</h2>
            <p className="text-[11px] text-daw-muted">Non-destructive repair regions, visual inspection, real preview, and FIX state management.</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {(["waveform", "stft", "artifact_heatmap"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => onUpdateViewState({ viewMode: mode })}
                className={`daw-btn !min-h-[32px] px-2 text-[10px] font-bold ${viewState.viewMode === mode ? "daw-btn-primary" : "daw-btn-ghost"}`}
              >
                {mode === "waveform" ? "Wave" : mode === "stft" ? "STFT" : "Heat"}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onUpdateViewState({ showOverlay: !viewState.showOverlay })}
              className="daw-btn daw-btn-ghost !min-h-[32px] px-2 text-[10px] font-bold"
            >
              {viewState.showOverlay ? <Eye size={14} /> : <EyeOff size={14} />} Overlay
            </button>
          </div>
        </div>
      </section>

      <div className="grid flex-1 min-h-0 gap-2 overflow-hidden lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="flex min-h-0 flex-col gap-2 overflow-hidden rounded-2xl border border-daw-line bg-daw-panel2 p-2">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[10px] uppercase tracking-[0.18em] text-daw-muted">Selected source</p>
              <h3 className="truncate text-sm font-black">{selectedFile ? selectedFile.name : "No clip selected"}</h3>
              {selectedClip && selectedTrack && (
                <p className="text-[11px] text-daw-muted">
                  {selectedTrack.name} / {selectedClip.timelineStartSec.toFixed(2)}s - {(selectedClip.timelineStartSec + selectedClip.durationSec).toFixed(2)}s
                </p>
              )}
            </div>
            <select
              value={selectedClip?.id ?? ""}
              onChange={(event) => onSelectClip(event.currentTarget.value || null)}
              className="min-h-[34px] max-w-[220px] rounded-lg border border-daw-line bg-daw-bg px-2 text-xs text-daw-text"
            >
              <option value="">Select clip</option>
              {project.clips.map((clip) => {
                const track = project.tracks.find((candidate) => candidate.id === clip.trackId);
                const file = project.files.find((candidate) => candidate.id === clip.fileId);
                return (
                  <option key={clip.id} value={clip.id}>
                    {track?.name ?? "Track"} - {file?.name ?? clip.id}
                  </option>
                );
              })}
            </select>
          </div>

          <div className="min-h-0 flex-1 overflow-hidden">
            {viewState.viewMode === "waveform" ? (
              <WaveformDetailCanvas
                clip={selectedClip}
                peaks={selectedPeaks}
                regions={viewState.showOverlay ? relevantRegions : []}
                selectedRegionId={viewState.selectedRegionId}
                playheadSec={positionSec}
                color={selectedTrack?.color}
                onSelectRegion={(regionId) => onUpdateViewState({ selectedRegionId: regionId })}
              />
            ) : viewState.viewMode === "artifact_heatmap" && (mixDoctorReport || spectralRepairReport) ? (
              <RepairMapPanel
                project={project}
                report={mixDoctorReport}
                spectralRepairReport={spectralRepairReport}
                peaksByFileId={peaksByFileId}
                onAnalyze={onAnalyzeRepair ?? (() => onToast?.("Run AIMIX analysis before Analyze Repair."))}
                onApplySpectralRepair={onApplySpectralRepair ?? (() => onToast?.("Repair apply is not connected in this view."))}
                onToast={onToast}
                variant="embedded"
              />
            ) : (
              <div className="relative h-full min-h-[240px]">
                <SpectralCanvas
                  tile={tile}
                  clip={selectedClip}
                  regions={viewState.showOverlay ? relevantRegions : []}
                  selectedRegionId={viewState.selectedRegionId}
                  viewMode={viewState.viewMode}
                  selection={spectralSelection}
                  onSelectionChange={(selection) => setSpectralSelection(updateSweetSpectralSelection(selection, {}))}
                  onSelectRegion={(regionId) => onUpdateViewState({ selectedRegionId: regionId })}
                />
                {isBuildingTile && (
                  <div className="pointer-events-none absolute inset-0 grid place-items-center rounded-xl bg-black/30 text-xs font-bold text-daw-cyan">
                    Building lightweight STFT...
                  </div>
                )}
              </div>
            )}
          </div>

          {selectedClip && (
            <input
              type="range"
              min={selectedClip.timelineStartSec}
              max={selectedClip.timelineStartSec + selectedClip.durationSec}
              step={0.01}
              value={Math.min(selectedClip.timelineStartSec + selectedClip.durationSec, Math.max(selectedClip.timelineStartSec, positionSec))}
              onChange={(event) => onSeek(Number(event.currentTarget.value))}
              className="w-full accent-daw-cyan"
              aria-label="Repair playhead"
            />
          )}
        </section>

        <aside className="flex min-h-0 flex-col gap-2 overflow-y-auto rounded-2xl border border-daw-line bg-daw-panel p-2">
          <SpectralEditorPanel
            disabled={!selectedClip}
            selection={spectralSelection}
            brushKind={brushKind}
            brushAmount={brushAmount}
            heatmapFrames={heatmapFrames}
            onSelectionChange={setSpectralSelection}
            onBrushKindChange={setBrushKind}
            onBrushAmountChange={setBrushAmount}
            onCreateRegion={createBrushRegion}
            onDuplicateSelected={selectedRegion ? duplicateSelectedRegion : undefined}
          />
          <div className="rounded-xl border border-daw-line bg-daw-bg/55 p-2">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-daw-muted">Preview mode</p>
            <div className="mt-2 grid grid-cols-2 gap-1">
              {(["original", "processed", "removed_only", "delta"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => onUpdateViewState({ previewMode: mode })}
                  className={`min-h-[32px] rounded-lg px-2 text-[10px] font-bold ${viewState.previewMode === mode ? "bg-daw-cyan/20 text-daw-cyan" : "bg-white/[0.04] text-daw-muted"}`}
                >
                  {mode === "original" ? "Before" : mode === "processed" ? "After" : mode === "removed_only" ? "Removed" : "Difference"}
                </button>
              ))}
            </div>
            <label className="mt-2 flex min-h-[34px] items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-2 text-[11px] text-daw-muted">
              <span>RMS match preview</span>
              <input
                type="checkbox"
                checked={matchPreviewLoudness}
                onChange={(event) => setMatchPreviewLoudness(event.currentTarget.checked)}
                className="accent-daw-cyan"
              />
            </label>
            <button
              type="button"
              disabled={!selectedClip}
              onClick={() => {
                if (isPreviewing) stopPreview();
                else void playRepairPreview();
              }}
              className="daw-btn daw-btn-primary mt-2 w-full !min-h-[36px] text-xs font-bold disabled:opacity-40"
            >
              {isPreviewing ? <Square size={15} /> : <Play size={15} />}
              {isPreviewing ? "Stop Preview" : "Play Preview"}
            </button>
            {previewResult && (
              <div className="mt-2 rounded-lg border border-white/[0.06] bg-black/20 p-2 text-[10px] leading-relaxed text-daw-muted">
                <div className="mb-1 flex items-center justify-between gap-2 rounded-md bg-white/[0.035] px-2 py-1 font-bold">
                  <span>After Preview</span>
                  <span className="text-daw-cyan">rendered</span>
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <span>Original RMS {previewResult.metrics.originalRmsDb.toFixed(1)}dB</span>
                  <span>Processed RMS {previewResult.metrics.processedRmsDb.toFixed(1)}dB</span>
                  <span>Delta {previewResult.metrics.rmsDeltaDb.toFixed(1)}dB</span>
                  <span>Match {previewResult.metrics.matchGainDb.toFixed(1)}dB</span>
                </div>
                <p className="mt-1 text-daw-cyan">Applied regions: {previewResult.appliedRegionIds.length}</p>
                {previewResult.appliedRegionIds.length === 0 && viewState.previewMode !== "original" && (
                  <p className="mt-1 text-amber-200">No active repair region is affecting this preview.</p>
                )}
                {previewResult.warnings.map((warning) => (
                  <p key={warning} className="mt-1 text-amber-200">{warning}</p>
                ))}
              </div>
            )}
            {!previewResult && viewState.previewMode !== "original" && (
              <p className="mt-2 rounded-lg border border-amber-300/20 bg-amber-300/10 px-2 py-1 text-[10px] text-amber-100">
                After Preview is predicted until you press Play Preview.
              </p>
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-daw-muted">
              Before is the source clip. After, Removed, and Difference are rendered from the selected repair regions when you press Play Preview. Removed-only is not the final sound.
            </p>
          </div>

          <div className="rounded-xl border border-daw-line bg-daw-bg/55 p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] font-black uppercase tracking-[0.18em] text-daw-muted">Detect candidates</p>
              <Radar size={14} className="text-daw-cyan" />
            </div>
            <button
              type="button"
              disabled={!selectedClip}
              onClick={scanSelectedClip}
              className="daw-btn daw-btn-primary mt-2 w-full !min-h-[36px] text-xs font-bold disabled:opacity-40"
            >
              <ScanSearch size={15} /> Analyze selected clip
            </button>
            {analysisStatus && <p className="mt-2 rounded-lg bg-white/[0.04] p-2 text-[10px] leading-relaxed text-daw-muted">{analysisStatus}</p>}
            <div className="mt-2 grid grid-cols-[1fr_auto] gap-1">
              <select
                value={manualProblem}
                onChange={(event) => setManualProblem(event.currentTarget.value as RepairProblemType)}
                className="min-h-[34px] rounded-lg border border-daw-line bg-daw-bg px-2 text-xs text-daw-text"
              >
                {PROBLEM_OPTIONS.map((problem) => (
                  <option key={problem} value={problem}>
                    {REPAIR_PROBLEM_LABELS[problem]}
                  </option>
                ))}
              </select>
              <button type="button" disabled={!selectedClip} onClick={createManualRegion} className="daw-btn daw-btn-ghost !min-h-[34px] px-2 disabled:opacity-40">
                <Plus size={15} />
              </button>
            </div>
          </div>

          <div className="rounded-xl border border-daw-line bg-daw-bg/55 p-2">
            <p className="text-[10px] font-black uppercase tracking-[0.18em] text-daw-muted">Repair regions</p>
            <div className="mt-2 space-y-1">
              {relevantRegions.length === 0 && <p className="rounded-lg bg-white/[0.04] p-2 text-[11px] text-daw-muted">No regions yet. Scan a clip or add one manually.</p>}
              {relevantRegions.map((region) => (
                <button
                  key={region.id}
                  type="button"
                  onClick={() => onUpdateViewState({ selectedRegionId: region.id })}
                  className={`w-full rounded-lg border px-2 py-2 text-left text-[11px] transition ${
                    region.id === viewState.selectedRegionId ? "border-daw-cyan bg-daw-cyan/10" : "border-white/[0.06] bg-white/[0.035]"
                  }`}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-bold text-daw-text">{REPAIR_PROBLEM_LABELS[region.problemType]}</span>
                    <span className={region.fixed ? "text-emerald-300" : region.enabled ? "text-daw-cyan" : "text-daw-muted"}>{region.fixed ? "FIX" : region.enabled ? "ON" : "OFF"}</span>
                  </span>
                  <span className="mt-1 block text-daw-muted">
                    {region.startSec.toFixed(2)}-{region.endSec.toFixed(2)}s / {Math.round(region.lowHz)}-{Math.round(region.highHz)}Hz
                  </span>
                </button>
              ))}
            </div>
          </div>

          {selectedRegion && (
            <RegionInspector
              region={selectedRegion}
              onChange={(patch) => onUpsertRegion(createSpectralRepairRegion({ ...selectedRegion, ...patch }))}
              onToggle={() => onToggleRegion(selectedRegion.id)}
              onFix={() => onFixRegion(selectedRegion.id)}
              onDelete={() => onDeleteRegion(selectedRegion.id)}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

function RegionInspector({
  region,
  onChange,
  onToggle,
  onFix,
  onDelete,
}: {
  region: SpectralRepairRegion;
  onChange: (patch: Partial<SpectralRepairRegion>) => void;
  onToggle: () => void;
  onFix: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="rounded-xl border border-daw-cyan/25 bg-daw-cyan/[0.08] p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] font-black uppercase tracking-[0.18em] text-daw-cyan">Region inspector</p>
        <Activity size={14} className="text-daw-cyan" />
      </div>
      <div className="mt-2 grid gap-2 text-[11px]">
        <label className="grid gap-1">
          Problem
          <select value={region.problemType} onChange={(event) => onChange({ problemType: event.currentTarget.value as RepairProblemType })} className="min-h-[34px] rounded-lg border border-daw-line bg-daw-bg px-2 text-xs text-daw-text">
            {PROBLEM_OPTIONS.map((problem) => (
              <option key={problem} value={problem}>{REPAIR_PROBLEM_LABELS[problem]}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          Operation
          <select value={region.operation} onChange={(event) => onChange({ operation: event.currentTarget.value as SpectralRepairRegion["operation"] })} className="min-h-[34px] rounded-lg border border-daw-line bg-daw-bg px-2 text-xs text-daw-text">
            {Object.entries(REPAIR_OPERATION_LABELS).map(([id, label]) => (
              <option key={id} value={id}>{label}</option>
            ))}
          </select>
        </label>
        <NumberField label="Start" value={region.startSec} min={0} max={region.endSec - 0.02} step={0.01} onChange={(value) => onChange({ startSec: value })} suffix="s" />
        <NumberField label="End" value={region.endSec} min={region.startSec + 0.02} max={3600} step={0.01} onChange={(value) => onChange({ endSec: value })} suffix="s" />
        <NumberField label="Low" value={region.lowHz} min={20} max={region.highHz - 10} step={10} onChange={(value) => onChange({ lowHz: value })} suffix="Hz" />
        <NumberField label="High" value={region.highHz} min={region.lowHz + 10} max={20000} step={10} onChange={(value) => onChange({ highHz: value })} suffix="Hz" />
        <NumberField label="Amount" value={region.amountDb} min={-18} max={6} step={0.1} onChange={(value) => onChange({ amountDb: value })} suffix="dB" />
        <NumberField label="Strength" value={region.strength} min={0} max={1} step={0.01} onChange={(value) => onChange({ strength: value })} />
      </div>
      <div className="mt-3 grid grid-cols-3 gap-1">
        <button type="button" onClick={onToggle} className="daw-btn daw-btn-ghost !min-h-[34px] text-[10px] font-bold">
          {region.enabled ? <EyeOff size={14} /> : <Eye size={14} />} {region.enabled ? "Bypass" : "Enable"}
        </button>
        <button type="button" onClick={onFix} className="daw-btn daw-btn-primary !min-h-[34px] text-[10px] font-bold">
          <CheckCircle2 size={14} /> {region.fixed ? "Unfix" : "FIX"}
        </button>
        <button type="button" onClick={onDelete} className="daw-btn daw-btn-ghost !min-h-[34px] text-[10px] font-bold text-daw-red">
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </div>
  );
}

function NumberField({ label, value, min, max, step, suffix, onChange }: { label: string; value: number; min: number; max: number; step: number; suffix?: string; onChange: (value: number) => void }) {
  return (
    <label className="grid gap-1">
      <span className="flex justify-between text-daw-muted"><span>{label}</span><span>{Number(value).toFixed(step < 0.1 ? 2 : step < 1 ? 1 : 0)}{suffix ?? ""}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.currentTarget.value))} className="accent-daw-cyan" />
    </label>
  );
}

function resolveSelectedClip(project: Project, selectedClipId: string | null, selectedTrackId: string | null): Clip | null {
  if (selectedClipId) {
    const selected = project.clips.find((clip) => clip.id === selectedClipId);
    if (selected) return selected;
  }
  if (selectedTrackId) {
    const trackClip = project.clips.find((clip) => clip.trackId === selectedTrackId);
    if (trackClip) return trackClip;
  }
  return project.clips[0] ?? null;
}


function createPreviewAudioBuffer(context: BaseAudioContext, channels: Float32Array[], sampleRate: number) {
  const channelCount = Math.max(1, channels.length);
  const frameCount = Math.max(1, channels[0]?.length ?? 1);
  const buffer = context.createBuffer(channelCount, frameCount, sampleRate);
  channels.forEach((channel, index) => {
    buffer.copyToChannel(new Float32Array(channel), index);
  });
  return buffer;
}
