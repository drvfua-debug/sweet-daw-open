"use client";

import { create } from "zustand";
import {
  type AudioFileRef,
  type ArtifactReason,
  type CharacterPluginState,
  type Clip,
  type ClipPanAutomation,
  type CompressorState,
  type ExportBitDepth,
  type ExportSampleRate,
  createClipHistoryItem,
  createEmptyProject,
  createId,
  createTrack,
  inferStemRole,
  migrateProject,
  type ParametricEQState,
  type Project,
  roleToTrackType,
  sanitizeVocalImageMasterState,
  sanitizeVocalImageTrackState,
  type StemRole,
  type Track,
  type TrackAnalysis,
  type VocalImageMasterState,
  type VocalImageTrackState,
} from "@/daw/model/Project";
import { clonePluginChainForTarget, splitClipAtTime } from "@/daw/edit/clipEditing";
import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import { createPluginInstance } from "@/audio/plugins/pluginRegistry";
import type { BuiltinPluginId, PluginInstance, PluginParams } from "@/daw/model/Plugin";
import { applySavedPluginParams, rememberPluginParams } from "@/storage/PluginParamStorage";
import { applyArtifactLightFixToProject, applyAutoMixPlanToProject, applyMasterFinishToProject, applySpectralRepairOpsToProject, createSpectralRepairReport } from "@/daw/mix/mixDoctorApply";
import type { ArtifactProblem, AutoMixPlan, ExportModePlan, MasterFinishMode, MasterFinishReport, MixDoctorMode, MixDoctorReport, SpectralEditOp, SpectralRepairReport } from "@/daw/mix/mixDoctorTypes";
import { applyAimixSpatialToProject, removeAimixSpatialLayersFromProject } from "@/daw/aimixSpatial/aimixSpatialEngine";
import { coerceExportSampleRateSetting } from "@/daw/export/ExportConsistency";
import type { AimixSpatialOptions, AimixSpatialReport } from "@/daw/aimixSpatial/aimixSpatialTypes";
import type { RepairViewState, SpectralRepairRegion } from "@/daw/repair/repairTypes";
import { sanitizeAimixUnmaskState, type SweetAimixUnmaskState, type SweetUnmaskOperation } from "@/daw/aimixUnmask/aimixUnmaskTypes";
import { runAutoReferenceMixPipeline } from "@/daw/auto/autoReferenceMixPipeline";
import { DEFAULT_AUTO_REFERENCE_MIX_RUNTIME, DEFAULT_AUTO_REFERENCE_MIX_SETTINGS, type AutoReferenceMixRuntime, type AutoReferenceMixSettings } from "@/daw/auto/autoReferenceMixTypes";
import {
  sanitizeSweetExportProcessingReport,
  sanitizeSweetPersistedAnalysisCacheSummary,
  type SweetExportProcessingReport,
  type SweetPersistedAnalysisCacheSummary,
} from "@/lib/audio/exportProcessingTypes";

export type ActiveView = "arrange" | "mix" | "repair" | "files";

export type AiTrackSnapshot = {
  id: string;
  gainDb: number;
  pan: number;
  role: StemRole;
  eq: ParametricEQState;
  compressor: CompressorState;
  character: CharacterPluginState;
};

export type AiMasterSnapshot = {
  gainDb: number;
  mixBusTrimDb: number;
  finalOutputTrimDb?: number;
  finalOutputTrimOwner?: Project["master"]["finalOutputTrimOwner"];
  eq: ParametricEQState;
  compressor: CompressorState;
  limiterEnabled: boolean;
  target: Project["master"]["target"];
};

export type AiMixSnapshot = {
  tracks: AiTrackSnapshot[];
  master: AiMasterSnapshot;
};

export type MixDoctorAudition = {
  before: Project;
  after: Project;
  active: "before" | "after";
};

type TransportState = {
  isPlaying: boolean;
  positionSec: number;
  loopEnabled: boolean;
};

type UndoMergeMeta = {
  label: string;
  at: number;
};

type DawStore = {
  project: Project;
  undoStack: Project[];
  undoMerge: UndoMergeMeta | null;
  selectedTrackId: string | null;
  selectedClipId: string | null;
  transport: TransportState;
  waveformPeaks: Record<string, PeakSummary>;
  debugLog: string[];
  activeView: ActiveView;
  aiSnapshot: AiMixSnapshot | null;
  mixDoctorReport: MixDoctorReport | null;
  masterFinishReport: MasterFinishReport | null;
  spectralRepairReport: SpectralRepairReport | null;
  aimixSpatialReport: AimixSpatialReport | null;
  mixDoctorAudition: MixDoctorAudition | null;
  autoReferenceMixSettings: AutoReferenceMixSettings;
  autoReferenceMix: AutoReferenceMixRuntime;
  setAiSnapshot: (snapshot: AiMixSnapshot | null) => void;
  setMixDoctorReport: (report: MixDoctorReport | null) => void;
  setMasterFinishReport: (report: MasterFinishReport | null) => void;
  createMixDoctorSpectralRepair: (problems: ArtifactProblem[], mode: MixDoctorMode) => void;
  applyMixDoctorSpectralRepair: (ops: SpectralEditOp[]) => void;
  applyMixDoctorPlan: (plan: AutoMixPlan) => void;
  applyMixDoctorArtifactFix: (problems: ArtifactProblem[]) => void;
  applyMixDoctorMasterFinish: (mode: MasterFinishMode) => void;
  applyMixDoctorExportMode: (plan: ExportModePlan) => void;
  applyAimixSpatial: (options: Partial<AimixSpatialOptions>) => void;
  removeAimixSpatialLayers: () => void;
  setMixDoctorAudition: (active: "before" | "after") => void;
  clearMixDoctorAudition: () => void;
  restoreAiSnapshot: () => void;
  setAutoReferenceMixEnabled: (enabled: boolean) => void;
  markAutoReferenceMixPending: (payload?: { reason?: string; importedAt?: number }) => void;
  runAutoReferenceMix: () => void;
  runOneTapReferenceFinish: () => void;
  addImportedAsset: (fileRef: AudioFileRef, peaks: PeakSummary) => void;
  addImportedAssetToTrack: (trackId: string, fileRef: AudioFileRef, peaks: PeakSummary, timelineStartSec?: number) => void;
  addRenderedStem: (sourceTrackId: string, fileRef: AudioFileRef, peaks: PeakSummary, muteOriginal: boolean) => void;
  updateTrack: (trackId: string, patch: Partial<Pick<Track, "gainDb" | "pan" | "mute" | "solo" | "name" | "role">>) => void;
  updateClipRole: (clipId: string, role: StemRole) => void;
  addClipIntentTag: (clipId: string, tag: string) => void;
  removeClipIntentTag: (clipId: string, tag: string) => void;
  addClipPluginChain: (clipId: string, pluginIds: BuiltinPluginId[], label: string) => void;
  moveTrack: (trackId: string, direction: "up" | "down") => void;
  deleteTrack: (trackId: string) => void;
  updateTrackAnalysis: (trackId: string, analysis: TrackAnalysis) => void;
  updateTrackEq: (trackId: string, eq: ParametricEQState) => void;
  updateTrackCharacter: (trackId: string, patch: Partial<CharacterPluginState>) => void;
  updateTrackVocalImage: (trackId: string, patch: Partial<VocalImageTrackState>) => void;
  updateTrackCompressor: (trackId: string, patch: Partial<CompressorState>) => void;
  addTrackPlugin: (trackId: string, pluginId: BuiltinPluginId) => void;
  removeTrackPlugin: (trackId: string, pluginInstanceId: string) => void;
  moveTrackPlugin: (trackId: string, pluginInstanceId: string, direction: "up" | "down") => void;
  toggleTrackPlugin: (trackId: string, pluginInstanceId: string) => void;
  updateTrackPluginParams: (trackId: string, pluginInstanceId: string, paramsPatch: PluginParams) => void;
  setMasterGain: (gainDb: number) => void;
  setMasterMixBusTrim: (mixBusTrimDb: number) => void;
  updateMasterTarget: (patch: Partial<Project["master"]["target"]>) => void;
  updateMasterTargetAnalysis: (lastAnalysis: Project["master"]["target"]["lastAnalysis"]) => void;
  updateMasterEq: (eq: ParametricEQState) => void;
  updateMasterCompressor: (patch: Partial<CompressorState>) => void;
  setMasterLimiterEnabled: (enabled: boolean) => void;
  updateMasterVocalImage: (patch: Partial<VocalImageMasterState>) => void;
  updateMasterExportSettings: (patch: Partial<{ exportBitDepth: ExportBitDepth; exportDither: boolean; exportSampleRate: ExportSampleRate; exportNormalizePeak: boolean }>) => void;
  addMasterPlugin: (pluginId: BuiltinPluginId) => void;
  removeMasterPlugin: (pluginInstanceId: string) => void;
  moveMasterPlugin: (pluginInstanceId: string, direction: "up" | "down") => void;
  toggleMasterPlugin: (pluginInstanceId: string) => void;
  updateMasterPluginParams: (pluginInstanceId: string, paramsPatch: PluginParams) => void;
  setBpm: (bpm: number | null) => void;
  setSnapMode: (snapMode: Project["snapMode"]) => void;
  addSectionMarker: (label: string, timeSec: number) => void;
  deleteSectionMarker: (markerId: string) => void;
  setTransport: (patch: Partial<TransportState>) => void;
  setPosition: (positionSec: number) => void;
  selectTrack: (trackId: string | null) => void;
  selectClip: (clipId: string | null) => void;
  moveClip: (clipId: string, timelineStartSec: number, options?: { snap?: boolean }) => void;
  trimClip: (clipId: string, edge: "start" | "end", timeSec: number, options?: { snap?: boolean }) => void;
  splitClip: (clipId: string, splitAtSec: number, options?: { snap?: boolean }) => void;
  duplicateClip: (clipId: string) => void;
  duplicateTrackBelow: (trackId: string, selectedClipOnly?: boolean) => void;
  deleteClip: (clipId: string) => void;
  createArtifactClip: (clipId: string, reason?: ArtifactReason) => void;
  muteArtifactClip: (clipId: string, muted: boolean) => void;
  reduceClipGain: (clipId: string, amountDb?: number) => void;
  createSmartGapFill: (clipId: string) => void;
  updateClipPanAutomation: (clipId: string, automation: ClipPanAutomation | undefined) => void;
  resetClipPanAutomation: (clipId: string) => void;
  applyAutoClipPanMix: (clipIds?: string[]) => void;
  updateRepairViewState: (patch: Partial<RepairViewState>) => void;
  upsertRepairRegion: (region: SpectralRepairRegion) => void;
  deleteRepairRegion: (regionId: string) => void;
  toggleRepairRegion: (regionId: string, enabled?: boolean) => void;
  fixRepairRegion: (regionId: string, fixed?: boolean) => void;
  setAimixUnmaskState: (aimixUnmaskState: SweetAimixUnmaskState) => void;
  updateAimixUnmaskState: (patch: Partial<SweetAimixUnmaskState>) => void;
  upsertAimixUnmaskOperation: (operation: SweetUnmaskOperation) => void;
  toggleAimixUnmaskOperation: (operationId: string, enabled?: boolean) => void;
  fixAimixUnmaskOperation: (operationId: string, fixed?: boolean) => void;
  recordExportProcessingReport: (report: SweetExportProcessingReport) => void;
  updateAnalysisCacheSummary: (summary: SweetPersistedAnalysisCacheSummary | null) => void;
  deleteEmptyTracks: () => void;
  setAllClipsMovementLocked: (locked: boolean) => void;
  freezeClip: (clipId: string, renderedFileRef: AudioFileRef, peaks: PeakSummary) => void;
  unfreezeClip: (clipId: string) => void;
  moveClipToNewTrack: (clipId: string, duplicate?: boolean) => void;
  addClipPlugin: (clipId: string, pluginId: BuiltinPluginId) => void;
  removeClipPlugin: (clipId: string, pluginInstanceId: string) => void;
  moveClipPlugin: (clipId: string, pluginInstanceId: string, direction: "up" | "down") => void;
  toggleClipPlugin: (clipId: string, pluginInstanceId: string) => void;
  updateClipPluginParams: (clipId: string, pluginInstanceId: string, paramsPatch: PluginParams) => void;
  loadProject: (project: Project, waveformPeaks?: Record<string, PeakSummary>) => void;
  undoProject: () => void;
  clearProject: () => void;
  addDebug: (message: string) => void;
  setActiveView: (view: ActiveView) => void;
};

