"use client";

import React, { useState, useRef, useEffect } from "react";
import { BookOpen, Layers, Wand2, Upload, LayoutGrid, Maximize2, Minimize2, Play, Square } from "lucide-react";
import { detectBpmFromBuffer, type BpmDetectionResult } from "@/audio/analysis/BpmDetector";
import { useDawStore } from "@/daw/store/dawStore";
import { usePlayback } from "@/ui/hooks/usePlayback";
import { useMetering } from "@/ui/hooks/useMetering";
import { useStorageSync } from "@/ui/hooks/useStorageSync";
import { audioEngine, type AudioImportProgress } from "@/audio/engine/AudioEngine";
import { buildPeakSummary } from "@/audio/analysis/PeakBuilder";
import { hasBlockingImportIssue, summarizeImportValidationIssues, validateImportFiles } from "@/audio/import/validateImportFiles";
import { expandAudioFilesFromZip, isIgnoredAudioImportEntryName, isZipFile } from "@/daw/project/zipImport";
import { inferNewAudioImportRole } from "@/daw/project/importRole";
import type { AudioFileRef, StemRole } from "@/daw/model/Project";
import type { BuiltinPluginId } from "@/daw/model/Plugin";
import { describeStableExportSampleRate, resolveStableExportSampleRate } from "@/daw/export/ExportConsistency";
import { reserveMasterExportFilename } from "@/daw/export/MasterExportFilename";
import type { SweetProcessingJobProgress } from "@/lib/audio/processingTypes";
import type { SweetProcessingQueue } from "@/lib/audio/processingJobs";
import type { DitherOptions, WavBitDepth } from "@/audio/export/WavEncoder";

// Sub-views & Components
import { TransportBar } from "./TransportBar";
import { ArrangeView } from "../views/ArrangeView";
import { MixConsole } from "../views/MixConsole";
import { FileManager } from "../views/FileManager";
import { SpectralRepairView } from "../views/SpectralRepairView";
import { AiMixAssistantPanel } from "./AiMixAssistantPanel";
import { AiMixSpatialPanel } from "./AiMixSpatialPanel";

// Plugins overlays
import { EQPanel } from "../plugins/EQPanel";
import { CharacterPanel } from "../plugins/CharacterPanel";
import { PluginBrowserSheet } from "../plugins/PluginBrowserSheet";
import { PluginEditorSheet } from "../plugins/PluginEditorSheet";

type AutoBpmAsset = {
  fileRef: Pick<AudioFileRef, "name" | "originalName" | "role" | "durationSec">;
  buffer: AudioBuffer;
};

type AutoBpmResult = {
  bpm: number;
  confidence: number;
  sourceName: string;
  sourceRole: StemRole;
  analyzedDurationSec: number;
  candidates: BpmDetectionResult["candidates"];
};

const AUTO_BPM_MIN_DURATION_SEC = 8;

function detectProjectBpmFromAssets(assets: AutoBpmAsset[]): AutoBpmResult | null {
  const rankedAssets = assets
    .filter((asset) => asset.buffer.duration >= AUTO_BPM_MIN_DURATION_SEC)
    .map((asset) => ({
      asset,
      priority: getAutoBpmRolePriority(asset.fileRef.role) + Math.min(12, asset.buffer.duration / 30),
    }))
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 4);

  let best: (AutoBpmResult & { score: number }) | null = null;

  for (const { asset, priority } of rankedAssets) {
    const detection = detectBpmFromBuffer(asset.buffer, {
      maxAnalysisSec: Math.min(75, Math.max(30, asset.buffer.duration)),
    });
    if (!detection) continue;

    const role = asset.fileRef.role;
    const score = priority + detection.confidence * 24;
    if (!best || score > best.score) {
      best = {
        bpm: detection.bpm,
        confidence: detection.confidence,
        sourceName: asset.fileRef.originalName || asset.fileRef.name,
        sourceRole: role,
        analyzedDurationSec: detection.analyzedDurationSec,
        candidates: detection.candidates,
        score,
      };
    }
  }

  if (!best) return null;
  return {
    bpm: best.bpm,
    confidence: best.confidence,
    sourceName: best.sourceName,
    sourceRole: best.sourceRole,
    analyzedDurationSec: best.analyzedDurationSec,
    candidates: best.candidates,
  };
}

function getAutoBpmRolePriority(role: StemRole) {
  const priority: Record<StemRole, number> = {
    reference: 120,
    drums: 110,
    music: 96,
    loop: 86,
    bass: 68,
    synth: 50,
    guitar: 44,
    keys: 42,
    other: 34,
    backingVocal: 20,
    vocal: 16,
    fx: 4,
  };
  return priority[role] ?? 0;
}

function shouldAdoptDetectedBpm(currentBpm: number | null, existingFileCount: number) {
  if (existingFileCount === 0) return true;
  return currentBpm === null;
}