function touchProject(project: Project): Project {
  return {
    ...project,
    updatedAt: new Date().toISOString(),
  };
}

function appendDebugLog(log: string[], message: string) {
  return [`${new Date().toLocaleTimeString()} ${message}`, ...log].slice(0, 80);
}

const MIN_CLIP_DURATION_SEC = 0.02;
const MAX_UNDO_STEPS = 40;
const UNDO_MERGE_WINDOW_MS = 600;

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function snapTimeToProjectGrid(project: Project, seconds: number) {
  if (!Number.isFinite(seconds)) {
    return 0;
  }

  const raw = Math.max(0, seconds);
  if (!project.bpm || project.snapMode === "off") {
    return raw;
  }

  const beatSec = 60 / project.bpm;
  const gridSec = project.snapMode === "bar" ? beatSec * project.timeSignature[0] : beatSec;
  if (!Number.isFinite(gridSec) || gridSec <= 0) {
    return raw;
  }

  const offsetSec = project.downbeatOffsetSec ?? 0;
  return Math.max(0, offsetSec + Math.round((raw - offsetSec) / gridSec) * gridSec);
}

function createUndoMerge(label: string): UndoMergeMeta {
  return {
    label,
    at: Date.now(),
  };
}

function getClipAndFile(project: Project, clipId: string) {
  const clip = project.clips.find((candidate) => candidate.id === clipId);
  if (!clip) {
    return null;
  }

  const file = project.files.find((candidate) => candidate.id === clip.fileId);
  if (!file) {
    return null;
  }

  return { clip, file };
}

export const useDawStore = create<DawStore>((baseSet) => {
  const set = ((partial: Parameters<typeof baseSet>[0]) => {
    baseSet((state) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      if (!next) return next;

      const patch = next as Partial<DawStore>;
      const hasProject = Object.prototype.hasOwnProperty.call(patch, "project");
      const handlesUndo = Object.prototype.hasOwnProperty.call(patch, "undoStack");
      if (hasProject && patch.project && patch.project !== state.project && !handlesUndo) {
        const undoMerge = patch.undoMerge;
        if (
          undoMerge &&
          state.undoMerge?.label === undoMerge.label &&
          undoMerge.at - state.undoMerge.at <= UNDO_MERGE_WINDOW_MS
        ) {
          return {
            ...patch,
            undoStack: state.undoStack,
            undoMerge,
          };
        }

        return {
          ...patch,
          undoStack: [state.project, ...state.undoStack].slice(0, MAX_UNDO_STEPS),
          undoMerge: undoMerge ?? null,
        };
      }

      return patch;
    });
  }) as typeof baseSet;

  return {
  project: createEmptyProject(),
  undoStack: [],
  undoMerge: null,
  selectedTrackId: null,
  selectedClipId: null,
  transport: {
    isPlaying: false,
    positionSec: 0,
    loopEnabled: false,
  },
  waveformPeaks: {},
  debugLog: [],
  activeView: "arrange",
  aiSnapshot: null,
  mixDoctorReport: null,
  masterFinishReport: null,
  spectralRepairReport: null,
  aimixSpatialReport: null,
  mixDoctorAudition: null,
  autoReferenceMixSettings: DEFAULT_AUTO_REFERENCE_MIX_SETTINGS,
  autoReferenceMix: DEFAULT_AUTO_REFERENCE_MIX_RUNTIME,
  setAiSnapshot: (snapshot) => set({ aiSnapshot: snapshot }),
  setMixDoctorReport: (report) => set({ mixDoctorReport: report }),
  setMasterFinishReport: (report) => set({ masterFinishReport: report }),
  createMixDoctorSpectralRepair: (problems, mode) =>
    set((state) => {
      const report = createSpectralRepairReport(problems, mode);
      return {
        spectralRepairReport: report,
        debugLog: appendDebugLog(state.debugLog, `Created Spectral Repair ops: ${report.ops.length}`),
      };
    }),
  applyMixDoctorSpectralRepair: (ops) =>
    set((state) => {
      const before = state.project;
      const after = touchProject(applySpectralRepairOpsToProject(state.project, ops));
      return {
        project: after,
        mixDoctorAudition: {
          before,
          after,
          active: "after",
        },
        debugLog: appendDebugLog(state.debugLog, `Applied Spectral Repair MVP ops: ${ops.length}`),
      };
    }),
  applyMixDoctorPlan: (plan) =>
    set((state) => {
      const before = state.project;
      const after = touchProject(applyAutoMixPlanToProject(state.project, plan));
      return {
        project: after,
        mixDoctorAudition: {
          before,
          after,
          active: "after",
        },
        debugLog: appendDebugLog(state.debugLog, `Applied Mix Doctor layout: ${plan.mode} / ${plan.target}`),
      };
    }),
  applyMixDoctorArtifactFix: (problems) =>
    set((state) => {
      const before = state.project;
      const after = touchProject(applyArtifactLightFixToProject(state.project, problems));
      return {
        project: after,
        mixDoctorAudition: {
          before,
          after,
          active: "after",
        },
        debugLog: appendDebugLog(state.debugLog, `Applied Mix Doctor artifact light fix: ${problems.length} problem(s)`),
      };
    }),
  applyMixDoctorMasterFinish: (mode) =>
    set((state) => {
      const before = state.project;
      const result = applyMasterFinishToProject(state.project, mode);
      const after = touchProject(result.project);
      return {
        project: after,
        masterFinishReport: result.report,
        mixDoctorAudition: {
          before,
          after,
          active: "after",
        },
        debugLog: appendDebugLog(state.debugLog, `Applied Master Finish: ${result.report.label}`),
      };
    }),
  applyMixDoctorExportMode: (plan) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        master: {
          ...state.project.master,
          limiterEnabled: plan.limiterEnabled,
          exportNormalizePeak: plan.normalizePeak,
          exportBitDepth: plan.bitDepth,
          exportDither: plan.bitDepth === "pcm16" ? state.project.master.exportDither : false,
          exportSampleRate: plan.sampleRate,
        },
      }),
      debugLog: appendDebugLog(state.debugLog, `Applied Mix Doctor export mode: ${plan.mode}`),
    })),
  applyAimixSpatial: (options) =>
    set((state) => {
      const before = state.project;
      const result = applyAimixSpatialToProject(state.project, options, {
        peaksByFileId: state.waveformPeaks,
        referenceProfile: state.mixDoctorReport?.referenceProfile ?? null,
        referenceDelta: state.mixDoctorReport?.referenceDelta ?? null,
        stemFeatureReports: state.mixDoctorReport?.stemFeatureReports ?? [],
      });
      const after = touchProject(result.project);
      return {
        project: after,
        aimixSpatialReport: result.report,
        mixDoctorAudition: {
          before,
          after,
          active: "after",
        },
        selectedTrackId: state.selectedTrackId,
        selectedClipId: state.selectedClipId,
        debugLog: appendDebugLog(
          state.debugLog,
          `Applied AIMIX Spatial v2: ${result.report.cleanedTracks} cleaned track(s), ${result.report.pannedTracks} panned track(s), ${result.report.pannedClips} panned clip(s), ${result.report.generatedTracks} new track(s)`,
        ),
      };
    }),
  removeAimixSpatialLayers: () =>
    set((state) => {
      const before = state.project;
      const result = removeAimixSpatialLayersFromProject(state.project);
      const after = touchProject(result.project);
      const selectedTrackId =
        state.selectedTrackId && after.tracks.some((track) => track.id === state.selectedTrackId)
          ? state.selectedTrackId
          : after.tracks[0]?.id ?? null;
      return {
        project: after,
        aimixSpatialReport: {
          ok: true,
          mode: "clean-spatial",
          cleanedTracks: 0,
          generatedTracks: 0,
          generatedClips: 0,
          removedTracks: result.removedTracks,
          removedClips: result.removedClips,
          pannedTracks: 0,
          pannedClips: 0,
          restoredPannedTracks: result.restoredPannedTracks,
          restoredPannedClips: result.restoredPannedClips,
          warnings: [],
          actions: [`Removed ${result.removedTracks} legacy AIMIX Spatial track(s) and ${result.removedClips} clip(s).`],
        },
        mixDoctorAudition: {
          before,
          after,
          active: "after",
        },
        selectedTrackId,
        selectedClipId:
          state.selectedClipId && after.clips.some((clip) => clip.id === state.selectedClipId)
            ? state.selectedClipId
            : null,
        debugLog: appendDebugLog(
          state.debugLog,
          `Removed legacy AIMIX Spatial layers: ${result.removedTracks} track(s), ${result.removedClips} clip(s)`,
        ),
      };
    }),
  setMixDoctorAudition: (active) =>
    set((state) => {
      if (!state.mixDoctorAudition) return {};
      const project = active === "before" ? state.mixDoctorAudition.before : state.mixDoctorAudition.after;
      return {
        project,
        undoStack: state.undoStack,
        undoMerge: null,
        mixDoctorAudition: {
          ...state.mixDoctorAudition,
          active,
        },
        debugLog: appendDebugLog(state.debugLog, `Mix Doctor audition: ${active}`),
      };
    }),
  clearMixDoctorAudition: () =>
    set((state) => ({
      mixDoctorAudition: null,
      debugLog: appendDebugLog(state.debugLog, "Mix Doctor audition cleared"),
    })),
  restoreAiSnapshot: () =>
    set((state) => {
      if (!state.aiSnapshot) return {};
      const { tracks: snapTracks, master: snapMaster } = state.aiSnapshot;
      return {
        project: touchProject({
          ...state.project,
          tracks: state.project.tracks.map((track) => {
            const snap = snapTracks.find((t) => t.id === track.id);
            if (!snap) return track;
            return {
              ...track,
              gainDb: snap.gainDb,
              pan: snap.pan,
              role: snap.role,
              eq: JSON.parse(JSON.stringify(snap.eq)),
              compressor: JSON.parse(JSON.stringify(snap.compressor)),
              character: JSON.parse(JSON.stringify(snap.character)),
            };
          }),
          master: {
            ...state.project.master,
            gainDb: snapMaster.gainDb,
            mixBusTrimDb: snapMaster.mixBusTrimDb,
            finalOutputTrimDb: snapMaster.finalOutputTrimDb,
            finalOutputTrimOwner: snapMaster.finalOutputTrimOwner,
            eq: JSON.parse(JSON.stringify(snapMaster.eq)),
            compressor: JSON.parse(JSON.stringify(snapMaster.compressor)),
            limiterEnabled: snapMaster.limiterEnabled,
            target: JSON.parse(JSON.stringify(snapMaster.target)),
          },
        }),
        aiSnapshot: null,
      };
    }),

  setAutoReferenceMixEnabled: (enabled) =>
    set((state) => ({
      autoReferenceMixSettings: {
        ...state.autoReferenceMixSettings,
        enabled,
        mode: enabled ? state.autoReferenceMixSettings.mode === "off" ? "reference-then-spatial-auto" : state.autoReferenceMixSettings.mode : "off",
      },
      autoReferenceMix: {
        ...state.autoReferenceMix,
        enabled,
        pending: enabled ? state.autoReferenceMix.pending : false,
        status: enabled ? state.autoReferenceMix.status : "idle",
        message: enabled ? state.autoReferenceMix.message : "Auto Reference Mix is off.",
        vocalClarityGate: enabled ? state.autoReferenceMix.vocalClarityGate ?? null : null,
      },
      debugLog: appendDebugLog(state.debugLog, enabled ? "Auto Reference Mix enabled" : "Auto Reference Mix disabled"),
    })),

  markAutoReferenceMixPending: (payload) =>
    set((state) => ({
      autoReferenceMix: {
        ...state.autoReferenceMix,
        enabled: state.autoReferenceMixSettings.enabled,
        pending: state.autoReferenceMixSettings.enabled,
        status: state.autoReferenceMixSettings.enabled ? "waiting-for-files" : "idle",
        lastImportAt: payload?.importedAt ?? Date.now(),
        message: state.autoReferenceMixSettings.enabled
          ? "Audio is ready; Auto AIMIX can run with Reference or Sweet No-Reference Finish."
          : "Auto Reference Mix is off.",
          vocalClarityGate: null,
      },
      debugLog: appendDebugLog(state.debugLog, `Auto Reference Mix pending${payload?.reason ? `: ${payload.reason}` : ""}`),
    })),

  runAutoReferenceMix: () =>
    set((state) => {
      if (!state.autoReferenceMixSettings.enabled || !state.autoReferenceMix.pending) return {};
      const result = runAutoReferenceMixPipeline(state.project, state.waveformPeaks, state.autoReferenceMixSettings);
      if (result.status === "waiting-for-files" || result.status === "idle") {
        return {
          autoReferenceMix: {
            ...state.autoReferenceMix,
            pending: result.status === "waiting-for-files",
            status: result.status,
            lastRunAt: Date.now(),
            message: result.message,
            vocalClarityGate: result.vocalClarityGate ?? null,
          },
          debugLog: appendDebugLog(state.debugLog, result.message),
        };
      }
      if (!result.ok && result.status === "error") {
        return {
          autoReferenceMix: {
            ...state.autoReferenceMix,
            pending: false,
            status: "error",
            lastRunAt: Date.now(),
            message: result.message,
            vocalClarityGate: result.vocalClarityGate ?? null,
          },
          debugLog: appendDebugLog(state.debugLog, result.message),
        };
      }
      return {
        project: touchProject(result.after),
        mixDoctorReport: result.mixDoctorReport ?? state.mixDoctorReport,
        aimixSpatialReport: result.spatialReport ?? state.aimixSpatialReport,
        mixDoctorAudition: {
          before: result.before,
          after: result.after,
          active: "after",
        },
        autoReferenceMix: {
          ...state.autoReferenceMix,
          pending: false,
          status: result.status,
          lastRunAt: Date.now(),
          message: result.message,
          vocalClarityGate: result.vocalClarityGate ?? null,
        },
        debugLog: [
          ...result.decisions.slice(0, 8).map((decision) => `${new Date().toLocaleTimeString()} ${decision}`),
          ...appendDebugLog(state.debugLog, result.message),
        ].slice(0, 80),
      };
    }),

  runOneTapReferenceFinish: () =>
    set((state) => {
      const oneTapSettings: AutoReferenceMixSettings = {
        ...state.autoReferenceMixSettings,
        enabled: true,
        mode: state.autoReferenceMixSettings.mode === "off" ? "reference-then-spatial-auto" : state.autoReferenceMixSettings.mode,
        oneTapPrimary: true,
        requireReference: false,
      };
      const startedAt = new Date().toLocaleTimeString();
      const result = runAutoReferenceMixPipeline(state.project, state.waveformPeaks, oneTapSettings);
      const debugPrefix = `${startedAt} One-Tap Finish`;

      if (result.status === "waiting-for-files" || result.status === "idle") {
        return {
          autoReferenceMixSettings: oneTapSettings,
          autoReferenceMix: {
            ...state.autoReferenceMix,
            enabled: true,
            pending: false,
            status: result.status,
            lastRunAt: Date.now(),
            message: result.message,
            vocalClarityGate: result.vocalClarityGate ?? null,
          },
          debugLog: appendDebugLog(state.debugLog, `${debugPrefix}: ${result.message}`),
        };
      }

      if (!result.ok && result.status === "error") {
        return {
          autoReferenceMixSettings: oneTapSettings,
          autoReferenceMix: {
            ...state.autoReferenceMix,
            enabled: true,
            pending: false,
            status: "error",
            lastRunAt: Date.now(),
            message: result.message,
            vocalClarityGate: result.vocalClarityGate ?? null,
          },
          debugLog: appendDebugLog(state.debugLog, `${debugPrefix} error: ${result.message}`),
        };
      }

      return {
        project: touchProject(result.after),
        mixDoctorReport: result.mixDoctorReport ?? state.mixDoctorReport,
        aimixSpatialReport: result.spatialReport ?? state.aimixSpatialReport,
        mixDoctorAudition: {
          before: result.before,
          after: result.after,
          active: "after" as const,
        },
        autoReferenceMixSettings: oneTapSettings,
        autoReferenceMix: {
          ...state.autoReferenceMix,
          enabled: true,
          pending: false,
          status: result.status,
          lastRunAt: Date.now(),
          message: result.message,
          vocalClarityGate: result.vocalClarityGate ?? null,
        },
        debugLog: [
          ...result.decisions.slice(0, 8).map((decision) => `${new Date().toLocaleTimeString()} ${decision}`),
          ...appendDebugLog(state.debugLog, `${debugPrefix} applied: ${result.status}`),
        ].slice(0, 80),
      };
    }),

  addImportedAsset: (fileRef, peaks) =>
    set((state) => {
      const trackName = fileRef.name.replace(/\.[^.]+$/, "");
      const role = fileRef.role ?? inferStemRole(trackName);
      const track = createTrack(trackName, state.project.tracks.length, roleToTrackType(role), role);
      const clip: Clip = {
        id: createId("clip"),
        trackId: track.id,
        fileId: fileRef.id,
        role,
        intentTags: [],
        actionHistory: [createClipHistoryItem("import", `Imported as ${role}`, { role })],
        timelineStartSec: 0,
        sourceStartSec: 0,
        durationSec: fileRef.durationSec,
        gainDb: 0,
        fadeInSec: 0,
        fadeOutSec: 0,
        reverse: false,
        stretchRatio: null,
        pitchShiftSemitones: null,
        lockedToGrid: true,
        movementLocked: true,
        insertChain: [],
        createdBy: "import",
      };

      return {
        project: touchProject({
          ...state.project,
          sampleRate: state.project.files.length === 0 ? fileRef.sampleRate : state.project.sampleRate,
          files: [...state.project.files, fileRef],
          tracks: [...state.project.tracks, track],
          clips: [...state.project.clips, clip],
          analysis: {
            ...state.project.analysis,
            importedAt: new Date().toISOString(),
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
            notes: [
              ...state.project.analysis.notes,
              `Imported ${fileRef.name}: ${fileRef.durationSec.toFixed(2)}s, ${fileRef.sampleRate}Hz, ${fileRef.channelCount}ch`,
            ],
          },
        }),
        selectedTrackId: track.id,
        selectedClipId: clip.id,
        waveformPeaks: {
          ...state.waveformPeaks,
          [fileRef.id]: peaks,
        },
        autoReferenceMix: {
          ...state.autoReferenceMix,
          enabled: state.autoReferenceMixSettings.enabled,
          pending: state.autoReferenceMixSettings.enabled,
          status: state.autoReferenceMixSettings.enabled ? "waiting-for-files" : "idle",
          lastImportAt: Date.now(),
          message: state.autoReferenceMixSettings.enabled ? "Waiting for reference and stems before Auto AIMIX." : state.autoReferenceMix.message,
          vocalClarityGate: null,
        },
      };
    }),

  addImportedAssetToTrack: (trackId, fileRef, peaks, timelineStartSec = 0) =>
    set((state) => {
      const track = state.project.tracks.find((candidate) => candidate.id === trackId);
      if (!track) return {};

      const clip: Clip = {
        id: createId("clip"),
        trackId,
        fileId: fileRef.id,
        role: track.role,
        intentTags: [],
        actionHistory: [createClipHistoryItem("importToTrack", `Imported to ${track.name}`, { trackId })],
        timelineStartSec: Math.max(0, timelineStartSec),
        sourceStartSec: 0,
        durationSec: fileRef.durationSec,
        gainDb: 0,
        fadeInSec: 0,
        fadeOutSec: 0,
        reverse: false,
        stretchRatio: null,
        pitchShiftSemitones: null,
        lockedToGrid: true,
        movementLocked: true,
        insertChain: [],
        createdBy: "import",
      };

      return {
        project: touchProject({
          ...state.project,
          files: [...state.project.files, { ...fileRef, role: track.role }],
          clips: [...state.project.clips, clip],
          analysis: {
            ...state.project.analysis,
            importedAt: new Date().toISOString(),
            userAgent: typeof navigator !== "undefined" ? navigator.userAgent : undefined,
            notes: [
              ...state.project.analysis.notes,
              `Imported ${fileRef.name} to ${track.name}: ${fileRef.durationSec.toFixed(2)}s`,
            ],
          },
        }),
        selectedTrackId: trackId,
        selectedClipId: clip.id,
        waveformPeaks: {
          ...state.waveformPeaks,
          [fileRef.id]: peaks,
        },
        autoReferenceMix: {
          ...state.autoReferenceMix,
          enabled: state.autoReferenceMixSettings.enabled,
          pending: state.autoReferenceMixSettings.enabled,
          status: state.autoReferenceMixSettings.enabled ? "waiting-for-files" : "idle",
          lastImportAt: Date.now(),
          message: state.autoReferenceMixSettings.enabled ? "Waiting for reference and stems before Auto AIMIX." : state.autoReferenceMix.message,
          vocalClarityGate: null,
        },
        debugLog: appendDebugLog(state.debugLog, `Imported ${fileRef.name} to ${track.name}`),
      };
    }),

  addRenderedStem: (sourceTrackId, fileRef, peaks, muteOriginal) =>
    set((state) => {
      const sourceTrack = state.project.tracks.find((track) => track.id === sourceTrackId);
      const sourceClip = state.project.clips.find((clip) => clip.trackId === sourceTrackId);
      const trackName = fileRef.name.replace(/\.[^.]+$/, "");
      const role = fileRef.role ?? sourceTrack?.role ?? inferStemRole(trackName);
      const baseTrack = createTrack(trackName, state.project.tracks.length, roleToTrackType(role), role);
      const track = sourceTrack
        ? {
            ...baseTrack,
            gainDb: sourceTrack.gainDb,
            pan: sourceTrack.pan,
            solo: sourceTrack.solo,
            color: sourceTrack.color,
            eq: {
              ...sourceTrack.eq,
              bands: sourceTrack.eq.bands.map((band) => ({ ...band })),
            },
            character: { ...sourceTrack.character },
            vocalImage: { ...sourceTrack.vocalImage },
            compressor: { ...sourceTrack.compressor },
            insertChain: clonePluginChainForTarget(sourceTrack.insertChain, "track"),
            sends: sourceTrack.sends.map((send) => ({ ...send })),
          }
        : baseTrack;
      const clip: Clip = {
        id: createId("clip"),
        trackId: track.id,
        fileId: fileRef.id,
        role,
        intentTags: [],
        actionHistory: [
          createClipHistoryItem("render", "Rendered stem", {
            sourceTrackId,
            inheritedTrackProcessing: Boolean(sourceTrack),
            inheritedClipProcessing: Boolean(sourceClip),
          }),
        ],
        timelineStartSec: 0,
        sourceStartSec: 0,
        durationSec: fileRef.durationSec,
        gainDb: sourceClip?.gainDb ?? 0,
        fadeInSec: sourceClip?.fadeInSec ?? 0,
        fadeOutSec: sourceClip?.fadeOutSec ?? 0,
        reverse: false,
        stretchRatio: null,
        pitchShiftSemitones: null,
        lockedToGrid: true,
        movementLocked: true,
        insertChain: sourceClip ? clonePluginChainForTarget(sourceClip.insertChain, "clip") : [],
        panAutomation: sourceClip?.panAutomation
          ? {
              ...sourceClip.panAutomation,
              anchorPoints: sourceClip.panAutomation.anchorPoints.map((point) => ({ ...point })),
            }
          : undefined,
        createdBy: "render",
      };

      return {
        project: touchProject({
          ...state.project,
          files: [...state.project.files, fileRef],
          tracks: [
            ...state.project.tracks.map((candidate) =>
              muteOriginal && candidate.id === sourceTrackId ? { ...candidate, mute: true } : candidate,
            ),
            track,
          ],
          clips: [...state.project.clips, clip],
          analysis: {
            ...state.project.analysis,
            notes: [
              ...state.project.analysis.notes,
              `Rendered ${sourceTrack?.name ?? "track"} to ${fileRef.name}; track and clip processing settings were inherited post-render.`,
            ],
          },
        }),
        selectedTrackId: track.id,
        selectedClipId: clip.id,
        waveformPeaks: {
          ...state.waveformPeaks,
          [fileRef.id]: peaks,
        },
      };
    }),

  updateTrack: (trackId, patch) =>
    set((state) => {
      const role = patch.role;
      const affectedFileIds = role
        ? new Set(state.project.clips.filter((clip) => clip.trackId === trackId).map((clip) => clip.fileId))
        : null;

      return {
        project: touchProject({
          ...state.project,
          tracks: state.project.tracks.map((track) =>
            track.id === trackId
              ? {
                  ...track,
                  ...patch,
                  type: role ? roleToTrackType(role) : track.type,
                  character: role ? { ...track.character } : track.character,
                }
              : track,
          ),
          clips: role
            ? state.project.clips.map((clip) => (clip.trackId === trackId ? { ...clip, role } : clip))
            : state.project.clips,
          files: role && affectedFileIds
            ? state.project.files.map((file) => (affectedFileIds.has(file.id) ? { ...file, role } : file))
            : state.project.files,
        }),
        undoMerge:
          Object.prototype.hasOwnProperty.call(patch, "gainDb") || Object.prototype.hasOwnProperty.call(patch, "pan")
            ? createUndoMerge(`track-level:${trackId}`)
            : undefined,
      };
    }),

  updateClipRole: (clipId, role) =>
    set((state) => {
      const targetClip = state.project.clips.find((clip) => clip.id === clipId);
      if (!targetClip) return {};

      return {
        project: touchProject({
          ...state.project,
          tracks: state.project.tracks.map((track) =>
            track.id === targetClip.trackId
              ? {
                  ...track,
                  role,
                  type: roleToTrackType(role),
                }
              : track,
          ),
          clips: state.project.clips.map((clip) => (clip.trackId === targetClip.trackId ? { ...clip, role } : clip)),
          files: state.project.files.map((file) => (file.id === targetClip.fileId ? { ...file, role } : file)),
        }),
        selectedClipId: clipId,
        selectedTrackId: targetClip.trackId,
      };
    }),

  addClipIntentTag: (clipId, tag) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        clips: state.project.clips.map((clip) =>
          clip.id === clipId
            ? {
                ...clip,
                intentTags: Array.from(new Set([...(clip.intentTags ?? []), tag])).slice(0, 16),
                actionHistory: [
                  createClipHistoryItem("tag", `Tagged ${tag}`, { tag }),
                  ...(clip.actionHistory ?? []),
                ].slice(0, 40),
              }
            : clip,
        ),
      }),
      selectedClipId: clipId,
    })),

  removeClipIntentTag: (clipId, tag) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        clips: state.project.clips.map((clip) =>
          clip.id === clipId
            ? {
                ...clip,
                intentTags: (clip.intentTags ?? []).filter((entry) => entry !== tag),
                actionHistory: [
                  createClipHistoryItem("tag", `Removed tag ${tag}`, { tag }),
                  ...(clip.actionHistory ?? []),
                ].slice(0, 40),
              }
            : clip,
        ),
      }),
      selectedClipId: clipId,
    })),

  addClipPluginChain: (clipId, pluginIds, label) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        clips: state.project.clips.map((clip) =>
          clip.id === clipId
            ? {
                ...clip,
                insertChain: [
                  ...clip.insertChain,
                  ...pluginIds.map((pluginId) => applySavedPluginParams(createPluginInstance(pluginId, "clip"))),
                ],
                actionHistory: [
                  createClipHistoryItem("oneTapAction", label, {
                    pluginCount: pluginIds.length,
                    role: clip.role,
                  }),
                  ...(clip.actionHistory ?? []),
                ].slice(0, 40),
              }
            : clip,
        ),
      }),
      selectedClipId: clipId,
    })),

  moveTrack: (trackId, direction) =>
    set((state) => {
      const tracks = moveTrackInList(state.project.tracks, trackId, direction);
      if (tracks === state.project.tracks) return {};

      return {
        project: touchProject({
          ...state.project,
          tracks,
        }),
      };
    }),

  deleteTrack: (trackId) =>
    set((state) => {
      const trackIndex = state.project.tracks.findIndex((track) => track.id === trackId);
      if (trackIndex < 0) return {};

      const track = state.project.tracks[trackIndex];
      const tracks = state.project.tracks.filter((candidate) => candidate.id !== trackId);
      const removedClipIds = new Set(state.project.clips.filter((clip) => clip.trackId === trackId).map((clip) => clip.id));
      const selectedTrackId =
        state.selectedTrackId === trackId
          ? tracks[Math.min(trackIndex, Math.max(0, tracks.length - 1))]?.id ?? null
          : state.selectedTrackId;

      return {
        project: touchProject({
          ...state.project,
          tracks,
          clips: state.project.clips.filter((clip) => clip.trackId !== trackId),
        }),
        selectedTrackId,
        selectedClipId:
          state.selectedClipId && removedClipIds.has(state.selectedClipId)
            ? null
            : state.selectedClipId,
        debugLog: appendDebugLog(state.debugLog, `Deleted track ${track?.name ?? trackId}`),
      };
    }),

  updateTrackAnalysis: (trackId, analysis) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        tracks: state.project.tracks.map((track) => (track.id === trackId ? { ...track, analysis } : track)),
      }),
    })),

  updateTrackEq: (trackId, eq) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        tracks: state.project.tracks.map((track) => (track.id === trackId ? { ...track, eq } : track)),
      }),
      undoMerge: createUndoMerge(`track-eq:${trackId}`),
    })),

  updateTrackCharacter: (trackId, patch) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        tracks: state.project.tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                character: {
                  ...track.character,
                  ...patch,
                },
              }
            : track,
        ),
      }),
      undoMerge: createUndoMerge(`track-character:${trackId}`),
    })),

  updateTrackVocalImage: (trackId, patch) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        tracks: state.project.tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                vocalImage: sanitizeVocalImageTrackState({
                  ...track.vocalImage,
                  ...patch,
                }),
              }
            : track,
        ),
      }),
      undoMerge: createUndoMerge(`track-vocal-image:${trackId}`),
      debugLog:
        patch.enabled === undefined
          ? state.debugLog
          : appendDebugLog(
              state.debugLog,
              patch.enabled ? "Vocal Image Layer enabled on track" : "Vocal Image Layer disabled on track",
            ),
    })),

  updateTrackCompressor: (trackId, patch) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        tracks: state.project.tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                compressor: {
                  ...track.compressor,
                  ...patch,
                },
              }
            : track,
        ),
      }),
      undoMerge: createUndoMerge(`track-compressor:${trackId}`),
    })),

  addTrackPlugin: (trackId, pluginId) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        tracks: state.project.tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                insertChain: [...track.insertChain, applySavedPluginParams(createPluginInstance(pluginId, "track"))],
              }
            : track,
        ),
      }),
    })),

  removeTrackPlugin: (trackId, pluginInstanceId) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        tracks: state.project.tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                insertChain: track.insertChain.filter((plugin) => plugin.id !== pluginInstanceId),
              }
            : track,
        ),
      }),
    })),

  moveTrackPlugin: (trackId, pluginInstanceId, direction) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        tracks: state.project.tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                insertChain: movePluginInstance(track.insertChain, pluginInstanceId, direction),
              }
            : track,
        ),
      }),
    })),

  toggleTrackPlugin: (trackId, pluginInstanceId) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        tracks: state.project.tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                insertChain: track.insertChain.map((plugin) =>
                  plugin.id === pluginInstanceId ? touchPluginInstance({ ...plugin, enabled: !plugin.enabled }) : plugin,
                ),
              }
            : track,
        ),
      }),
    })),

  updateTrackPluginParams: (trackId, pluginInstanceId, paramsPatch) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        tracks: state.project.tracks.map((track) =>
          track.id === trackId
            ? {
                ...track,
                insertChain: updatePluginParams(track.insertChain, pluginInstanceId, paramsPatch),
              }
            : track,
        ),
      }),
      undoMerge: createUndoMerge(`track-plugin-params:${trackId}:${pluginInstanceId}`),
    })),

  setMasterGain: (gainDb) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        master: {
          ...state.project.master,
          gainDb,
        },
      }),
      undoMerge: createUndoMerge("master-gain"),
    })),

  setMasterMixBusTrim: (mixBusTrimDb) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        master: {
          ...state.project.master,
          mixBusTrimDb: Math.min(0, Math.max(-24, mixBusTrimDb)),
        },
      }),
      undoMerge: createUndoMerge("master-mix-bus-trim"),
    })),

  updateMasterTarget: (patch) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        master: {
          ...state.project.master,
          target: {
            ...state.project.master.target,
            ...patch,
          },
        },
      }),
      undoMerge: createUndoMerge("master-target"),
    })),

  updateMasterTargetAnalysis: (lastAnalysis) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        master: {
          ...state.project.master,
          target: {
            ...state.project.master.target,
            lastAnalysis,
          },
        },
      }),
    })),

  updateMasterEq: (eq) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        master: {
          ...state.project.master,
          eq,
        },
      }),
      undoMerge: createUndoMerge("master-eq"),
    })),

  updateMasterCompressor: (patch) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        master: {
          ...state.project.master,
          compressor: {
            ...state.project.master.compressor,
            ...patch,
          },
        },
      }),
      undoMerge: createUndoMerge("master-compressor"),
    })),

  setMasterLimiterEnabled: (enabled) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        master: {
          ...state.project.master,
          limiterEnabled: enabled,
        },
      }),
    })),

  updateMasterVocalImage: (patch) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        master: {
          ...state.project.master,
          vocalImageLayer: sanitizeVocalImageMasterState({
            ...state.project.master.vocalImageLayer,
            ...patch,
          }),
        },
      }),
      undoMerge: createUndoMerge("master-vocal-image"),
      debugLog: appendDebugLog(
        state.debugLog,
        patch.enabled === undefined
          ? "Updated Vocal Image Layer global settings"
          : patch.enabled
            ? "Vocal Image Layer global enabled"
            : "Vocal Image Layer global disabled",
      ),
    })),

  updateMasterExportSettings: (patch) =>
    set((state) => {
      const normalizedPatch = "exportSampleRate" in patch
        ? {
            ...patch,
            exportSampleRate: coerceExportSampleRateSetting(patch.exportSampleRate),
          }
        : patch;
      return {
        project: touchProject({
          ...state.project,
          master: {
            ...state.project.master,
            ...normalizedPatch,
          },
        }),
        undoMerge: createUndoMerge("master-export-settings"),
      };
    }),

  addMasterPlugin: (pluginId) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        master: {
          ...state.project.master,
          insertChain: [...state.project.master.insertChain, applySavedPluginParams(createPluginInstance(pluginId, "master"))],
        },
      }),
    })),

  removeMasterPlugin: (pluginInstanceId) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        master: {
          ...state.project.master,
          insertChain: state.project.master.insertChain.filter((plugin) => plugin.id !== pluginInstanceId),
        },
      }),
    })),

  moveMasterPlugin: (pluginInstanceId, direction) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        master: {
          ...state.project.master,
          insertChain: movePluginInstance(state.project.master.insertChain, pluginInstanceId, direction),
        },
      }),
    })),

  toggleMasterPlugin: (pluginInstanceId) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        master: {
          ...state.project.master,
          insertChain: state.project.master.insertChain.map((plugin) =>
            plugin.id === pluginInstanceId ? touchPluginInstance({ ...plugin, enabled: !plugin.enabled }) : plugin,
          ),
        },
      }),
    })),

  updateMasterPluginParams: (pluginInstanceId, paramsPatch) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        master: {
          ...state.project.master,
          insertChain: updatePluginParams(state.project.master.insertChain, pluginInstanceId, paramsPatch),
        },
      }),
      undoMerge: createUndoMerge(`master-plugin-params:${pluginInstanceId}`),
    })),

  setBpm: (bpm) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        bpm,
      }),
    })),

  setSnapMode: (snapMode) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        snapMode,
      }),
    })),

  addSectionMarker: (label, timeSec) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        sections: [
          ...state.project.sections,
          {
            id: createId("section"),
            label,
            timeSec: Math.max(0, timeSec),
          },
        ].sort((a, b) => a.timeSec - b.timeSec),
      }),
      debugLog: appendDebugLog(state.debugLog, `Added section marker: ${label}`),
    })),

  deleteSectionMarker: (markerId) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        sections: state.project.sections.filter((marker) => marker.id !== markerId),
      }),
      debugLog: appendDebugLog(state.debugLog, "Deleted section marker"),
    })),

  setTransport: (patch) =>
    set((state) => ({
      transport: {
        ...state.transport,
        ...patch,
      },
    })),

  setPosition: (positionSec) =>
    set((state) => ({
      transport: {
        ...state.transport,
        positionSec,
      },
    })),

  selectTrack: (trackId) =>
    set((state) => {
      const selectedClip = state.selectedClipId
        ? state.project.clips.find((clip) => clip.id === state.selectedClipId)
        : null;
      return {
        selectedTrackId: trackId,
        selectedClipId: selectedClip?.trackId === trackId ? state.selectedClipId : null,
      };
    }),

  selectClip: (clipId) =>
    set((state) => {
      if (!clipId) {
        return { selectedClipId: null };
      }

      const clip = state.project.clips.find((candidate) => candidate.id === clipId);
      if (!clip) {
        return { selectedClipId: null };
      }

      return { selectedClipId: clipId, selectedTrackId: clip.trackId };
    }),

  moveClip: (clipId, timelineStartSec, options = {}) =>
    set((state) => {
      const found = getClipAndFile(state.project, clipId);
      if (!found) return {};

      if (found.clip.movementLocked) {
        return {
          selectedClipId: clipId,
          selectedTrackId: found.clip.trackId,
          debugLog: appendDebugLog(state.debugLog, "Clip move ignored: move lock is enabled"),
        };
      }

      const nextStart = options.snap === false ? Math.max(0, timelineStartSec) : snapTimeToProjectGrid(state.project, timelineStartSec);
      return {
        project: touchProject({
          ...state.project,
          clips: state.project.clips.map((clip) =>
            clip.id === clipId ? { ...clip, timelineStartSec: nextStart } : clip,
          ),
        }),
        selectedClipId: clipId,
        selectedTrackId: found.clip.trackId,
        undoMerge: createUndoMerge(`clip-move:${clipId}`),
      };
    }),

  trimClip: (clipId, edge, timeSec, options = {}) =>
    set((state) => {
      const found = getClipAndFile(state.project, clipId);
      if (!found) return {};

      const { clip, file } = found;
      const clipStart = clip.timelineStartSec;
      const clipEnd = clip.timelineStartSec + clip.durationSec;
      const snappedTime = options.snap === false ? Math.max(0, timeSec) : snapTimeToProjectGrid(state.project, timeSec);
      let nextClip = clip;

      if (edge === "start") {
        const earliestStart = Math.max(0, clip.timelineStartSec - clip.sourceStartSec);
        const nextStart = clamp(snappedTime, earliestStart, clipEnd - MIN_CLIP_DURATION_SEC);
        const sourceDeltaSec = nextStart - clip.timelineStartSec;
        nextClip = {
          ...clip,
          timelineStartSec: nextStart,
          sourceStartSec: clamp(clip.sourceStartSec + sourceDeltaSec, 0, Math.max(0, file.durationSec - MIN_CLIP_DURATION_SEC)),
          durationSec: clipEnd - nextStart,
        };
      } else {
        const latestEnd = clip.timelineStartSec + Math.max(MIN_CLIP_DURATION_SEC, file.durationSec - clip.sourceStartSec);
        const nextEnd = clamp(snappedTime, clipStart + MIN_CLIP_DURATION_SEC, latestEnd);
        nextClip = {
          ...clip,
          durationSec: nextEnd - clipStart,
        };
      }

      return {
        project: touchProject({
          ...state.project,
          clips: state.project.clips.map((candidate) => (candidate.id === clipId ? nextClip : candidate)),
        }),
        selectedClipId: clipId,
        selectedTrackId: clip.trackId,
        undoMerge: createUndoMerge(`clip-trim:${clipId}:${edge}`),
      };
    }),

  splitClip: (clipId, splitAtSec, options = {}) =>
    set((state) => {
      const found = getClipAndFile(state.project, clipId);
      if (!found) return {};

      const { clip } = found;
      const result = splitClipAtTime(clip, splitAtSec, {
        applySnap: Boolean(options.snap),
        snapMode: options.snap ? state.project.snapMode : "manual",
        snapTime: (seconds) => snapTimeToProjectGrid(state.project, seconds),
      });
      const debugMessage = `Split debug ${JSON.stringify(result.debug)}`;

      if (!result.ok) {
        return {
          debugLog: appendDebugLog(state.debugLog, debugMessage),
        };
      }
      const leftClip: Clip = {
        ...result.leftClip,
        actionHistory: [
          createClipHistoryItem("split", `Split at ${result.debug.finalSplitTimeSec?.toFixed(3)}s`, {
            splitSec: result.debug.finalSplitTimeSec ?? splitAtSec,
          }),
          ...(result.leftClip.actionHistory ?? []),
        ].slice(0, 40),
      };
      const rightClip: Clip = {
        ...result.rightClip,
        actionHistory: [
          createClipHistoryItem("split", `Split from ${clip.role} clip`, {
            splitSec: result.debug.finalSplitTimeSec ?? splitAtSec,
          }),
          ...(result.rightClip.actionHistory ?? []),
        ].slice(0, 40),
      };

      return {
        project: touchProject({
          ...state.project,
          clips: state.project.clips.flatMap((candidate) =>
            candidate.id === clipId ? [leftClip, rightClip] : [candidate],
          ),
        }),
        selectedClipId: rightClip.id,
        selectedTrackId: clip.trackId,
        debugLog: appendDebugLog(state.debugLog, debugMessage),
      };
    }),

  duplicateClip: (clipId) =>
    set((state) => {
      const found = getClipAndFile(state.project, clipId);
      if (!found) return {};

      const { clip } = found;
      const duplicate: Clip = {
        ...clip,
        id: createId("clip"),
        timelineStartSec: snapTimeToProjectGrid(state.project, clip.timelineStartSec + clip.durationSec),
        insertChain: clonePluginChainForTarget(clip.insertChain, "clip"),
        actionHistory: [
          createClipHistoryItem("duplicate", "Duplicated clip", { sourceClipId: clip.id }),
          ...(clip.actionHistory ?? []),
        ].slice(0, 40),
        createdBy: "duplicate",
      };
      const sourceIndex = state.project.clips.findIndex((candidate) => candidate.id === clipId);
      const clips = [...state.project.clips];
      clips.splice(sourceIndex + 1, 0, duplicate);

      return {
        project: touchProject({
          ...state.project,
          clips,
        }),
        selectedClipId: duplicate.id,
        selectedTrackId: clip.trackId,
      };
    }),

  duplicateTrackBelow: (trackId, selectedClipOnly = false) =>
    set((state) => {
      const sourceTrackIndex = state.project.tracks.findIndex((track) => track.id === trackId);
      if (sourceTrackIndex < 0) return {};

      const sourceTrack = state.project.tracks[sourceTrackIndex];
      if (!sourceTrack) return {};
      const selectedClip =
        selectedClipOnly && state.selectedClipId
          ? state.project.clips.find((clip) => clip.id === state.selectedClipId && clip.trackId === trackId)
          : null;
      const sourceClips = selectedClip
        ? [selectedClip]
        : state.project.clips.filter((clip) => clip.trackId === trackId);

      if (sourceClips.length === 0) {
        return {
          selectedTrackId: sourceTrack.id,
          debugLog: appendDebugLog(state.debugLog, "Track copy skipped: no clips on selected track"),
        };
      }

      const newTrack: Track = {
        ...sourceTrack,
        id: createId("track"),
        name: `${sourceTrack.name} Copy`,
        color: sourceTrack.color,
        solo: false,
        insertChain: clonePluginChainForTarget(sourceTrack.insertChain, "track"),
        eq: {
          ...sourceTrack.eq,
          bands: sourceTrack.eq.bands.map((band) => ({ ...band })),
        },
        character: { ...sourceTrack.character },
        compressor: { ...sourceTrack.compressor },
        sends: sourceTrack.sends.map((send) => ({ ...send, id: createId("send") })),
        meter: {
          peakDb: -Infinity,
          rmsDb: -Infinity,
          clipping: false,
        },
        analysis: {
          onsetsSec: [...sourceTrack.analysis.onsetsSec],
          analyzedAt: sourceTrack.analysis.analyzedAt,
          analysisVersion: sourceTrack.analysis.analysisVersion,
        },
      };

      const duplicatedClips: Clip[] = sourceClips.map((clip) => ({
        ...clip,
        id: createId("clip"),
        trackId: newTrack.id,
        insertChain: clonePluginChainForTarget(clip.insertChain, "clip"),
        actionHistory: [
          createClipHistoryItem("duplicateTrackBelow", selectedClip ? "Copied clip below track" : "Copied track below", {
            sourceTrackId: sourceTrack.id,
            sourceClipId: clip.id,
          }),
          ...(clip.actionHistory ?? []),
        ].slice(0, 40),
        createdBy: "duplicate",
        frozenState: clip.frozenState
          ? {
              ...clip.frozenState,
              originalInserts: clonePluginChainForTarget(clip.frozenState.originalInserts, "clip"),
            }
          : undefined,
      }));

      const tracks = [...state.project.tracks];
      tracks.splice(sourceTrackIndex + 1, 0, newTrack);

      const lastSourceClipIndex = Math.max(
        ...sourceClips.map((clip) => state.project.clips.findIndex((candidate) => candidate.id === clip.id)),
      );
      const clips = [...state.project.clips];
      clips.splice(Math.max(0, lastSourceClipIndex + 1), 0, ...duplicatedClips);

      return {
        project: touchProject({
          ...state.project,
          tracks,
          clips,
        }),
        selectedTrackId: newTrack.id,
        selectedClipId: duplicatedClips.length === 1 ? duplicatedClips[0]?.id ?? null : null,
        debugLog: appendDebugLog(
          state.debugLog,
          selectedClip ? `Copied selected clip below ${sourceTrack.name}` : `Copied ${sourceTrack.name} below`,
        ),
      };
    }),

  moveClipToNewTrack: (clipId, duplicate = false) =>
    set((state) => {
      const found = getClipAndFile(state.project, clipId);
      if (!found) return {};

      const { clip } = found;
      const sourceTrack = state.project.tracks.find((track) => track.id === clip.trackId);
      const newTrack = createTrack(
        `${sourceTrack?.name ?? "Track"} ${clip.role}`,
        state.project.tracks.length,
        roleToTrackType(clip.role),
        clip.role,
      );
      const movedClip: Clip = {
        ...clip,
        id: duplicate ? createId("clip") : clip.id,
        trackId: newTrack.id,
        insertChain: duplicate ? clonePluginChainForTarget(clip.insertChain, "clip") : clip.insertChain,
        actionHistory: [
          createClipHistoryItem("moveToTrack", "Moved to new track", { trackName: newTrack.name }),
          ...(clip.actionHistory ?? []),
        ].slice(0, 40),
        createdBy: duplicate ? "duplicate" : clip.createdBy,
      };

      return {
        project: touchProject({
          ...state.project,
          tracks: [...state.project.tracks, newTrack],
          clips: duplicate
            ? [...state.project.clips, movedClip]
            : state.project.clips.map((candidate) => (candidate.id === clip.id ? movedClip : candidate)),
        }),
        selectedTrackId: newTrack.id,
        selectedClipId: movedClip.id,
      };
    }),

  deleteClip: (clipId) =>
    set((state) => {
      const clip = state.project.clips.find((candidate) => candidate.id === clipId);
      if (!clip) return {};

      return {
        project: touchProject({
          ...state.project,
          clips: state.project.clips.filter((candidate) => candidate.id !== clipId),
        }),
        selectedClipId: null,
        selectedTrackId: clip.trackId,
      };
    }),

  createArtifactClip: (clipId, reason = "artifact") =>
    set((state) => {
      const clip = state.project.clips.find((candidate) => candidate.id === clipId);
      if (!clip) return {};
      const now = new Date().toISOString();

      return {
        project: touchProject({
          ...state.project,
          clips: state.project.clips.map((candidate) =>
            candidate.id === clipId
              ? {
                  ...candidate,
                  clipKind: "artifact",
                  createdBy: "artifact",
                  artifact: {
                    originalClipId: candidate.artifact?.originalClipId || candidate.id,
                    label: "Artifact",
                    reason,
                    isMuted: false,
                    repairQueue: true,
                    createdAt: now,
                  },
                  intentTags: Array.from(new Set([...candidate.intentTags, "artifact", reason])),
                  actionHistory: [
                    createClipHistoryItem("artifact", `Marked artifact: ${reason}`, { reason }),
                    ...(candidate.actionHistory ?? []),
                  ].slice(0, 40),
                }
              : candidate,
          ),
        }),
        selectedClipId: clipId,
        selectedTrackId: clip.trackId,
        debugLog: appendDebugLog(state.debugLog, "Marked selected clip as artifact"),
      };
    }),

  muteArtifactClip: (clipId, muted) =>
    set((state) => {
      const clip = state.project.clips.find((candidate) => candidate.id === clipId);
      if (!clip) return {};

      return {
        project: touchProject({
          ...state.project,
          clips: state.project.clips.map((candidate) =>
            candidate.id === clipId
              ? {
                  ...candidate,
                  gainDb: muted ? -60 : Math.max(candidate.gainDb, -12),
                  artifact: candidate.artifact
                    ? {
                        ...candidate.artifact,
                        isMuted: muted,
                      }
                    : candidate.artifact,
                  actionHistory: [
                    createClipHistoryItem(muted ? "muteArtifact" : "unmuteArtifact", muted ? "Muted artifact" : "Unmuted artifact", {}),
                    ...(candidate.actionHistory ?? []),
                  ].slice(0, 40),
                }
              : candidate,
          ),
        }),
        selectedClipId: clipId,
        selectedTrackId: clip.trackId,
        undoMerge: createUndoMerge(`clip-pan-automation:${clipId}`),
      };
    }),

  reduceClipGain: (clipId, amountDb = 3) =>
    set((state) => {
      const clip = state.project.clips.find((candidate) => candidate.id === clipId);
      if (!clip) return {};
      const nextGain = clamp(clip.gainDb - Math.abs(amountDb), -60, 24);

      return {
        project: touchProject({
          ...state.project,
          clips: state.project.clips.map((candidate) =>
            candidate.id === clipId
              ? {
                  ...candidate,
                  gainDb: nextGain,
                  actionHistory: [
                    createClipHistoryItem("reduceGain", `Reduced gain ${Math.abs(amountDb).toFixed(1)}dB`, { amountDb: Math.abs(amountDb) }),
                    ...(candidate.actionHistory ?? []),
                  ].slice(0, 40),
                }
              : candidate,
          ),
        }),
        selectedClipId: clipId,
        selectedTrackId: clip.trackId,
      };
    }),

  createSmartGapFill: (clipId) =>
    set((state) => {
      const target = state.project.clips.find((candidate) => candidate.id === clipId);
      if (!target) return {};
      const candidates = state.project.clips
        .filter((candidate) =>
          candidate.id !== clipId &&
          candidate.trackId === target.trackId &&
          candidate.fileId === target.fileId &&
          candidate.clipKind !== "artifact" &&
          candidate.durationSec >= target.durationSec,
        )
        .sort((a, b) => Math.abs(a.timelineStartSec - target.timelineStartSec) - Math.abs(b.timelineStartSec - target.timelineStartSec));
      const source = candidates[0];
      if (!source) {
        return {
          debugLog: appendDebugLog(state.debugLog, "Smart Gap Fill skipped: no similar source clip found on this track"),
        };
      }

      const fadeMs = Math.min(80, Math.max(3, target.durationSec * 1000 * 0.15));
      const patchClip: Clip = {
        ...source,
        id: createId("clip"),
        trackId: target.trackId,
        timelineStartSec: target.timelineStartSec,
        sourceStartSec: source.sourceStartSec,
        durationSec: target.durationSec,
        gainDb: target.gainDb,
        fadeInSec: fadeMs / 1000,
        fadeOutSec: fadeMs / 1000,
        clipKind: "smart-gap-fill",
        createdBy: "smart-gap-fill",
        movementLocked: target.movementLocked,
        insertChain: clonePluginChainForTarget(source.insertChain, "clip"),
        patch: {
          targetTrackId: target.trackId,
          targetStartSec: target.timelineStartSec,
          targetEndSec: target.timelineStartSec + target.durationSec,
          sourceTrackId: source.trackId,
          sourceClipId: source.id,
          sourceStartSec: source.sourceStartSec,
          sourceEndSec: source.sourceStartSec + target.durationSec,
          fadeInMs: fadeMs,
          fadeOutMs: fadeMs,
          crossfadeMs: fadeMs,
          gainDb: target.gainDb,
          score: 72,
          candidateRank: 1,
          analysisSummary: {
            timbreSimilarity: 72,
            energySimilarity: 70,
            rhythmSimilarity: target.role === "drums" ? 74 : 64,
            harmonicSimilarity: target.role === "bass" || target.role === "synth" || target.role === "keys" ? 70 : 58,
            boundarySmoothness: 76,
          },
          locked: true,
          isBypassed: false,
          createdAt: new Date().toISOString(),
        },
        artifact: undefined,
        actionHistory: [
          createClipHistoryItem("smartGapFill", "Filled from similar part", { sourceClipId: source.id, score: 72 }),
          ...(source.actionHistory ?? []),
        ].slice(0, 40),
      };

      const targetIndex = state.project.clips.findIndex((candidate) => candidate.id === clipId);
      const clips = [...state.project.clips];
      clips.splice(Math.max(0, targetIndex + 1), 0, patchClip);

      return {
        project: touchProject({
          ...state.project,
          clips,
        }),
        selectedClipId: patchClip.id,
        selectedTrackId: patchClip.trackId,
        debugLog: appendDebugLog(state.debugLog, "Smart Gap Fill created a patch clip"),
      };
    }),

  updateClipPanAutomation: (clipId, automation) =>
    set((state) => {
      const clip = state.project.clips.find((candidate) => candidate.id === clipId);
      if (!clip) return {};

      return {
        project: touchProject({
          ...state.project,
          clips: state.project.clips.map((candidate) =>
            candidate.id === clipId
              ? {
                  ...candidate,
                  panAutomation: automation,
                  actionHistory: [
                    createClipHistoryItem("panAutomation", automation ? "Updated pan automation" : "Removed pan automation", {}),
                    ...(candidate.actionHistory ?? []),
                  ].slice(0, 40),
                }
              : candidate,
          ),
        }),
        selectedClipId: clipId,
        selectedTrackId: clip.trackId,
      };
    }),

  resetClipPanAutomation: (clipId) =>
    set((state) => {
      const clip = state.project.clips.find((candidate) => candidate.id === clipId);
      if (!clip) return {};

      return {
        project: touchProject({
          ...state.project,
          clips: state.project.clips.map((candidate) =>
            candidate.id === clipId
              ? {
                  ...candidate,
                  panAutomation: undefined,
                  actionHistory: [
                    createClipHistoryItem("resetPanAutomation", "Reset clip pan automation", {}),
                    ...(candidate.actionHistory ?? []),
                  ].slice(0, 40),
                }
              : candidate,
          ),
        }),
        selectedClipId: clipId,
        selectedTrackId: clip.trackId,
      };
    }),

  applyAutoClipPanMix: (clipIds) =>
    set((state) => {
      const targetIds = clipIds && clipIds.length > 0 ? new Set(clipIds) : null;
      const trackIndexes = new Map(state.project.tracks.map((track, index) => [track.id, index]));

      return {
        project: touchProject({
          ...state.project,
          clips: state.project.clips.map((clip) => {
            if (targetIds && !targetIds.has(clip.id)) return clip;
            const track = state.project.tracks.find((candidate) => candidate.id === clip.trackId);
            if (!track) return clip;
            const automation = createRolePanAutomation(clip.durationSec, track.role, trackIndexes.get(track.id) ?? 0);
            return {
              ...clip,
              panAutomation: automation,
              actionHistory: [
                createClipHistoryItem("autoClipPanMix", "Auto clip pan mix", { role: track.role }),
                ...(clip.actionHistory ?? []),
              ].slice(0, 40),
            };
          }),
        }),
        debugLog: appendDebugLog(state.debugLog, targetIds ? "Auto Clip Pan Mix applied to selected clips" : "Auto Clip Pan Mix applied to all clips"),
      };
    }),

  updateRepairViewState: (patch) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        repairViewState: {
          ...state.project.repairViewState,
          ...patch,
        },
      }),
    })),

  upsertRepairRegion: (region) =>
    set((state) => {
      const now = new Date().toISOString();
      const exists = state.project.repairRegions.some((candidate) => candidate.id === region.id);
      const nextRegion = { ...region, updatedAt: now };
      return {
        project: touchProject({
          ...state.project,
          repairRegions: exists
            ? state.project.repairRegions.map((candidate) => (candidate.id === region.id ? nextRegion : candidate))
            : [...state.project.repairRegions, nextRegion].sort((a, b) => a.startSec - b.startSec || a.lowHz - b.lowHz),
          repairViewState: {
            ...state.project.repairViewState,
            selectedRegionId: region.id,
          },
        }),
        debugLog: appendDebugLog(state.debugLog, exists ? "Updated Repair region" : "Added Repair region"),
      };
    }),

  deleteRepairRegion: (regionId) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        repairRegions: state.project.repairRegions.filter((region) => region.id !== regionId),
        repairViewState: {
          ...state.project.repairViewState,
          selectedRegionId: state.project.repairViewState.selectedRegionId === regionId ? undefined : state.project.repairViewState.selectedRegionId,
        },
      }),
      debugLog: appendDebugLog(state.debugLog, "Deleted Repair region"),
    })),

  toggleRepairRegion: (regionId, enabled) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        repairRegions: state.project.repairRegions.map((region) =>
          region.id === regionId ? { ...region, enabled: enabled ?? !region.enabled, updatedAt: new Date().toISOString() } : region,
        ),
      }),
      debugLog: appendDebugLog(state.debugLog, "Toggled Repair region"),
    })),

  fixRepairRegion: (regionId, fixed) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        repairRegions: state.project.repairRegions.map((region) =>
          region.id === regionId ? { ...region, fixed: fixed ?? !region.fixed, updatedAt: new Date().toISOString() } : region,
        ),
      }),
      debugLog: appendDebugLog(state.debugLog, "Updated Repair FIX state"),
    })),

  setAimixUnmaskState: (aimixUnmaskState) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        aimixUnmaskState: sanitizeAimixUnmaskState(aimixUnmaskState),
      }),
      debugLog: appendDebugLog(state.debugLog, "AIMIX Unmask Matrix analysis updated"),
    })),

  updateAimixUnmaskState: (patch) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        aimixUnmaskState: sanitizeAimixUnmaskState({
          ...state.project.aimixUnmaskState,
          ...patch,
        }),
      }),
    })),

  upsertAimixUnmaskOperation: (operation) =>
    set((state) => {
      const exists = state.project.aimixUnmaskState.operations.some((candidate) => candidate.id === operation.id);
      const nextOperation = { ...operation, updatedAt: Date.now() };
      return {
        project: touchProject({
          ...state.project,
          aimixUnmaskState: sanitizeAimixUnmaskState({
            ...state.project.aimixUnmaskState,
            enabled: true,
            operations: exists
              ? state.project.aimixUnmaskState.operations.map((candidate) => (candidate.id === operation.id ? nextOperation : candidate))
              : [...state.project.aimixUnmaskState.operations, nextOperation],
          }),
        }),
        debugLog: appendDebugLog(state.debugLog, exists ? "Updated AIMIX Unmask operation" : "Added AIMIX Unmask operation"),
      };
    }),

  toggleAimixUnmaskOperation: (operationId, enabled) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        aimixUnmaskState: sanitizeAimixUnmaskState({
          ...state.project.aimixUnmaskState,
          operations: state.project.aimixUnmaskState.operations.map((operation) =>
            operation.id === operationId ? { ...operation, enabled: enabled ?? !operation.enabled, updatedAt: Date.now() } : operation,
          ),
        }),
      }),
      debugLog: appendDebugLog(state.debugLog, "Toggled AIMIX Unmask operation"),
    })),

  fixAimixUnmaskOperation: (operationId, fixed) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        aimixUnmaskState: sanitizeAimixUnmaskState({
          ...state.project.aimixUnmaskState,
          enabled: true,
          operations: state.project.aimixUnmaskState.operations.map((operation) =>
            operation.id === operationId ? { ...operation, fixed: fixed ?? !operation.fixed, enabled: true, updatedAt: Date.now() } : operation,
          ),
        }),
      }),
      debugLog: appendDebugLog(state.debugLog, "Updated AIMIX Unmask FIX state"),
    })),

  recordExportProcessingReport: (report) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        exportReports: [
          sanitizeSweetExportProcessingReport(report),
          ...(state.project.exportReports ?? []),
        ].slice(0, 12),
      }),
      undoStack: state.undoStack,
      undoMerge: state.undoMerge,
      debugLog: appendDebugLog(state.debugLog, "Saved export processing report"),
    })),

  updateAnalysisCacheSummary: (summary) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        analysisCacheSummary: sanitizeSweetPersistedAnalysisCacheSummary(summary),
      }),
      undoStack: state.undoStack,
      undoMerge: state.undoMerge,
      debugLog: appendDebugLog(state.debugLog, "Updated lightweight analysis cache summary"),
    })),

  deleteEmptyTracks: () =>
    set((state) => {
      const trackIdsWithClips = new Set(state.project.clips.map((clip) => clip.trackId));
      const tracks = state.project.tracks.filter((track) => trackIdsWithClips.has(track.id));
      const removed = state.project.tracks.length - tracks.length;
      if (removed <= 0) return { debugLog: appendDebugLog(state.debugLog, "No empty tracks to delete") };

      return {
        project: touchProject({
          ...state.project,
          tracks,
        }),
        selectedTrackId: state.selectedTrackId && tracks.some((track) => track.id === state.selectedTrackId) ? state.selectedTrackId : tracks[0]?.id ?? null,
        selectedClipId: state.selectedClipId && state.project.clips.some((clip) => clip.id === state.selectedClipId) ? state.selectedClipId : null,
        debugLog: appendDebugLog(state.debugLog, `Deleted ${removed} empty track(s)`),
      };
    }),

  setAllClipsMovementLocked: (locked) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        clips: state.project.clips.map((clip) => ({
          ...clip,
          movementLocked: locked,
        })),
      }),
      debugLog: appendDebugLog(state.debugLog, locked ? "Clip move lock enabled" : "Clip move lock disabled"),
    })),

  freezeClip: (clipId, renderedFileRef, peaks) =>
    set((state) => {
      const clip = state.project.clips.find((candidate) => candidate.id === clipId);
      if (!clip) return {};

      return {
        project: touchProject({
          ...state.project,
          files: state.project.files.some((file) => file.id === renderedFileRef.id)
            ? state.project.files
            : [...state.project.files, renderedFileRef],
          clips: state.project.clips.map((candidate) =>
            candidate.id === clipId
              ? {
                  ...candidate,
                  fileId: renderedFileRef.id,
                  sourceStartSec: 0,
                  durationSec: renderedFileRef.durationSec,
                  gainDb: 0,
                  fadeInSec: 0,
                  fadeOutSec: 0,
                  insertChain: [],
                  isFrozen: true,
                  frozenRenderFileId: renderedFileRef.id,
                  frozenState: {
                    originalFileId: clip.fileId,
                    originalSourceStartSec: clip.sourceStartSec,
                    originalDurationSec: clip.durationSec,
                    originalInserts: clip.insertChain,
                    originalGainDb: clip.gainDb,
                    originalFadeInSec: clip.fadeInSec,
                    originalFadeOutSec: clip.fadeOutSec,
                  },
                  actionHistory: [
                    createClipHistoryItem("freeze", "Frozen with Clip FX", { renderedFileId: renderedFileRef.id }),
                    ...(candidate.actionHistory ?? []),
                  ].slice(0, 40),
                }
              : candidate,
          ),
        }),
        selectedClipId: clipId,
        selectedTrackId: clip.trackId,
        waveformPeaks: {
          ...state.waveformPeaks,
          [renderedFileRef.id]: peaks,
        },
        debugLog: appendDebugLog(state.debugLog, "Clip FX frozen"),
      };
    }),

  unfreezeClip: (clipId) =>
    set((state) => {
      const clip = state.project.clips.find((candidate) => candidate.id === clipId);
      if (!clip?.frozenState) return {};
      const frozenState = clip.frozenState;

      return {
        project: touchProject({
          ...state.project,
          clips: state.project.clips.map((candidate) =>
            candidate.id === clipId
              ? {
                  ...candidate,
                  fileId: frozenState.originalFileId,
                  sourceStartSec: frozenState.originalSourceStartSec,
                  durationSec: frozenState.originalDurationSec,
                  gainDb: frozenState.originalGainDb,
                  fadeInSec: frozenState.originalFadeInSec,
                  fadeOutSec: frozenState.originalFadeOutSec,
                  insertChain: frozenState.originalInserts,
                  isFrozen: false,
                  frozenRenderFileId: undefined,
                  frozenState: undefined,
                  actionHistory: [
                    createClipHistoryItem("unfreeze", "Unfrozen", {}),
                    ...(candidate.actionHistory ?? []),
                  ].slice(0, 40),
                }
              : candidate,
          ),
        }),
        selectedClipId: clipId,
        selectedTrackId: clip.trackId,
        debugLog: appendDebugLog(state.debugLog, "Clip FX unfrozen"),
      };
    }),

  addClipPlugin: (clipId, pluginId) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        clips: state.project.clips.map((clip) =>
          clip.id === clipId
            ? {
                ...clip,
                insertChain: [...clip.insertChain, applySavedPluginParams(createPluginInstance(pluginId, "clip"))],
              }
            : clip,
        ),
      }),
      selectedClipId: clipId,
    })),

  removeClipPlugin: (clipId, pluginInstanceId) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        clips: state.project.clips.map((clip) =>
          clip.id === clipId
            ? {
                ...clip,
                insertChain: clip.insertChain.filter((plugin) => plugin.id !== pluginInstanceId),
              }
            : clip,
        ),
      }),
      undoMerge: createUndoMerge(`clip-plugin-params:${clipId}:${pluginInstanceId}`),
    })),

  moveClipPlugin: (clipId, pluginInstanceId, direction) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        clips: state.project.clips.map((clip) =>
          clip.id === clipId
            ? {
                ...clip,
                insertChain: movePluginInstance(clip.insertChain, pluginInstanceId, direction),
              }
            : clip,
        ),
      }),
    })),

  toggleClipPlugin: (clipId, pluginInstanceId) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        clips: state.project.clips.map((clip) =>
          clip.id === clipId
            ? {
                ...clip,
                insertChain: clip.insertChain.map((plugin) =>
                  plugin.id === pluginInstanceId ? touchPluginInstance({ ...plugin, enabled: !plugin.enabled }) : plugin,
                ),
              }
            : clip,
        ),
      }),
    })),

  updateClipPluginParams: (clipId, pluginInstanceId, paramsPatch) =>
    set((state) => ({
      project: touchProject({
        ...state.project,
        clips: state.project.clips.map((clip) =>
          clip.id === clipId
            ? {
                ...clip,
                insertChain: updatePluginParams(clip.insertChain, pluginInstanceId, paramsPatch),
              }
            : clip,
        ),
      }),
    })),

  loadProject: (project, waveformPeaks) =>
    set((state) => {
      const migrated = migrateProject(project);
      return {
        project: touchProject(migrated),
        undoStack: [],
        undoMerge: null,
        selectedTrackId: migrated.tracks[0]?.id ?? null,
        selectedClipId: migrated.clips[0]?.id ?? null,
        transport: {
          isPlaying: false,
          positionSec: 0,
          loopEnabled: false,
        },
        waveformPeaks: waveformPeaks !== undefined ? waveformPeaks : state.waveformPeaks,
        mixDoctorReport: null,
        masterFinishReport: null,
        spectralRepairReport: null,
        aimixSpatialReport: null,
        mixDoctorAudition: null,
        autoReferenceMix: {
          ...state.autoReferenceMix,
          pending: false,
          status: "idle",
          message: null,
        },
      };
    }),

  undoProject: () =>
    set((state) => {
      const previousProject = state.undoStack[0];
      if (!previousProject) return {};

      const selectedTrackId = state.selectedTrackId && previousProject.tracks.some((track) => track.id === state.selectedTrackId)
        ? state.selectedTrackId
        : previousProject.tracks[0]?.id ?? null;
      const selectedClipId = state.selectedClipId && previousProject.clips.some((clip) => clip.id === state.selectedClipId)
        ? state.selectedClipId
        : null;

      return {
        project: previousProject,
        undoStack: state.undoStack.slice(1),
        undoMerge: null,
        selectedTrackId,
        selectedClipId,
        debugLog: appendDebugLog(state.debugLog, "Undo"),
      };
    }),

  clearProject: () =>
    set({
      project: createEmptyProject(),
      undoStack: [],
      undoMerge: null,
      selectedTrackId: null,
      selectedClipId: null,
      transport: {
        isPlaying: false,
        positionSec: 0,
        loopEnabled: false,
      },
      waveformPeaks: {},
      debugLog: [],
      mixDoctorReport: null,
      masterFinishReport: null,
      spectralRepairReport: null,
      aimixSpatialReport: null,
      mixDoctorAudition: null,
      autoReferenceMix: DEFAULT_AUTO_REFERENCE_MIX_RUNTIME,
    }),

  addDebug: (message) =>
    set((state) => ({
      debugLog: appendDebugLog(state.debugLog, message),
    })),

  setActiveView: (view) => set({ activeView: view }),
  };
});