export function DawWorkspace() {
  const store = useDawStore();
  const {
    project,
    transport,
    waveformPeaks,
    debugLog,
    activeView,
    mixDoctorReport,
    spectralRepairReport,
    selectedTrackId,
    selectedClipId,
    undoStack,
    setTransport,
    setPosition,
    addDebug,
    setActiveView,
    selectTrack,
    selectClip,
    moveTrack,
    updateTrack,
    updateClipRole,
    addClipIntentTag,
    removeClipIntentTag,
    addClipPluginChain,
    moveClip,
    trimClip,
    splitClip,
    duplicateClip,
    duplicateTrackBelow,
    deleteClip,
    createArtifactClip,
    muteArtifactClip,
    reduceClipGain,
    createSmartGapFill,
    updateClipPanAutomation,
    resetClipPanAutomation,
    applyAutoClipPanMix,
    updateRepairViewState,
    upsertRepairRegion,
    deleteRepairRegion,
    toggleRepairRegion,
    fixRepairRegion,
    deleteEmptyTracks,
    setAllClipsMovementLocked,
    freezeClip,
    unfreezeClip,
    addClipPlugin,
    removeClipPlugin,
    moveClipPlugin,
    toggleClipPlugin,
    updateClipPluginParams,
    updateTrackEq,
    updateTrackCharacter,
    updateTrackVocalImage,
    updateTrackCompressor,
    addTrackPlugin,
    removeTrackPlugin,
    moveTrackPlugin,
    toggleTrackPlugin,
    updateTrackPluginParams,
    setMasterGain,
    updateMasterEq,
    updateMasterCompressor,
    setMasterLimiterEnabled,
    updateMasterVocalImage,
    updateMasterExportSettings,
    addMasterPlugin,
    removeMasterPlugin,
    moveMasterPlugin,
    toggleMasterPlugin,
    updateMasterPluginParams,
    setBpm,
    setSnapMode,
    addSectionMarker,
    deleteSectionMarker,
    clearProject,
    undoProject,
    loadProject,
    addImportedAssetToTrack,
    addRenderedStem,
    updateTrackAnalysis,
    deleteTrack,
    autoReferenceMix,
    autoReferenceMixSettings,
    runAutoReferenceMix,
    setAutoReferenceMixEnabled,
    recordExportProcessingReport,
    updateAnalysisCacheSummary,
    createMixDoctorSpectralRepair,
    applyMixDoctorSpectralRepair,
  } = store;

  // Local UI State
  const [engineInfo, setEngineInfo] = useState<Record<string, string | number | null>>({});
  const [isAiMixOpen, setIsAiMixOpen] = useState(false);
  const [aiPanelMode, setAiPanelMode] = useState<"aimix" | "spatial" | "mastering">("aimix");
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<AudioImportProgress | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<SweetProcessingJobProgress | null>(null);
  const [renderingTrackId, setRenderingTrackId] = useState<string | null>(null);
  const importAbortControllerRef = useRef<AbortController | null>(null);
  const exportAbortControllerRef = useRef<AbortController | null>(null);
  const exportQueueRef = useRef<{ queue: SweetProcessingQueue; jobId: string } | null>(null);
 
  // Fullscreen management with simulated mode support (fallback for iPhone/iOS Safari)
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isSimulatedFullscreen, setIsSimulatedFullscreen] = useState(false);
 
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      ));
    };
 
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("mozfullscreenchange", handleFullscreenChange);
    document.addEventListener("MSFullscreenChange", handleFullscreenChange);
 
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("webkitfullscreenchange", handleFullscreenChange);
      document.removeEventListener("mozfullscreenchange", handleFullscreenChange);
      document.removeEventListener("MSFullscreenChange", handleFullscreenChange);
    };
  }, []);
 
  // Body overflow locking for simulated fullscreen (iOS Safari Support)
  useEffect(() => {
    if (isSimulatedFullscreen) {
      document.body.style.overflow = "hidden";
      document.body.style.height = "100%";
      document.documentElement.style.overflow = "hidden";
      document.documentElement.style.height = "100%";
    } else {
      document.body.style.overflow = "";
      document.body.style.height = "";
      document.documentElement.style.overflow = "";
      document.documentElement.style.height = "";
    }
    return () => {
      document.body.style.overflow = "";
      document.body.style.height = "";
      document.documentElement.style.overflow = "";
      document.documentElement.style.height = "";
    };
  }, [isSimulatedFullscreen]);
 
  const toggleFullscreen = async () => {
    const elem = document.documentElement;
    const hasFullscreenSupport = !!(
      elem.requestFullscreen ||
      (elem as any).webkitRequestFullscreen ||
      (elem as any).mozRequestFullScreen ||
      (elem as any).msRequestFullscreen
    );
 
    const isIOS = typeof navigator !== "undefined" && /iPad|iPhone|iPod/.test(navigator.userAgent);
 
    if (!hasFullscreenSupport || isIOS) {
      const nextSimulated = !isSimulatedFullscreen;
      setIsSimulatedFullscreen(nextSimulated);
      setIsFullscreen(nextSimulated);
      if (nextSimulated) {
        window.scrollTo(0, 1);
      }
      return;
    }
 
    try {
      const activeFullscreen = !!(
        document.fullscreenElement ||
        (document as any).webkitFullscreenElement ||
        (document as any).mozFullScreenElement ||
        (document as any).msFullscreenElement
      );
 
      if (!activeFullscreen) {
        if (elem.requestFullscreen) {
          await elem.requestFullscreen();
        } else if ((elem as any).webkitRequestFullscreen) {
          await (elem as any).webkitRequestFullscreen();
        } else if ((elem as any).mozRequestFullScreen) {
          await (elem as any).mozRequestFullScreen();
        } else if ((elem as any).msRequestFullscreen) {
          await (elem as any).msRequestFullscreen();
        }
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if ((document as any).webkitExitFullscreen) {
          await (document as any).webkitExitFullscreen();
        } else if ((document as any).mozCancelFullScreen) {
          await (document as any).mozCancelFullScreen();
        } else if ((document as any).msExitFullscreen) {
          await (document as any).msExitFullscreen();
        }
      }
      // If we exit native fullscreen, ensure simulated is also disabled
      setIsSimulatedFullscreen(false);
    } catch (err) {
      addDebug(`Native fullscreen failed, falling back to simulated: ${err instanceof Error ? err.message : String(err)}`);
      const nextSimulated = !isSimulatedFullscreen;
      setIsSimulatedFullscreen(nextSimulated);
      setIsFullscreen(nextSimulated);
    }
  };

  // Overlay states
  const [activeEqTrackId, setActiveEqTrackId] = useState<string | null>(null);
  const [activeCharacterTrackId, setActiveCharacterTrackId] = useState<string | null>(null);
  const [activePluginBrowser, setActivePluginBrowser] = useState<{
    target: "track" | "master" | "clip";
    targetId: string;
  } | null>(null);
  const [activePluginEditor, setActivePluginEditor] = useState<{
    target: "track" | "master" | "clip";
    targetId: string;
    instanceId: string;
  } | null>(null);

  const addPluginAndOpenEditor = (target: "track" | "master" | "clip", targetId: string, pluginId: BuiltinPluginId) => {
    if (target === "track") addTrackPlugin(targetId, pluginId);
    else if (target === "master") addMasterPlugin(pluginId);
    else addClipPlugin(targetId, pluginId);

    const nextProject = useDawStore.getState().project;
    const insertChain =
      target === "track"
        ? nextProject.tracks.find((track) => track.id === targetId)?.insertChain
        : target === "master"
          ? nextProject.master.insertChain
          : nextProject.clips.find((clip) => clip.id === targetId)?.insertChain;
    const addedPlugin = [...(insertChain ?? [])].reverse().find((plugin) => plugin.pluginId === pluginId);

    setActivePluginBrowser(null);
    if (addedPlugin) {
      setActivePluginEditor({
        target,
        targetId,
        instanceId: addedPlugin.id,
      });
    }
  };

  // Core refs
  const lastTapRef = useRef<number>(0);
  const handleTouchHeader = () => {
    const now = Date.now();
    const DOUBLE_PRESS_DELAY = 300;
    if (now - lastTapRef.current < DOUBLE_PRESS_DELAY) {
      toggleFullscreen();
    }
    lastTapRef.current = now;
  };

  // Core hook integration
  const { handlePlay, handlePause, handleStop, handleSeek, durationSec } = usePlayback(
    project,
    transport,
    setTransport,
    setPosition,
    addDebug,
    setEngineInfo
  );

  const { meterReadings, masterMeter } = useMetering(
    project.tracks,
    transport.isPlaying,
    activeView
  );
  const { recentProjects, storageHealth, refreshStorageState } = useStorageSync(project, addDebug);

  useEffect(() => {
    if (!autoReferenceMix.enabled || !autoReferenceMix.pending || isImporting) return;
    if (!autoReferenceMixSettings.autoRunOnReferenceReady) return;
    const timer = window.setTimeout(() => {
      runAutoReferenceMix();
    }, autoReferenceMixSettings.debounceMs);
    return () => window.clearTimeout(timer);
  }, [
    autoReferenceMix.enabled,
    autoReferenceMix.pending,
    autoReferenceMix.lastImportAt,
    autoReferenceMixSettings.autoRunOnReferenceReady,
    autoReferenceMixSettings.debounceMs,
    isImporting,
    project.files.length,
    project.tracks.length,
    project.clips.length,
    runAutoReferenceMix,
  ]);

  // File Manager integration helpers
  const prepareAudioImportFiles = async (files: File[] | FileList | null) => {
    const selectedFiles = Array.from(files ?? []).filter((file) => file.size > 0 && !isIgnoredAudioImportEntryName(file.name));
    const expandedFiles: File[] = [];

    for (const file of selectedFiles) {
      if (!isZipFile(file)) {
        expandedFiles.push(file);
        continue;
      }

      addDebug(`Expanding ZIP: ${file.name}`);
      const entries = await expandAudioFilesFromZip(file);
      addDebug(`ZIP expanded: ${entries.length} audio file(s) from ${file.name}`);
      expandedFiles.push(...entries.map((entry) => entry.file).filter((entryFile) => !isIgnoredAudioImportEntryName(entryFile.name)));
    }

    return expandedFiles.sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" })
    );
  };

  const decodeImportBatch = async (fileArray: File[], label: string) => {
    const issues = validateImportFiles(fileArray);
    for (const issue of issues) {
      addDebug(`Import ${issue.level}: ${issue.message}`);
    }
    const summary = summarizeImportValidationIssues(issues);
    if (summary) {
      showToast(summary);
    }
    if (hasBlockingImportIssue(issues)) {
      throw new Error(summary ?? "Import validation failed.");
    }

    const controller = new AbortController();
    importAbortControllerRef.current = controller;
    setImportProgress({ index: 0, total: fileArray.length, fileName: label });
    return audioEngine.importFiles(fileArray, {
      signal: controller.signal,
      onProgress: (progress) => setImportProgress(progress),
    });
  };

  const cancelImport = () => {
    importAbortControllerRef.current?.abort();
    addDebug("Import cancel requested.");
    showToast("Import cancel requested.");
  };

  const applyAutoDetectedProjectBpm = (assets: AutoBpmAsset[], label: string) => {
    const current = useDawStore.getState();
    if (!shouldAdoptDetectedBpm(current.project.bpm, current.project.files.length)) {
      return;
    }

    const detected = detectProjectBpmFromAssets(assets);
    if (!detected) {
      current.addDebug(`${label}: Auto BPM skipped; no reliable tempo could be detected from the imported WAV.`);
      return;
    }

    current.setBpm(detected.bpm);
    const candidateText = detected.candidates.map((candidate) => `${candidate.bpm}`).join(" / ");
    current.addDebug(
      `${label}: Project BPM auto-detected from ${detected.sourceName} (${detected.sourceRole}) = ${detected.bpm} BPM; confidence=${Math.round(detected.confidence * 100)}%; candidates=${candidateText || "none"}.`,
    );
    showToast(`Project BPM set to ${detected.bpm} from ${detected.sourceName}.`);
  };

  const handleImport = async (files: File[] | FileList | null) => {
    const selectedFiles = Array.from(files ?? []).filter((file) => file.size > 0);
    if (selectedFiles.length === 0) {
      addDebug("Import skipped: no files selected.");
      return;
    }
    setIsImporting(true);
    addDebug(`Importing ${selectedFiles.length} audio file(s)...`);
    try {
      const fileArray = await prepareAudioImportFiles(selectedFiles);
      if (fileArray.length === 0) {
        addDebug("Import skipped: selected files did not contain supported audio.");
        showToast("No supported audio files were found.");
        return;
      }
      const decodedAssets = await decodeImportBatch(fileArray, "Import Audio");
      const assetsWithRoles = decodedAssets.map((asset) => ({
        ...asset,
        fileRef: {
          ...asset.fileRef,
          role: inferNewAudioImportRole(asset.fileRef.originalName || asset.fileRef.name),
        },
      }));
      applyAutoDetectedProjectBpm(assetsWithRoles, "Import Audio");

      const { saveAudioAssetToIndexedDb } = await import("@/storage/ProjectStorage");
      for (let index = 0; index < decodedAssets.length; index += 1) {
        const asset = decodedAssets[index];
        if (!asset) continue;
        const importedRole = inferNewAudioImportRole(asset.fileRef.originalName || asset.fileRef.name);
        const fileRef: AudioFileRef = {
          ...asset.fileRef,
          role: importedRole,
        };
        const peaks = buildPeakSummary(asset.buffer);
        useDawStore.getState().addImportedAsset(fileRef, peaks);
        const sourceFile = fileArray[index];
        if (sourceFile) {
          saveAudioAssetToIndexedDb(fileRef, sourceFile).catch((error) => {
            addDebug(error instanceof Error ? `Audio asset save failed: ${error.message}` : "Audio asset save failed");
          });
        }
      }
      void refreshStorageState().catch(() => undefined);
      addDebug(`Imported ${decodedAssets.length} stems successfully.`);
      showToast(`Imported ${decodedAssets.length} stem${decodedAssets.length === 1 ? "" : "s"}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addDebug(`Audio import failed: ${message}`);
      if (isChunkLoadError(err)) {
        showToast("App files were updated. Clearing cache and reloading...");
        void recoverFromStaleChunk(addDebug);
      } else {
        showToast(`Import failed: ${message}`);
      }
    } finally {
      importAbortControllerRef.current = null;
      setImportProgress(null);
      setIsImporting(false);
    }
  };

  const handleImportReference = async (files: File[] | FileList | null) => {
    const selectedFiles = Array.from(files ?? []).filter((file) => file.size > 0);
    if (selectedFiles.length === 0) {
      addDebug("Reference import skipped: no files selected.");
      return;
    }
    setIsImporting(true);
    addDebug(`Importing ${selectedFiles.length} reference file(s)...`);
    try {
      const fileArray = await prepareAudioImportFiles(selectedFiles);
      if (fileArray.length === 0) {
        addDebug("Reference import skipped: selected files did not contain supported audio.");
        showToast("No supported reference audio was found.");
        return;
      }

      const decodedAssets = await decodeImportBatch(fileArray, "Import Reference");
      applyAutoDetectedProjectBpm(
        decodedAssets.map((asset) => ({
          ...asset,
          fileRef: {
            ...asset.fileRef,
            role: "reference" as const,
          },
        })),
        "Import Reference",
      );
      const { saveAudioAssetToIndexedDb } = await import("@/storage/ProjectStorage");
      for (let index = 0; index < decodedAssets.length; index += 1) {
        const asset = decodedAssets[index];
        if (!asset) continue;
        const referenceFileRef: AudioFileRef = {
          ...asset.fileRef,
          role: "reference",
          name: asset.fileRef.name.startsWith("Reference") ? asset.fileRef.name : `Reference - ${asset.fileRef.name}`,
        };
        const peaks = buildPeakSummary(asset.buffer);
        useDawStore.getState().addImportedAsset(referenceFileRef, peaks);
        const sourceFile = fileArray[index];
        if (sourceFile) {
          saveAudioAssetToIndexedDb(referenceFileRef, sourceFile).catch((error) => {
            addDebug(error instanceof Error ? `Reference asset save failed: ${error.message}` : "Reference asset save failed");
          });
        }
      }
      void refreshStorageState().catch(() => undefined);
      addDebug(`Imported ${decodedAssets.length} reference track(s).`);
      showToast(`Reference imported: ${decodedAssets.length} file${decodedAssets.length === 1 ? "" : "s"}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addDebug(`Reference import failed: ${message}`);
      if (isChunkLoadError(err)) {
        showToast("App files were updated. Clearing cache and reloading...");
        void recoverFromStaleChunk(addDebug);
      } else {
        showToast(`Reference import failed: ${message}`);
      }
    } finally {
      importAbortControllerRef.current = null;
      setImportProgress(null);
      setIsImporting(false);
    }
  };

  const handleImportToTrack = async (trackId: string, files: File[] | FileList | null, timelineStartSec = transport.positionSec) => {
    const selectedFiles = Array.from(files ?? []).filter((file) => file.size > 0);
    if (selectedFiles.length === 0) {
      addDebug("Track import skipped: no files selected.");
      return;
    }
    setIsImporting(true);
    addDebug(`Importing ${selectedFiles.length} audio file(s) to selected track...`);
    try {
      const fileArray = await prepareAudioImportFiles(selectedFiles);
      if (fileArray.length === 0) {
        addDebug("Track import skipped: selected files did not contain supported audio.");
        showToast("No supported audio files were found.");
        return;
      }
      const decodedAssets = await decodeImportBatch(fileArray, "Import To Track");

      const { saveAudioAssetToIndexedDb } = await import("@/storage/ProjectStorage");
      decodedAssets.forEach((asset, index) => {
        const peaks = buildPeakSummary(asset.buffer);
        useDawStore.getState().addImportedAssetToTrack(trackId, asset.fileRef, peaks, Math.max(0, timelineStartSec + index * asset.buffer.duration));
        const sourceFile = fileArray[index];
        if (sourceFile) {
          saveAudioAssetToIndexedDb(asset.fileRef, sourceFile).catch((error) => {
            addDebug(error instanceof Error ? `Track audio asset save failed: ${error.message}` : "Track audio asset save failed");
          });
        }
      });
      void refreshStorageState().catch(() => undefined);
      addDebug(`Imported ${decodedAssets.length} audio file(s) to track.`);
      showToast(`Added ${decodedAssets.length} file${decodedAssets.length === 1 ? "" : "s"} to track.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addDebug(`Track import failed: ${message}`);
      if (isChunkLoadError(err)) {
        showToast("App files were updated. Clearing cache and reloading...");
        void recoverFromStaleChunk(addDebug);
      } else {
        showToast(`Track import failed: ${message}`);
      }
    } finally {
      importAbortControllerRef.current = null;
      setImportProgress(null);
      setIsImporting(false);
    }
  };

  const handleExport = async () => {
    if (project.clips.length === 0) return;
    if (transport.isPlaying) handleStop();
    await audioEngine.suspendForOfflineExport();
    const exportController = new AbortController();
    exportAbortControllerRef.current = exportController;
    setIsExporting(true);
    setExportProgress(createExportStageProgress("Rendering offline mix..."));
    addDebug("Rendering master mix offline...");
    let exportWakeLock: { release: () => Promise<void> } | null = null;
    try {
      const wakeLockApi = (navigator as Navigator & {
        wakeLock?: { request: (type: "screen") => Promise<{ release: () => Promise<void> }> };
      }).wakeLock;
      if (wakeLockApi) exportWakeLock = await wakeLockApi.request("screen").catch(() => null);
      const [{ buildExportStabilityPlan, createExportStabilityReport }, { downloadBlob }, { estimateRenderBudget }] = await Promise.all([
        import("@/daw/export/ExportStabilityPlanner"),
        import("@/daw/project/ProjectSerializer"),
        import("@/audio/export/RenderBudget"),
      ]);
      const exportSampleRate = resolveStableExportSampleRate(project);
      const plan = buildExportStabilityPlan(project, {
        purpose: "master-wav",
        sampleRate: exportSampleRate,
      });
      const budget = estimateRenderBudget(project, {
        durationSec: plan.durationSec,
        sampleRate: exportSampleRate,
        bitDepth: project.master.exportBitDepth,
        memoryBudgetBytes: plan.memoryBudgetMb * 1024 * 1024,
      });
      addDebug(`Export stability plan: ${plan.strategy} / ${plan.risk} / est ${plan.estimatedPeakMemoryMb}MB of ${plan.memoryBudgetMb}MB.`);
      addDebug(`Render budget: ${budget.risk} / est ${budget.estimatedMb}MB / stems ${budget.stemCount} / plugins ${budget.pluginWeight}.`);
      for (const reason of budget.reasons) addDebug(`Render budget reason: ${reason}`);
      const mobileRuntime = /iPhone|iPad|iPod|Android|Mobile/i.test(navigator.userAgent);
      const forceStableExport = mobileRuntime || budget.risk !== "ok";
      if (!plan.allowFullOfflineRender || forceStableExport) {
        const [{ exportMasterWavWithStableRenderer }, { createSweetProjectAnalysisCacheSummary }] = await Promise.all([
          import("@/daw/export/StableMasterExport"),
          import("@/lib/audio/exportQueue"),
        ]);
        if (forceStableExport && plan.allowFullOfflineRender) {
          addDebug("Safe export changed render path: Render budget danger; using stable chunked export.");
        }
        setExportProgress(createExportStageProgress(`Stable export: ${plan.strategy}`));
        const stableExport = await exportMasterWavWithStableRenderer(project, {
          plan,
          signal: exportController.signal,
          onProgress: setExportProgress,
        });
        const stableReport = {
          ...stableExport.report,
          budget,
          warnings: [
            ...stableExport.report.warnings,
            ...(forceStableExport && plan.allowFullOfflineRender ? ["Safe export changed render path: Render budget danger; stable chunked export used."] : []),
          ],
        };
        recordExportProcessingReport(stableReport);
        updateAnalysisCacheSummary(createSweetProjectAnalysisCacheSummary(project));
        const exportFilename = reserveMasterExportFilename(project);
        downloadBlob(stableExport.blob, exportFilename);
        window.setTimeout(() => void stableExport.cleanup(), 120_000);
        addDebug(`WAV export blob size: ${(stableExport.blob.size / (1024 * 1024)).toFixed(1)}MB / bitDepth ${project.master.exportBitDepth} / dither ${Boolean(resolveExportDither(project.master.exportBitDepth, project.master.exportDither))}.`);
        const warningCount = stableReport.warnings.length;
        showToast(
          warningCount > 0
            ? `${exportFilename} exported with ${warningCount} report warning${warningCount === 1 ? "" : "s"}.`
            : `${exportFilename} exported.`,
        );
        addDebug(`Stable Master WAV Export Successful: ${plan.strategy}, retry ${stableExport.retryCount}.`);
        return;
      }

      const { renderProjectOfflineWithReport } = await import("@/audio/engine/OfflineRenderer");
      addDebug(`Stable offline render: ${describeStableExportSampleRate(exportSampleRate)}.`);
      const renderResult = await renderProjectOfflineWithReport(project, undefined, {
        sampleRate: exportSampleRate,
      });
      const renderedBuffer = renderResult.buffer;
      for (const warning of renderResult.warnings) {
        addDebug(`Offline render warning: ${warning}`);
      }

      const [{ createSweetExportProcessingReportFromProject, createSweetProjectAnalysisCacheSummary }, { analyzeAndSanitizeExportChannels, formatExportHealthWarnings }] = await Promise.all([
        import("@/lib/audio/exportQueue"),
        import("@/audio/export/ExportHealth"),
      ]);
      const { createAbortError } = await import("@/lib/audio/processingJobs");
      if (exportController.signal.aborted) throw createAbortError("Export job cancelled.");
      const channelData = Array.from({ length: renderedBuffer.numberOfChannels }, (_, index) =>
        renderedBuffer.getChannelData(index),
      );
      setExportProgress(createExportStageProgress("Checking export health..."));
      const health = analyzeAndSanitizeExportChannels(channelData);
      const healthWarnings = formatExportHealthWarnings(health);
      addDebug(`Export health: peak ${health.peakDb.toFixed(2)}dB / rms ${health.rmsDb.toFixed(2)}dB / clipped ${health.clippedSamples} / invalid ${health.nanSamples + health.infSamples}.`);
      const directReport = createSweetExportProcessingReportFromProject(project, {
        durationSec: renderedBuffer.duration,
        sampleRate: renderedBuffer.sampleRate,
        channels: renderedBuffer.numberOfChannels,
        loudnessBefore: health.rmsDb - 1.2,
        loudnessAfter: health.rmsDb - 1.2,
        truePeakBefore: health.peakDb,
        truePeakAfter: health.peakDb,
        wiring: {
          repairRegions: true,
          aimixUnmask: true,
          masterPolish2: false,
          finalRepairModules: false,
        },
      });
      const exactReport = {
        ...directReport,
        budget,
        health,
        warnings: [...new Set([...directReport.warnings, ...renderResult.warnings, ...healthWarnings])],
        stability: createExportStabilityReport(plan, {
          fallbackUsed: false,
          renderedChunks: 1,
          renderedTrackBatches: 1,
          warnings: [...plan.reason, ...renderResult.warnings],
        }),
      };
      recordExportProcessingReport(exactReport);
      updateAnalysisCacheSummary(createSweetProjectAnalysisCacheSummary(project));
      
      const wavBlob = await encodeWavBlobFromChannelsIncremental({
        sampleRate: renderedBuffer.sampleRate,
        channels: channelData,
        normalizePeak: project.master.exportNormalizePeak,
        bitDepth: project.master.exportBitDepth,
        dither: resolveExportDither(project.master.exportBitDepth, project.master.exportDither),
        peakTargetDb: project.master.exportPeakTargetDb ?? -1,
        signal: exportController.signal,
        onProgress: setExportProgress,
      });
      addDebug(`WAV export blob size: ${(wavBlob.size / (1024 * 1024)).toFixed(1)}MB / bitDepth ${project.master.exportBitDepth} / dither ${Boolean(resolveExportDither(project.master.exportBitDepth, project.master.exportDither))} / normalize ${project.master.exportNormalizePeak}.`);

      const exportFilename = reserveMasterExportFilename(project);
      downloadBlob(wavBlob, exportFilename);
      const warningCount = exactReport.warnings.length;
      if (warningCount > 0) {
        showToast(`${exportFilename} exported with ${warningCount} report warning${warningCount === 1 ? "" : "s"}.`);
      } else {
        showToast(`${exportFilename} exported.`);
      }
      addDebug("Master WAV Export Successful!");
    } catch (err) {
      addDebug(`Export failed: ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof Error && err.name === "AbortError") {
        showToast("Export cancelled.");
      }
    } finally {
      await exportWakeLock?.release().catch(() => undefined);
      setExportProgress(null);
      setIsExporting(false);
      if (exportAbortControllerRef.current === exportController) exportAbortControllerRef.current = null;
      exportQueueRef.current = null;
    }
  };

  const cancelExport = () => {
    const queuedExport = exportQueueRef.current;
    if (queuedExport) {
      queuedExport.queue.cancel(queuedExport.jobId);
    } else {
      exportAbortControllerRef.current?.abort();
    }
    addDebug("Export cancel requested.");
    showToast("Export cancel requested.");
  };

  const resolveExportSampleRate = () => resolveStableExportSampleRate(project);

  const downloadRenderedWav = async (buffer: AudioBuffer, fileName: string) => {
    const { encodeWavFromAudioBuffer } = await import("@/audio/export/WavEncoder");
    const { downloadBlob } = await import("@/daw/project/ProjectSerializer");
    const wavBlob = encodeWavFromAudioBuffer(buffer, {
      normalizePeak: project.master.exportNormalizePeak,
      bitDepth: project.master.exportBitDepth,
      dither: resolveExportDither(project.master.exportBitDepth, project.master.exportDither),
      peakTargetDb: project.master.exportPeakTargetDb ?? -1,
    });
    downloadBlob(wavBlob, fileName);
  };

  const handleExportSelectedClip = async () => {
    if (!selectedClipId) return;
    const clip = project.clips.find((candidate) => candidate.id === selectedClipId);
    const file = project.files.find((candidate) => candidate.id === clip?.fileId);
    if (!clip || !file) return;

    setIsExporting(true);
    setExportProgress(createExportStageProgress("Rendering selected clip..."));
    addDebug(`Rendering selected clip: ${file.name}`);
    try {
      const { renderClipOffline } = await import("@/audio/engine/OfflineRenderer");
      const renderedBuffer = await renderClipOffline(clip, file, undefined, {
        sampleRate: resolveExportSampleRate(),
        normalizePeak: project.master.exportNormalizePeak,
        ceilingDb: project.master.exportPeakTargetDb ?? -1,
        repairRegions: project.repairRegions,
        unmaskOperations: project.aimixUnmaskState.operations,
      });
      const safeName = file.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9-_]+/gi, "_") || "clip";
      await downloadRenderedWav(renderedBuffer, `${safeName}_clip.wav`);
      showToast("Selected clip WAV exported.");
      addDebug("Selected clip WAV export completed.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addDebug(`Selected clip export failed: ${message}`);
      showToast(`Clip export failed: ${message}`);
    } finally {
      setExportProgress(null);
      setIsExporting(false);
    }
  };

  const handleExportSelectedTrack = async () => {
    const trackId = selectedTrackId ?? project.tracks[0]?.id;
    if (!trackId) return;
    const track = project.tracks.find((candidate) => candidate.id === trackId);
    if (!track) return;

    setIsExporting(true);
    addDebug(`Rendering selected track: ${track.name}`);
    try {
      const { renderTrackOffline } = await import("@/audio/engine/OfflineRenderer");
      const renderedBuffer = await renderTrackOffline(project, trackId, undefined, {
        sampleRate: resolveExportSampleRate(),
        includeMasterFx: false,
        normalizePeak: project.master.exportNormalizePeak,
        ceilingDb: project.master.exportPeakTargetDb ?? -1,
      });
      const safeName = track.name.replace(/[^a-z0-9-_]+/gi, "_") || "track";
      await downloadRenderedWav(renderedBuffer, `${safeName}_track.wav`);
      showToast("Selected track WAV exported.");
      addDebug("Selected track WAV export completed.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addDebug(`Selected track export failed: ${message}`);
      showToast(`Track export failed: ${message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleAnalyzeTrack = async (trackId: string) => {
    const track = project.tracks.find((candidate) => candidate.id === trackId);
    if (!track) return;
    const clips = project.clips.filter((clip) => clip.trackId === trackId);
    if (clips.length === 0) {
      showToast("No clips to analyze on this track.");
      return;
    }

    addDebug(`Analyzing track onsets: ${track.name}`);
    try {
      const [{ audioBufferRegistry }, { detectOnsetsFromBuffer }] = await Promise.all([
        import("@/audio/engine/AudioBufferRegistry"),
        import("@/audio/analysis/OnsetDetector"),
      ]);
      const onsets = new Set<number>();

      for (const clip of clips) {
        const buffer = audioBufferRegistry.getBuffer(clip.fileId);
        if (!buffer) continue;
        const result = detectOnsetsFromBuffer(buffer, {
          maxAnalysisSec: Math.min(buffer.duration, clip.sourceStartSec + clip.durationSec),
        });
        for (const onsetSec of result.onsetsSec) {
          const clipLocalSec = onsetSec - clip.sourceStartSec;
          if (clipLocalSec < 0 || clipLocalSec > clip.durationSec) continue;
          onsets.add(Number((clip.timelineStartSec + clipLocalSec).toFixed(4)));
        }
      }

      const onsetsSec = [...onsets].sort((a, b) => a - b);
      updateTrackAnalysis(trackId, {
        onsetsSec,
        analyzedAt: new Date().toISOString(),
        analysisVersion: "mix-console-onset-lite-v1",
      });
      showToast(`Analyzed ${track.name}: ${onsetsSec.length} onsets.`);
      addDebug(`Track analysis completed: ${track.name} / ${onsetsSec.length} onsets.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Analyze failed: ${message}`);
      addDebug(`Track analyze failed: ${message}`);
    }
  };

  const handleClearTrackAnalysis = (trackId: string) => {
    const track = project.tracks.find((candidate) => candidate.id === trackId);
    updateTrackAnalysis(trackId, {
      onsetsSec: [],
      analyzedAt: new Date().toISOString(),
      analysisVersion: "manual-clear",
    });
    showToast(`Cleared analysis${track ? `: ${track.name}` : ""}.`);
  };

  const handleRenderTrack = async (
    trackId: string,
    options: { includeMasterFx?: boolean; muteOriginal?: boolean; normalizePeak?: boolean } = {},
  ) => {
    const track = project.tracks.find((candidate) => candidate.id === trackId);
    if (!track) return;
    const trackClips = project.clips.filter((clip) => clip.trackId === trackId);
    if (trackClips.length === 0) {
      showToast("No clips to render on this track.");
      return;
    }

    setRenderingTrackId(trackId);
    addDebug(`Rendering track to new stem: ${track.name}`);
    try {
      const [{ renderTrackOffline }, { encodeWavFromAudioBuffer }, { audioBufferRegistry }, { saveAudioAssetToIndexedDb }] = await Promise.all([
        import("@/audio/engine/OfflineRenderer"),
        import("@/audio/export/WavEncoder"),
        import("@/audio/engine/AudioBufferRegistry"),
        import("@/storage/ProjectStorage"),
      ]);
      const renderedBuffer = await renderTrackOffline(project, trackId, undefined, {
        sampleRate: resolveExportSampleRate(),
        includeMasterFx: Boolean(options.includeMasterFx),
        normalizePeak: options.normalizePeak ?? project.master.exportNormalizePeak,
        ceilingDb: project.master.exportPeakTargetDb ?? -1,
      });
      const wavBlob = encodeWavFromAudioBuffer(renderedBuffer, {
        normalizePeak: false,
        bitDepth: project.master.exportBitDepth,
        dither: resolveExportDither(project.master.exportBitDepth, project.master.exportDither),
        peakTargetDb: project.master.exportPeakTargetDb ?? -1,
      });
      const safeName = track.name.replace(/[^a-z0-9-_]+/gi, "_") || "track";
      const file = new File([wavBlob], `${safeName}_rendered.wav`, { type: "audio/wav" });
      const decoded = audioBufferRegistry.register(file, renderedBuffer);
      await saveAudioAssetToIndexedDb(decoded.fileRef, file);
      addRenderedStem(trackId, decoded.fileRef, buildPeakSummary(renderedBuffer), Boolean(options.muteOriginal));
      await refreshStorageState().catch(() => undefined);
      showToast(`Rendered ${track.name} to a new stem.`);
      addDebug(`Track render completed: ${track.name}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      showToast(`Render failed: ${message}`);
      addDebug(`Track render failed: ${message}`);
    } finally {
      setRenderingTrackId(null);
    }
  };

  const handleExportAllClips = async () => {
    if (project.clips.length === 0) return;

    setIsExporting(true);
    setExportProgress(createExportStageProgress("Preparing clip exports..."));
    addDebug(`Rendering ${project.clips.length} clip WAV file(s)...`);
    try {
      const { renderClipOffline } = await import("@/audio/engine/OfflineRenderer");
      let exported = 0;

      for (const [index, clip] of project.clips.entries()) {
        const file = project.files.find((candidate) => candidate.id === clip.fileId);
        if (!file) continue;
        setExportProgress(createExportStageProgress(`Rendering clip ${index + 1}/${project.clips.length}`, index, project.clips.length));

        const renderedBuffer = await renderClipOffline(clip, file, undefined, {
          sampleRate: resolveExportSampleRate(),
          normalizePeak: project.master.exportNormalizePeak,
          ceilingDb: project.master.exportPeakTargetDb ?? -1,
          repairRegions: project.repairRegions,
          unmaskOperations: project.aimixUnmaskState.operations,
        });
        const safeName = file.name.replace(/\.[^.]+$/, "").replace(/[^a-z0-9-_]+/gi, "_") || `clip_${index + 1}`;
        await downloadRenderedWav(renderedBuffer, `${String(index + 1).padStart(2, "0")}_${safeName}.wav`);
        exported += 1;
      }

      showToast(`Exported ${exported} clip WAV file${exported === 1 ? "" : "s"}.`);
      addDebug(`Clip-by-clip export completed: ${exported}/${project.clips.length}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addDebug(`Clip-by-clip export failed: ${message}`);
      showToast(`Clip export failed: ${message}`);
    } finally {
      setExportProgress(null);
      setIsExporting(false);
    }
  };

  const handleExportReferenceRepairPack = async () => {
    const hasReference = project.tracks.some((track) => track.role === "reference" || track.type === "reference");
    const hasWorkClips = project.clips.some((clip) => {
      const track = project.tracks.find((candidate) => candidate.id === clip.trackId);
      return track && track.role !== "reference" && track.type !== "reference";
    });
    if (!hasReference) {
      showToast("Reference Repair needs a Reference Mix. Import one from Files > Import Reference Mix.");
      return;
    }
    if (!hasWorkClips) {
      showToast("Reference Repair needs at least one normal stem or clip.");
      return;
    }

    setIsExporting(true);
    addDebug("Rendering Direct WAV Reference Repair artifacts...");
    try {
      const [{ renderReferenceRepairArtifacts }, { encodeWav }, { downloadBlob }] = await Promise.all([
        import("@/daw/mix/reference/referenceRepairRender"),
        import("@/audio/export/WavEncoder"),
        import("@/daw/project/ProjectSerializer"),
      ]);
      const artifacts = await renderReferenceRepairArtifacts(project, undefined, {
        sampleRate: resolveExportSampleRate(),
      });
      const safeTitle = project.title.trim().replace(/[^a-z0-9-_]+/gi, "_") || "sweet-daw";
      const wavOptions = {
        sampleRate: artifacts.sampleRate,
        normalizePeak: true,
        peakTargetDb: project.master.exportPeakTargetDb ?? -1,
        bitDepth: project.master.exportBitDepth,
        dither: resolveExportDither(project.master.exportBitDepth, project.master.exportDither),
      };

      downloadBlob(encodeWav({ ...wavOptions, channels: artifacts.stemSumChannels }), `${safeTitle}_reference_repair_stem_sum.wav`);
      downloadBlob(encodeWav({ ...wavOptions, channels: artifacts.rmsMatchedStemSumChannels }), `${safeTitle}_reference_repair_rms_matched_stem_sum.wav`);
      downloadBlob(encodeWav({ ...wavOptions, channels: artifacts.residualChannels }), `${safeTitle}_reference_repair_residual.wav`);
      downloadBlob(encodeWav({ ...wavOptions, channels: artifacts.repairedStemSumChannels }), `${safeTitle}_reference_repair_repaired_stem_sum.wav`);
      downloadBlob(new Blob([JSON.stringify(artifacts.report, null, 2)], { type: "application/json" }), `${safeTitle}_reference_repair_report.json`);
      downloadBlob(new Blob([artifacts.markdown], { type: "text/markdown;charset=utf-8" }), `${safeTitle}_reference_repair_report.md`);
      addDebug(`Reference Repair exported: ${artifacts.diagnosis.status} / ${artifacts.diagnosis.severity}`);
      showToast("Reference Repair Pack exported. Check the downloaded files.");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addDebug(`Reference Repair export failed: ${message}`);
      showToast(`Reference Repair export failed: ${message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportProcessedStemPackage = async () => {
    const hasWorkClips = project.clips.some((clip) => {
      const track = project.tracks.find((candidate) => candidate.id === clip.trackId);
      return track && track.role !== "reference" && track.type !== "reference";
    });
    if (!hasWorkClips) {
      showToast("Processed Stem Package needs at least one non-reference clip.");
      return;
    }

    const exportController = new AbortController();
    exportAbortControllerRef.current = exportController;
    setIsExporting(true);
    setExportProgress(createExportStageProgress("Preparing processed stem export..."));
    addDebug("Rendering processed stem package...");
    try {
      const [{ createProcessedStemPackageStable }, { downloadBlob }] = await Promise.all([
        import("@/daw/export/ProcessedStemPackage"),
        import("@/daw/project/ProjectSerializer"),
      ]);
      const result = await createProcessedStemPackageStable(project, undefined, {
        sampleRate: resolveExportSampleRate(),
        bitDepth: project.master.exportBitDepth,
        dither: Boolean(resolveExportDither(project.master.exportBitDepth, project.master.exportDither)),
        masterNormalizePeak: project.master.exportNormalizePeak,
        masterPeakTargetDb: project.master.exportPeakTargetDb ?? -1,
        mode: "auto",
        signal: exportController.signal,
        onProgress: setExportProgress,
        onPartReady: ({ blob, fileName }) => {
          downloadBlob(blob, fileName);
        },
      });
      addDebug(`Processed Stem Package exported: ${result.stemCount} stem(s), mode ${result.mode}, ${result.partCount} part(s).`);
      showToast(`Processed Stem Package exported: ${result.stemCount} stem${result.stemCount === 1 ? "" : "s"} / ${result.mode}.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      addDebug(`Processed Stem Package export failed: ${message}`);
      if (err instanceof Error && err.name === "AbortError") {
        showToast("Processed stem export cancelled.");
      } else {
        showToast(`Processed stem export failed: ${message}`);
      }
    } finally {
      setExportProgress(null);
      setIsExporting(false);
      if (exportAbortControllerRef.current === exportController) exportAbortControllerRef.current = null;
    }
  };

  const handleExportPackage = async () => {
    if (project.files.length === 0) return;
    setIsExporting(true);
    addDebug("Creating SWTD portable package...");
    try {
      const [{ createProjectPackage, downloadBlob }, { audioBufferRegistry }, { loadAudioAssetFromIndexedDb }] =
        await Promise.all([
          import("@/daw/project/ProjectSerializer"),
          import("@/audio/engine/AudioBufferRegistry"),
          import("@/storage/ProjectStorage"),
        ]);

      const resolveBlob = async (fileId: string) => {
        const sourceFile = audioBufferRegistry.getFile(fileId);
        if (sourceFile) return sourceFile;
        return loadAudioAssetFromIndexedDb(fileId);
      };

      const pkgBlob = await createProjectPackage(project, resolveBlob);
      const safeTitle = project.title.trim().replace(/[^a-z0-9-_]+/gi, "_") || "project";
      downloadBlob(pkgBlob, `${safeTitle}.swtd`);
      addDebug("SWTD portable package generated successfully!");
    } catch (err) {
      addDebug(`SWTD Package generation failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleRestoreProject = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    addDebug(`Restoring from backup/package file: ${file.name}...`);
    try {
      const { readSweetDawProjectFile } = await import("@/daw/project/ProjectSerializer");
      const result = await readSweetDawProjectFile(file);

      if (result.kind === "json") {
        loadProject(result.backup.project);
        addDebug("JSON project backup restored.");
        if (result.backup.migrationIssues?.length) {
          addDebug(`Project restored with ${result.backup.migrationIssues.length} migration warning(s).`);
        }
      } else {
        const pkg = result.package;

        const peaksMap: Record<string, any> = {};
        for (const asset of pkg.audioAssets) {
          const fileRef: AudioFileRef = {
            id: asset.id,
            name: asset.name,
            originalName: asset.originalName,
            role: asset.role as StemRole,
            mimeType: asset.mimeType,
            durationSec: asset.durationSec,
            sampleRate: asset.sampleRate,
            channelCount: asset.channelCount,
            byteLength: asset.byteLength,
            storageKey: `memory:${asset.id}`,
            createdAt: new Date().toISOString(),
          };
          const decoded = await audioEngine.decodeStoredAsset(fileRef, asset.blob);
          const { saveAudioAssetToIndexedDb } = await import("@/storage/ProjectStorage");
          await saveAudioAssetToIndexedDb(decoded.fileRef, asset.blob);
          peaksMap[asset.id] = buildPeakSummary(decoded.buffer);
        }
        
        loadProject(pkg.manifest.project, peaksMap);
        addDebug(`SWTD package restored with ${pkg.audioAssets.length} stems.`);
        if (pkg.migrationIssues?.length) {
          addDebug(`SWTD package restored with ${pkg.migrationIssues.length} migration warning(s).`);
        }
      }
    } catch (err) {
      addDebug(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleFreezeClip = async (clipId: string) => {
    addDebug(`Freezing clip ${clipId}...`);
    try {
      const clip = project.clips.find(c => c.id === clipId);
      const file = project.files.find(f => f.id === clip?.fileId);
      if (!clip || !file) return;

      const { renderClipOffline } = await import("@/audio/engine/OfflineRenderer");
      const renderedBuffer = await renderClipOffline(clip, file);

      const { encodeWavFromAudioBuffer } = await import("@/audio/export/WavEncoder");
      const wavBlob = encodeWavFromAudioBuffer(renderedBuffer, { normalizePeak: false, bitDepth: "pcm16" });

      const { audioBufferRegistry: reg } = await import("@/audio/engine/AudioBufferRegistry");
      const fileObj = new File([wavBlob], `${file.name.replace(/\.[^.]+$/, "")}_frozen.wav`, { type: "audio/wav" });
      const decoded = reg.register(fileObj, renderedBuffer);
      const { saveAudioAssetToIndexedDb } = await import("@/storage/ProjectStorage");
      await saveAudioAssetToIndexedDb(decoded.fileRef, fileObj);

      const peaks = buildPeakSummary(renderedBuffer);

      freezeClip(clipId, decoded.fileRef, peaks);
      void refreshStorageState().catch(() => undefined);
      addDebug(`Successfully froze clip ${clipId}.`);
    } catch (err) {
      addDebug(`Freeze failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const saveCurrentProjectWithAssets = async () => {
    const [{ saveAudioAssetToIndexedDb, saveProjectToIndexedDb }, { audioBufferRegistry }] = await Promise.all([
      import("@/storage/ProjectStorage"),
      import("@/audio/engine/AudioBufferRegistry"),
    ]);
    let savedAssets = 0;
    for (const fileRef of project.files) {
      const sourceFile = audioBufferRegistry.getFile(fileRef.id);
      if (!sourceFile) continue;
      await saveAudioAssetToIndexedDb(fileRef, sourceFile);
      savedAssets += 1;
    }
    await saveProjectToIndexedDb(project);
    await refreshStorageState();
    return savedAssets;
  };

  const restoreProjectFromIndexedDb = async (projectId?: string) => {
    const { loadAudioAssetFromIndexedDb, loadProjectFromIndexedDb } = await import("@/storage/ProjectStorage");
    const restoredProject = await loadProjectFromIndexedDb(projectId);
    if (!restoredProject) {
      throw new Error("No local Sweet DAW project was found.");
    }

    const peaksMap: Record<string, ReturnType<typeof buildPeakSummary>> = {};
    let restoredAssets = 0;
    for (const fileRef of restoredProject.files) {
      const blob = await loadAudioAssetFromIndexedDb(fileRef.id);
      if (!blob) continue;
      const decoded = await audioEngine.decodeStoredAsset(fileRef, blob);
      peaksMap[decoded.fileRef.id] = buildPeakSummary(decoded.buffer);
      restoredAssets += 1;
    }

    loadProject(restoredProject, peaksMap);
    await refreshStorageState();
    return { restoredProject, restoredAssets };
  };

  const handleSaveLocal = async () => {
    addDebug("Saving project and audio assets to IndexedDB store...");
    try {
      const savedAssets = await saveCurrentProjectWithAssets();
      showToast(`Saved local project with ${savedAssets}/${project.files.length} audio asset(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addDebug(`Local save failed: ${message}`);
      showToast(`Local save failed: ${message}`);
    }
  };

  const handleLoadLocal = async () => {
    addDebug("Loading current local IndexedDB project...");
    try {
      const result = await restoreProjectFromIndexedDb();
      showToast(`Loaded ${result.restoredProject.title} with ${result.restoredAssets}/${result.restoredProject.files.length} audio asset(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addDebug(`Local load failed: ${message}`);
      showToast(`Local load failed: ${message}`);
    }
  };

  const handleOpenLocalProject = async (projectId: string) => {
    addDebug(`Opening local project: ${projectId}`);
    try {
      const result = await restoreProjectFromIndexedDb(projectId);
      showToast(`Opened ${result.restoredProject.title} with ${result.restoredAssets}/${result.restoredProject.files.length} audio asset(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addDebug(`Open local project failed: ${message}`);
      showToast(`Open local project failed: ${message}`);
    }
  };

  // Notification Banner State
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3000);
  };

  const handleAnalyzeRepair = () => {
    if (!mixDoctorReport || mixDoctorReport.problems.length === 0) {
      showToast("Run AIMIX analysis first, or no repair issue was found.");
      return;
    }
    createMixDoctorSpectralRepair(mixDoctorReport.problems, mixDoctorReport.mode);
    setActiveView("repair");
    updateRepairViewState({ viewMode: "artifact_heatmap" });
    showToast("Repair analyzed. Select Hot Regions and apply only the regions you need.");
  };

  const handleApplyRepairRegions = (ops: Parameters<typeof applyMixDoctorSpectralRepair>[0]) => {
    applyMixDoctorSpectralRepair(ops);
    setActiveView("repair");
    updateRepairViewState({ viewMode: "artifact_heatmap", previewMode: "processed" });
    showToast(`Applied ${ops.length} non-destructive repair region${ops.length === 1 ? "" : "s"}.`);
  };

  return (
    <div className={`flex h-[100dvh] w-full flex-col overflow-hidden bg-daw-bg text-[#f4f7fb] font-sans selection:bg-daw-cyan selection:text-black ${
      isSimulatedFullscreen ? "fixed inset-0 z-[9999]" : "relative"
    }`} style={{ height: "100dvh" }}>
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed top-6 right-6 z-[100] rounded-xl border border-daw-cyan/40 bg-[#0d1629]/95 px-5 py-3 text-xs font-bold text-daw-text shadow-glow-cyan animate-pulse-glow">
          {toastMessage}
        </div>
      )}

      {/* Main Top Header: Matches the original minimal styling, now optimized for mobile & supports double-click fullscreen toggle */}
      <header 
        onDoubleClick={toggleFullscreen}
        onTouchEnd={(event) => {
          if (event.target === event.currentTarget) handleTouchHeader();
        }}
        title="Double-tap or double-click to toggle Fullscreen"
        className="safe-top flex min-h-[48px] shrink-0 flex-wrap items-center justify-between border-b border-daw-line bg-daw-panel px-2 py-1.5 sm:min-h-[52px] sm:flex-nowrap sm:px-4 sm:py-0 gap-1.5 sm:gap-4 select-none cursor-pointer"
      >
        <div className="order-1 flex min-w-0 flex-1 items-center gap-1.5 sm:order-none sm:flex-none sm:gap-2">
          <span className="hidden sm:grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-daw-cyan/25 bg-daw-cyan/10 text-daw-cyan">
            <LayoutGrid size={16} />
          </span>
          <div className="min-w-0 flex items-center gap-2">
            <h1 className="text-sm sm:text-base font-extrabold tracking-wider text-daw-text leading-tight font-sans">
              Sweet DAW
            </h1>
            <a
              href="sweet_daw_guide.html"
              target="_blank"
              rel="noreferrer"
              onClick={(event) => event.stopPropagation()}
              className="inline-flex min-h-[26px] shrink-0 items-center gap-1 rounded-lg border border-daw-cyan/25 bg-daw-cyan/10 px-2 text-[10px] font-extrabold uppercase tracking-wide text-daw-cyan transition-colors hover:border-daw-cyan/45 hover:bg-daw-cyan/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-daw-cyan"
              title="Open Sweet DAW Guide"
              aria-label="Open Sweet DAW Guide"
            >
              <BookOpen size={12} />
              <span>Guide</span>
            </a>
          </div>
        </div>
 
        {/* Views Tabs Selector */}
        <div className="order-3 grid w-full grid-cols-4 gap-0.5 bg-black/20 p-0.5 rounded-lg border border-white/[0.03] shrink-0 sm:order-none sm:flex sm:w-auto">
          {(["arrange", "mix", "repair", "files"] as const).map((view) => (
            <button
              key={view}
              type="button"
              onClick={() => setActiveView(view)}
              className={`daw-btn !min-h-[34px] px-2 sm:px-3.5 !rounded-lg text-[10px] sm:text-xs font-bold uppercase tracking-wider transition-all ${
                activeView === view ? "daw-btn-primary" : "daw-btn-ghost !border-none !bg-transparent"
              }`}
            >
              {view}
            </button>
          ))}
        </div>
 
        {/* Header Toolbar Actions */}
        <div className="order-2 flex items-center gap-1 sm:order-none sm:gap-1.5 shrink-0">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              if (transport.isPlaying) handleStop();
              else void handlePlay();
            }}
            className={`daw-btn !min-h-[28px] sm:!min-h-[34px] px-2 sm:px-3 !rounded-lg text-[10px] sm:text-xs font-bold transition-all ${
              transport.isPlaying
                ? "border-daw-red/45 bg-daw-red/15 text-daw-red"
                : "border-daw-cyan/50 bg-daw-cyan/15 text-daw-cyan shadow-[0_0_12px_rgba(77,217,255,0.18)]"
            }`}
            title={transport.isPlaying ? "Stop playback" : "Play"}
            aria-label={transport.isPlaying ? "Stop playback" : "Play"}
          >
            {transport.isPlaying ? <Square size={13} className="sm:mr-1" /> : <Play size={13} className="sm:mr-1" />}
            <span className="hidden sm:inline">{transport.isPlaying ? "Stop" : "Play"}</span>
          </button>

          <label
            className="daw-btn daw-btn-ghost !min-h-[28px] sm:!min-h-[34px] px-2 sm:px-3 !rounded-lg text-[10px] sm:text-xs text-daw-cyan font-bold"
            title="Import Audio"
          >
            <Upload size={13} className="sm:mr-1" />
            <span className="hidden sm:inline">Import</span>
            <input
              type="file"
              multiple
              accept="audio/*,.wav,.m4a,.mp3,.aiff,.aif,.flac,.zip,application/zip"
              className="sr-only"
              onChange={(event) => {
                handleImport(Array.from(event.currentTarget.files ?? []));
                event.currentTarget.value = "";
              }}
            />
          </label>
 
          <button
            type="button"
            onClick={() => setAutoReferenceMixEnabled(!autoReferenceMixSettings.enabled)}
            className={`daw-btn !min-h-[28px] sm:!min-h-[34px] px-2 sm:px-3 !rounded-lg text-[10px] sm:text-xs font-bold transition-all ${
              autoReferenceMixSettings.enabled
                ? "border-emerald-300/45 bg-emerald-300/12 text-emerald-200"
                : "daw-btn-ghost text-daw-muted"
            }`}
            title="Auto Reference Mix"
          >
            <span className="hidden sm:inline">Auto</span>
            <span className="sm:hidden">A</span>
          </button>

          {/* AI Mix Assistant Trigger (Additive - Hidden by default, toggles right sidebar) */}
          <button
            type="button"
            onClick={() => setIsAiMixOpen(!isAiMixOpen)}
            className={`daw-btn !min-h-[28px] sm:!min-h-[34px] px-2 sm:px-3 !rounded-lg text-[10px] sm:text-xs font-bold transition-all ${
              isAiMixOpen
                ? "border-daw-cyan/50 bg-daw-cyan/15 text-daw-cyan shadow-[0_0_12px_rgba(77,217,255,0.25)]"
                : "daw-btn-ghost text-daw-muted"
            }`}
            title="Toggle AI Mix Assistant"
          >
            <Wand2 size={13} className="sm:mr-1 animate-pulse" />
            <span className="hidden sm:inline">AI Mix</span>
          </button>

          {/* Fullscreen Mode Toggle Button */}
          <button
            type="button"
            onClick={toggleFullscreen}
            className={`daw-btn !min-h-[28px] sm:!min-h-[34px] px-2 sm:px-3 !rounded-lg text-[10px] sm:text-xs font-bold transition-all ${
              isFullscreen
                ? "border-daw-cyan/50 bg-daw-cyan/15 text-daw-cyan shadow-[0_0_12px_rgba(77,217,255,0.25)]"
                : "daw-btn-ghost text-daw-muted"
            }`}
            title={isFullscreen ? "Exit Fullscreen" : "Enter Fullscreen"}
          >
            {isFullscreen ? (
              <Minimize2 size={13} className="sm:mr-1" />
            ) : (
              <Maximize2 size={13} className="sm:mr-1" />
            )}
            <span className="hidden sm:inline">
              {isFullscreen ? "Exit Full" : "Fullscreen"}
            </span>
          </button>
        </div>
      </header>

      {/* Main Workspace Layout */}
      <div className="flex-1 min-h-0 flex overflow-hidden relative">
        {/* Central main workspace with transport */}
        <main className="flex-1 flex flex-col min-w-0 p-2 sm:p-3 relative overflow-hidden">

          <div className="flex-1 min-h-0 relative">
            {activeView === "arrange" && (
              <div className="absolute inset-0 flex min-h-0 overflow-hidden">
                <ArrangeView
                  project={project}
                  peaksByFileId={waveformPeaks}
                  positionSec={transport.positionSec}
                  onSeek={handleSeek}
                  onAddSectionMarker={addSectionMarker}
                  onDeleteSectionMarker={deleteSectionMarker}
                  selectedTrackId={selectedTrackId}
                  selectedClipId={selectedClipId}
                  onSelectTrack={selectTrack}
                  onMoveTrack={moveTrack}
                  onDeleteTrack={deleteTrack}
                  onSelectClip={selectClip}
                  onMoveClip={moveClip}
                  onTrimClip={trimClip}
            onSplitClip={splitClip}
            onDuplicateClip={duplicateClip}
            onDuplicateTrackBelow={duplicateTrackBelow}
            onDeleteClip={deleteClip}
            onCreateArtifactClip={createArtifactClip}
            onMuteArtifactClip={muteArtifactClip}
            onReduceClipGain={reduceClipGain}
            onCreateSmartGapFill={createSmartGapFill}
            onApplyAutoClipPanMix={applyAutoClipPanMix}
            onUpdateClipPanAutomation={updateClipPanAutomation}
            onResetClipPanAutomation={resetClipPanAutomation}
            onExportSelectedClip={handleExportSelectedClip}
            onSetAllClipsMovementLocked={setAllClipsMovementLocked}
                  onFreezeClip={handleFreezeClip}
                  onUnfreezeClip={unfreezeClip}
                  onClipRoleChange={updateClipRole}
                  onAddClipIntentTag={addClipIntentTag}
                  onRemoveClipIntentTag={removeClipIntentTag}
                  onAddClipPluginChain={addClipPluginChain}
                  onImportToTrack={handleImportToTrack}
                  onAddClipPlugin={(clipId, pluginId) => addPluginAndOpenEditor("clip", clipId, pluginId)}
                  onOpenClipPluginBrowser={(clipId) => setActivePluginBrowser({ target: "clip", targetId: clipId })}
                  onOpenClipPluginEditor={(clipId, pluginInstanceId) =>
                    setActivePluginEditor({ target: "clip", targetId: clipId, instanceId: pluginInstanceId })
                  }
                  onToggleClipPlugin={toggleClipPlugin}
                  onRemoveClipPlugin={removeClipPlugin}
                  onImport={handleImport}
                />
              </div>
            )}
 
            {activeView === "mix" && (
              <div className="absolute inset-0 overflow-hidden">
                <MixConsole
                  project={project}
                  peaksByFileId={waveformPeaks}
                  positionSec={transport.positionSec}
                  selectedTrackId={selectedTrackId}
                  onSelectTrack={selectTrack}
                  onSeek={handleSeek}
                  onTrackChange={updateTrack}
                  onTrackVocalImageChange={updateTrackVocalImage}
                  onOpenTrackEq={(trackId) => setActiveEqTrackId(trackId)}
                  onOpenTrackCharacter={(trackId) => setActiveCharacterTrackId(trackId)}
                  onToggleTrackCompressor={(trackId) => updateTrackCompressor(trackId, { enabled: !project.tracks.find(t => t.id === trackId)?.compressor.enabled })}
                  onOpenTrackPluginBrowser={(trackId) => setActivePluginBrowser({ target: "track", targetId: trackId })}
                  onOpenTrackPluginEditor={(trackId, instanceId) =>
                    setActivePluginEditor({ target: "track", targetId: trackId, instanceId })
                  }
                  onToggleTrackPlugin={toggleTrackPlugin}
                  onMoveTrackPlugin={moveTrackPlugin}
                  onRemoveTrackPlugin={removeTrackPlugin}
                  onAnalyzeTrack={handleAnalyzeTrack}
                  onClearTrackAnalysis={handleClearTrackAnalysis}
                  onRenderTrack={handleRenderTrack}
                  renderingTrackId={renderingTrackId}
                  transformActionsAvailable
                  onMasterGainChange={setMasterGain}
                  onOpenMasterEq={() => setActiveEqTrackId("master")}
                  onToggleMasterCompressor={() => updateMasterCompressor({ enabled: !project.master.compressor.enabled })}
                  onToggleMasterLimiter={setMasterLimiterEnabled}
                  onMasterVocalImageChange={updateMasterVocalImage}
                  onOpenMasterPluginBrowser={() => setActivePluginBrowser({ target: "master", targetId: "master" })}
                  onOpenMasterPluginEditor={(instanceId) =>
                    setActivePluginEditor({ target: "master", targetId: "master", instanceId })
                  }
                  onToggleMasterPlugin={toggleMasterPlugin}
                  onMoveMasterPlugin={moveMasterPlugin}
                  onRemoveMasterPlugin={removeMasterPlugin}
                  meterReadings={meterReadings}
                  masterMeter={masterMeter}
                />
              </div>
            )}

            {activeView === "repair" && (
              <div className="absolute inset-0 overflow-hidden">
                <SpectralRepairView
                  project={project}
                  peaksByFileId={waveformPeaks}
                  selectedTrackId={selectedTrackId}
                  selectedClipId={selectedClipId}
                  positionSec={transport.positionSec}
                  onSelectClip={selectClip}
                  onSeek={handleSeek}
                  onUpdateViewState={updateRepairViewState}
                  onUpsertRegion={upsertRepairRegion}
                  onDeleteRegion={deleteRepairRegion}
                  onToggleRegion={toggleRepairRegion}
                  onFixRegion={fixRepairRegion}
                  mixDoctorReport={mixDoctorReport}
                  spectralRepairReport={spectralRepairReport}
                  onAnalyzeRepair={handleAnalyzeRepair}
                  onApplySpectralRepair={handleApplyRepairRegions}
                  onToast={showToast}
                />
              </div>
            )}
            {activeView === "files" && (
              <div className="absolute inset-0 overflow-hidden">
                <FileManager
            project={project}
            isImporting={isImporting}
            importProgress={importProgress}
            isExporting={isExporting}
            selectedTrackId={selectedTrackId}
            debugLog={debugLog}
            engineInfo={engineInfo}
            onImport={handleImport}
            onImportReference={handleImportReference}
            onCancelImport={cancelImport}
                  onRestoreProject={handleRestoreProject}
                  onSaveLocalProject={handleSaveLocal}
                  onLoadLocalProject={handleLoadLocal}
            onOpenLocalProject={handleOpenLocalProject}
            onExportPackage={handleExportPackage}
            onExport={handleExport}
            onExportSelectedTrack={handleExportSelectedTrack}
            onExportAllClips={handleExportAllClips}
            onExportProcessedStemPackage={handleExportProcessedStemPackage}
            onExportReferenceRepair={handleExportReferenceRepairPack}
            onDeleteEmptyTracks={deleteEmptyTracks}
            onExportSettingsChange={updateMasterExportSettings}
                  onClear={() => {
                    if (confirm("Reset current project? This will clear all tracks and edits.")) {
                      clearProject();
                      showToast("Project reset completed.");
                    }
                  }}
                  onBpmChange={setBpm}
                  onSnapChange={setSnapMode}
                  recentProjects={recentProjects}
                  storageHealth={Object.keys(storageHealth).length > 0 ? storageHealth : { saveMode: project.storage.saveMode, assetCount: project.storage.assetCount }}
                />
              </div>
            )}
          </div>

          {/* Transport Bar at Bottom */}
          <div className="mt-2 pb-6 sm:pb-0 shrink-0">
            <TransportBar
              project={project}
              isPlaying={transport.isPlaying}
              positionSec={transport.positionSec}
              loopEnabled={transport.loopEnabled}
              isExporting={isExporting}
              onPlay={handlePlay}
              onPause={handlePause}
              onStop={handleStop}
              onLoopToggle={() => setTransport({ loopEnabled: !transport.loopEnabled })}
              onSeek={handleSeek}
              onExport={handleExport}
              canUndo={undoStack.length > 0}
              onUndo={undoProject}
            />
          </div>
        </main>

      {/* Slide-out side panel for AI Mix Assistant (Additive) */}
      {isAiMixOpen && (
        <div className="absolute inset-x-2 bottom-2 z-40 flex h-[min(82dvh,calc(100dvh-4.25rem))] min-h-0 w-[calc(100%-1rem)] flex-col overflow-hidden rounded-2xl border border-daw-line bg-daw-panel p-2 shadow-2xl sm:inset-x-3 sm:bottom-3 lg:static lg:z-auto lg:ml-2 lg:h-full lg:w-[min(46vw,620px)] lg:min-w-[500px] lg:shrink-0 lg:rounded-none lg:border-l lg:border-t-0 lg:p-2 lg:shadow-none xl:w-[620px]">
          <div className="flex h-full min-h-0 flex-col gap-2">
            <div className="grid shrink-0 gap-1 rounded-2xl border border-daw-line bg-daw-bg/50 p-1">
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => setAiPanelMode("aimix")}
                  className={`min-h-[38px] rounded-xl px-2 text-[11px] font-black transition ${
                    aiPanelMode === "aimix" ? "bg-daw-cyan/20 text-daw-cyan" : "text-daw-muted"
                  }`}
                >
                  STEP 1 AIMIX
                </button>
                <button
                  type="button"
                  onClick={() => setAiPanelMode("spatial")}
                  className={`min-h-[38px] rounded-xl px-2 text-[11px] font-black transition ${
                    aiPanelMode === "spatial" ? "bg-daw-cyan/20 text-daw-cyan" : "text-daw-muted"
                  }`}
                >
                  STEP 2 SPATIAL
                </button>
              </div>
              <button
                type="button"
                onClick={() => setAiPanelMode("mastering")}
                className={`min-h-[38px] rounded-xl px-2 text-[11px] font-black transition ${
                  aiPanelMode === "mastering" ? "bg-daw-cyan/20 text-daw-cyan" : "text-daw-muted"
                }`}
              >
                STEP 3 MASTERING
              </button>
              <p className="px-2 pb-1 text-[10px] leading-relaxed text-daw-muted">
                AIMIXで音量と帯域を整え、Spatialで左右と奥行きを配置し、Masteringで最終仕上げと書き出しを行います。
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden pr-1">
              <div className={aiPanelMode === "spatial" ? "hidden" : "h-full min-h-0"}>
                <AiMixAssistantPanel
                  section={aiPanelMode === "mastering" ? "mastering" : "aimix"}
                  onRequestSection={setAiPanelMode}
                />
              </div>
              <div className={aiPanelMode === "spatial" ? "h-full min-h-0" : "hidden"}>
                <AiMixSpatialPanel />
              </div>
            </div>
          </div>
        </div>
      )}
      </div>

      {/* --- PLUGIN EDITORS OVERLAYS --- */}

      {/* 1. EQ Editor overlay */}
      {activeEqTrackId && (
        <EQPanel
          title={activeEqTrackId === "master" ? "Master Bus EQ" : `${project.tracks.find(t => t.id === activeEqTrackId)?.name || "Track"} EQ`}
          eq={activeEqTrackId === "master" ? project.master.eq : project.tracks.find(t => t.id === activeEqTrackId)!.eq}
          onChange={(nextEq) => {
            if (activeEqTrackId === "master") updateMasterEq(nextEq);
            else updateTrackEq(activeEqTrackId, nextEq);
          }}
          onClose={() => setActiveEqTrackId(null)}
          readSpectrum={
            activeEqTrackId === "master"
              ? () => audioEngine.readSpectrum("master:eq:post")
              : () => audioEngine.readSpectrum(`track:${activeEqTrackId}:eq:post`)
          }
          readWaveform={
            activeEqTrackId === "master"
              ? () => audioEngine.readWaveform("master")
              : () => audioEngine.readWaveform(activeEqTrackId)
          }
        />
      )}

      {/* 2. Character Panel overlay */}
      {activeCharacterTrackId && (
        <CharacterPanel
          title={`${project.tracks.find(t => t.id === activeCharacterTrackId)?.name || "Track"} Tone Transformation`}
          state={project.tracks.find(t => t.id === activeCharacterTrackId)!.character}
          onChange={(patch) => updateTrackCharacter(activeCharacterTrackId, patch)}
          onClose={() => setActiveCharacterTrackId(null)}
        />
      )}

      {/* 3. Plugin Browser Sheet */}
      {activePluginBrowser && (
        <PluginBrowserSheet
          targetKind={activePluginBrowser.target}
          title={`Add plugin to ${activePluginBrowser.target}`}
          onAdd={(pluginId) => {
            addPluginAndOpenEditor(activePluginBrowser.target, activePluginBrowser.targetId, pluginId);
          }}
          onClose={() => setActivePluginBrowser(null)}
        />
      )}

      {/* 4. Plugin Editor Sheet */}
      {activePluginEditor && (
        <PluginEditorSheet
          plugin={
            activePluginEditor.target === "track"
              ? project.tracks.find(t => t.id === activePluginEditor.targetId)!.insertChain.find(p => p.id === activePluginEditor.instanceId)!
              : activePluginEditor.target === "master"
                ? project.master.insertChain.find(p => p.id === activePluginEditor.instanceId)!
                : project.clips.find(c => c.id === activePluginEditor.targetId)!.insertChain.find(p => p.id === activePluginEditor.instanceId)!
          }
          onChange={(paramsPatch) => {
            if (activePluginEditor.target === "track") {
              updateTrackPluginParams(activePluginEditor.targetId, activePluginEditor.instanceId, paramsPatch);
            } else if (activePluginEditor.target === "master") {
              updateMasterPluginParams(activePluginEditor.instanceId, paramsPatch);
            } else if (activePluginEditor.target === "clip") {
              updateClipPluginParams(activePluginEditor.targetId, activePluginEditor.instanceId, paramsPatch);
            }
          }}
          onToggle={() => {
            if (activePluginEditor.target === "track") {
              toggleTrackPlugin(activePluginEditor.targetId, activePluginEditor.instanceId);
            } else if (activePluginEditor.target === "master") {
              toggleMasterPlugin(activePluginEditor.instanceId);
            } else if (activePluginEditor.target === "clip") {
              toggleClipPlugin(activePluginEditor.targetId, activePluginEditor.instanceId);
            }
          }}
          onClose={() => setActivePluginEditor(null)}
        />
      )}
      {/* 5. WAV Export Progress Modal Overlay */}
      {isExporting && (
        <div className="fixed inset-0 z-[10000] flex flex-col items-center justify-center bg-black/85 backdrop-blur-md text-[#f4f7fb]">
          <div className="flex flex-col items-center gap-5 p-8 rounded-2xl border border-daw-cyan/35 bg-[#090d16]/95 shadow-glow-cyan max-w-xs text-center">
            <div className="h-10 w-10 animate-spin rounded-full border-4 border-daw-cyan border-t-transparent"></div>
            <div>
              <h3 className="text-sm font-extrabold tracking-widest text-daw-cyan uppercase">Exporting WAV</h3>
              <p className="mt-2 text-xs font-bold text-daw-text">{exportProgress?.currentLabel ?? "Rendering WAV file..."}</p>
              {exportProgress ? (
                <div className="mt-3 text-left">
                  <div className="h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-daw-cyan transition-all"
                      style={{ width: `${Math.min(100, Math.max(0, exportProgress.percent))}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[10px] font-bold text-daw-muted">
                    {exportProgress.totalChunks > 0
                      ? `Export queue ${exportProgress.completedChunks}/${exportProgress.totalChunks} chunks / ${Math.round(exportProgress.percent)}%`
                      : "Offline render stage: progress is indeterminate."}
                  </p>
                </div>
              ) : null}
              <button
                type="button"
                onClick={cancelExport}
                className="mt-4 rounded-xl border border-red-300/35 bg-red-500/10 px-4 py-2 text-[11px] font-extrabold uppercase tracking-[0.18em] text-red-100 active:scale-95"
              >
                Cancel Export
              </button>
              <p className="mt-2 text-[10px] text-daw-muted leading-relaxed">
                Sweet DAW is rendering local effects, mix balance, limiter safety, and WAV encoding. The download will start automatically when it is ready.              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const CHUNK_RECOVERY_SESSION_KEY = "sweet-daw:chunk-recovery-attempted";

function resolveExportDither(bitDepth: WavBitDepth, dither: boolean | DitherOptions) {
  return bitDepth === "pcm16" ? dither : false;
}

function createExportStageProgress(
  currentLabel: string,
  completedChunks = 0,
  totalChunks = 0,
): SweetProcessingJobProgress {
  const safeTotal = Math.max(0, Math.round(totalChunks));
  const safeCompleted = safeTotal === 0 ? 0 : Math.min(safeTotal, Math.max(0, Math.round(completedChunks)));
  return {
    completedChunks: safeCompleted,
    totalChunks: safeTotal,
    percent: safeTotal === 0 ? 0 : Math.round((safeCompleted / safeTotal) * 1000) / 10,
    currentLabel,
    startedAt: Date.now(),
    updatedAt: Date.now(),
  };
}

async function encodeWavBlobFromChannelsIncremental(input: {
  sampleRate: number;
  channels: Float32Array[];
  normalizePeak: boolean;
  peakTargetDb: number;
  bitDepth: WavBitDepth;
  dither: boolean | DitherOptions;
  signal?: AbortSignal;
  onProgress?: (progress: SweetProcessingJobProgress) => void;
}) {
  if (input.channels.length === 0) {
    throw new Error("Cannot encode WAV without audio channels.");
  }
  const totalFrames = Math.max(0, Math.min(...input.channels.map((channel) => channel.length)));
  const chunkFrames = Math.max(1, Math.round(input.sampleRate * 1.5));
  const chunkCount = Math.max(1, Math.ceil(totalFrames / chunkFrames));
  const scanChunks = input.normalizePeak ? chunkCount : 0;
  const totalWork = scanChunks + chunkCount;
  let completedWork = 0;
  let peakGain = 1;

  if (input.normalizePeak) {
    let peak = 0;
    for (let start = 0; start < totalFrames; start += chunkFrames) {
      throwIfExportAborted(input.signal);
      const end = Math.min(totalFrames, start + chunkFrames);
      for (const channel of input.channels) {
        for (let index = start; index < end; index += 1) {
          const sample = channel[index] ?? 0;
          peak = Math.max(peak, Math.abs(Number.isFinite(sample) ? sample : 0));
        }
      }
      completedWork += 1;
      input.onProgress?.(createExportStageProgress("Scanning peaks for safe WAV normalization...", completedWork, totalWork));
      await yieldToBrowserForExport();
    }
    if (peak > 0) {
      peakGain = Math.min(16, 10 ** (input.peakTargetDb / 20) / peak);
    }
  }

  const { createWavStreamingEncoder } = await import("@/audio/export/WavStreamingEncoder");
  const encoder = createWavStreamingEncoder({
    sampleRate: input.sampleRate,
    channels: input.channels.length,
    bitDepth: input.bitDepth,
    dither: input.dither,
    normalizePeak: false,
    totalFrames,
  });

  for (let start = 0; start < totalFrames; start += chunkFrames) {
    throwIfExportAborted(input.signal);
    const end = Math.min(totalFrames, start + chunkFrames);
    const chunk = input.channels.map((channel) => {
      const slice = channel.subarray(start, end);
      if (peakGain === 1) return slice;
      const scaled = new Float32Array(slice.length);
      for (let index = 0; index < slice.length; index += 1) {
        scaled[index] = (slice[index] ?? 0) * peakGain;
      }
      return scaled;
    });
    encoder.writeChunk(chunk);
    completedWork += 1;
    input.onProgress?.(createExportStageProgress("Encoding WAV file in safe chunks...", completedWork, totalWork));
    await yieldToBrowserForExport();
  }

  throwIfExportAborted(input.signal);
  return encoder.finish();
}

function throwIfExportAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  const error = new Error("Export job cancelled.");
  error.name = "AbortError";
  throw error;
}

function yieldToBrowserForExport() {
  if (typeof window === "undefined") return Promise.resolve();
  return new Promise<void>((resolve) => window.requestAnimationFrame(() => window.setTimeout(resolve, 0)));
}

function isChunkLoadError(error: unknown) {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /ChunkLoadError|Loading chunk|failed to fetch dynamically imported module|Importing a module script failed|_next\/static\/chunks/i.test(
    message,
  );
}

async function recoverFromStaleChunk(addDebug: (message: string) => void) {
  if (typeof window === "undefined") return;

  try {
    const alreadyTried = window.sessionStorage.getItem(CHUNK_RECOVERY_SESSION_KEY);
    if (alreadyTried) {
      addDebug("Chunk recovery already attempted in this session.");
      return;
    }
    window.sessionStorage.setItem(CHUNK_RECOVERY_SESSION_KEY, new Date().toISOString());
  } catch {
    // Private browsing can block storage; cache cleanup can still proceed.
  }

  const jobs: Array<Promise<unknown>> = [];

  if ("caches" in window && typeof caches.keys === "function") {
    jobs.push(caches.keys().then((keys) => Promise.all(keys.map((key) => caches.delete(key)))));
  }

  if ("serviceWorker" in navigator && typeof navigator.serviceWorker.getRegistrations === "function") {
    jobs.push(
      navigator.serviceWorker
        .getRegistrations()
        .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister()))),
    );
  }

  try {
    await Promise.allSettled(jobs);
    addDebug("Runtime cache cleared after stale chunk error.");
  } catch (err) {
    addDebug(`Runtime cache cleanup failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  window.setTimeout(() => {
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("sdaw_recover", Date.now().toString());
    window.location.replace(nextUrl.toString());
  }, 450);
}