function touchPluginInstance(plugin: PluginInstance): PluginInstance {
  return {
    ...plugin,
    updatedAt: new Date().toISOString(),
  };
}

function movePluginInstance(chain: PluginInstance[], pluginInstanceId: string, direction: "up" | "down") {
  const index = chain.findIndex((plugin) => plugin.id === pluginInstanceId);
  if (index < 0) return chain;

  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= chain.length) return chain;

  const next = [...chain];
  const [plugin] = next.splice(index, 1);
  if (!plugin) return chain;
  next.splice(nextIndex, 0, touchPluginInstance(plugin));
  return next;
}

function updatePluginParams(chain: PluginInstance[], pluginInstanceId: string, paramsPatch: PluginParams) {
  return chain.map((plugin) => {
    if (plugin.id !== pluginInstanceId) return plugin;

    const params = {
      ...plugin.params,
      ...paramsPatch,
    };
    rememberPluginParams(plugin.pluginId, params);
    return touchPluginInstance({
      ...plugin,
      params,
    });
  });
}

function createRolePanAutomation(durationSec: number, role: StemRole, trackIndex: number): ClipPanAutomation {
  const safeDuration = Math.max(0.1, durationSec);
  const sideSign = trackIndex % 2 === 0 ? -1 : 1;
  const centeredRoles = new Set<StemRole>(["vocal", "drums", "bass", "reference"]);

  const createAutomation = (pan: number, depth: number): ClipPanAutomation => ({
    enabled: true,
    depth,
    smoothingMs: 45,
    bypassed: false,
    anchorPoints: [
      { id: createId("pan"), time: 0, pan, curve: "smooth" },
      { id: createId("pan"), time: safeDuration * 0.5, pan: pan * 0.85, curve: "easeInOut" },
      { id: createId("pan"), time: safeDuration, pan, curve: "smooth" },
    ],
  });

  if (centeredRoles.has(role)) {
    return createAutomation(0, 0.2);
  }

  if (role === "fx") {
    return createAutomation(sideSign * 0.42, 1);
  }

  if (role === "guitar" || role === "synth" || role === "keys" || role === "music" || role === "loop") {
    return createAutomation(sideSign * 0.28, 0.85);
  }

  if (role === "backingVocal") {
    return createAutomation(sideSign * 0.2, 0.75);
  }

  return createAutomation(sideSign * 0.16, 0.65);
}

function moveTrackInList(tracks: Track[], trackId: string, direction: "up" | "down") {
  const index = tracks.findIndex((track) => track.id === trackId);
  if (index < 0) return tracks;

  const nextIndex = direction === "up" ? index - 1 : index + 1;
  if (nextIndex < 0 || nextIndex >= tracks.length) return tracks;

  const next = [...tracks];
  const [track] = next.splice(index, 1);
  if (!track) return tracks;
  next.splice(nextIndex, 0, track);
  return next;
}




