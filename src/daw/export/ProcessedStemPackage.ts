import { audioBufferRegistry, type AudioBufferRegistry } from "@/audio/engine/AudioBufferRegistry";
import { renderAmbienceBusOffline, renderProjectOffline, renderTrackOffline } from "@/audio/engine/OfflineRenderer";
import { getProjectDurationSec, hasSoloTrack, isReferenceTrack, isTrackAudible } from "@/audio/engine/TrackGraph";
import { encodeWavFromAudioBuffer, type WavBitDepth } from "@/audio/export/WavEncoder";
import { createProjectBackup } from "@/daw/project/ProjectSerializer";
import type { Project, Track } from "@/daw/model/Project";
import { applyDownOnlyPeakSafetyToAudioBuffer, type AudioExportSafetyReport } from "./AudioExportSafety";
import { buildExportStabilityPlan } from "./ExportStabilityPlanner";
import { createStoredZip, type ZipEntryInput } from "./SimpleZip";

export type ProcessedStemPackageOptions = {
  sampleRate: 44100 | 48000;
  bitDepth: WavBitDepth;
  dither: boolean;
  masterNormalizePeak: boolean;
  masterPeakTargetDb: number;
};

export type ProcessedStemExportManifest = {
  format: "sweet-daw.reference-matched-stem-package";
  version: 1;
  createdAt: string;
  mode: "same-song-reference";
  referenceExcludedFromExport: true;
  masterProcessingIncludedOnlyInMasterWav: true;
  sampleRate: number;
  bitDepth: WavBitDepth;
  exports: {
    master: string;
    processedStems: string[];
    buses: string[];
  };
  skippedTracks: Array<{
    trackId: string;
    name: string;
    role: string;
    reason: "reference" | "muted_or_unsoloed" | "no_clips";
  }>;
  safety: {
    downOnlyPeakCeilingDb: number;
    masterNormalizePeakRequested: boolean;
    upwardNormalizationApplied: false;
    master: AudioExportSafetyReport;
    processedStems: Array<AudioExportSafetyReport & {
      path: string;
      trackId: string;
      trackName: string;
      role: string;
    }>;
    buses: Array<AudioExportSafetyReport & {
      path: string;
      busName: string;
    }>;
  };
  notes: string[];
};

export type ProcessedStemPackageResult = {
  blob: Blob;
  manifest: ProcessedStemExportManifest;
  stemCount: number;
  busCount: number;
};

export type ProcessedStemPackageMode =
  | "single-zip"
  | "split-zip"
  | "individual-downloads";

export type ProcessedStemPackageStableOptions = ProcessedStemPackageOptions & {
  mode?: "auto" | ProcessedStemPackageMode;
  signal?: AbortSignal;
  onProgress?: (progress: { completedChunks: number; totalChunks: number; percent: number; currentLabel?: string }) => void;
  onPartReady?: (part: {
    blob: Blob;
    fileName: string;
    manifest: ProcessedStemExportManifest;
    partIndex: number;
    partCount?: number;
  }) => Promise<void> | void;
};

export type ProcessedStemPackageStableResult = {
  mode: ProcessedStemPackageMode;
  stemCount: number;
  partCount: number;
  manifest: ProcessedStemExportManifest;
  warnings: string[];
};

export async function createProcessedStemPackage(
  project: Project,
  registry: AudioBufferRegistry = audioBufferRegistry,
  options: ProcessedStemPackageOptions,
): Promise<ProcessedStemPackageResult> {
  const createdAt = new Date().toISOString();
  const entries: ZipEntryInput[] = [];
  const processedStemPaths: string[] = [];
  const busPaths: string[] = [];
  const skippedTracks: ProcessedStemExportManifest["skippedTracks"] = [];
  const renderDurationSec = Math.max(0.1, getProjectDurationSec(project) + 0.05);
  const workTracks = project.tracks.filter((track) => !isReferenceTrack(track));
  const soloActive = hasSoloTrack(workTracks);
  const downOnlyPeakCeilingDb = resolveDownOnlyPeakCeilingDb(options.masterPeakTargetDb);
  const wavOptions = {
    normalizePeak: false,
    bitDepth: options.bitDepth,
    dither: resolveExportDither(options.bitDepth, options.dither),
    peakTargetDb: options.masterPeakTargetDb,
  };

  const masterBuffer = await renderProjectOffline(project, registry, {
    sampleRate: options.sampleRate,
    renderPaddingSec: 0.05,
  });
  const masterSafety = applyDownOnlyPeakSafetyToAudioBuffer(masterBuffer, downOnlyPeakCeilingDb);
  entries.push({
    path: "master/mix_master.wav",
    data: encodeWavFromAudioBuffer(masterBuffer, wavOptions),
  });

  const stemSafetyReports: ProcessedStemExportManifest["safety"]["processedStems"] = [];
  for (const [workIndex, track] of workTracks.entries()) {
    const trackClips = project.clips.filter((clip) => clip.trackId === track.id);
    if (!isTrackAudible(track, soloActive)) {
      skippedTracks.push(toSkippedTrack(track, "muted_or_unsoloed"));
      continue;
    }
    if (trackClips.length === 0) {
      skippedTracks.push(toSkippedTrack(track, "no_clips"));
      continue;
    }

    const rendered = await renderTrackOffline(project, track.id, registry, {
      sampleRate: options.sampleRate,
      includeMasterFx: false,
      normalizePeak: false,
      renderPaddingSec: 0,
      fixedDurationSec: renderDurationSec,
    });
    const path = `stems_processed/${formatStemFileName(workIndex, track)}`;
    const safety = applyDownOnlyPeakSafetyToAudioBuffer(rendered, downOnlyPeakCeilingDb);
    processedStemPaths.push(path);
    stemSafetyReports.push({
      ...safety,
      path,
      trackId: track.id,
      trackName: track.name,
      role: track.role,
    });
    entries.push({
      path,
      data: encodeWavFromAudioBuffer(rendered, wavOptions),
    });
  }

  for (const track of project.tracks.filter((track) => isReferenceTrack(track))) {
    skippedTracks.push(toSkippedTrack(track, "reference"));
  }

  const ambienceBuffer = await renderAmbienceBusOffline(project, registry, {
    sampleRate: options.sampleRate,
    renderPaddingSec: 0.05,
  });
  const ambiencePath = "bus/ambience_bus.wav";
  const ambienceSafety = applyDownOnlyPeakSafetyToAudioBuffer(ambienceBuffer, downOnlyPeakCeilingDb);
  busPaths.push(ambiencePath);
  entries.push({
    path: ambiencePath,
    data: encodeWavFromAudioBuffer(ambienceBuffer, wavOptions),
  });

  const manifest: ProcessedStemExportManifest = {
    format: "sweet-daw.reference-matched-stem-package",
    version: 1,
    createdAt,
    mode: "same-song-reference",
    referenceExcludedFromExport: true,
    masterProcessingIncludedOnlyInMasterWav: true,
    sampleRate: options.sampleRate,
    bitDepth: options.bitDepth,
    exports: {
      master: "master/mix_master.wav",
      processedStems: processedStemPaths,
      buses: busPaths,
    },
    skippedTracks,
    safety: {
      downOnlyPeakCeilingDb,
      masterNormalizePeakRequested: options.masterNormalizePeak,
      upwardNormalizationApplied: false,
      master: masterSafety,
      processedStems: stemSafetyReports,
      buses: [
        {
          ...ambienceSafety,
          path: ambiencePath,
          busName: "Ambience",
        },
      ],
    },
    notes: [
      "Audio safety is down-only: this package never raises quiet audio during WAV encoding.",
      "If any stem, bus, or master file exceeds the safety ceiling, Sweet DAW applies only an attenuating peak trim before encoding.",
      "Invalid NaN/Infinity samples are replaced with silence before WAV encoding.",
      "Processed stems include track EQ, character, compressor, insert chain, track gain, track pan, clip gain, clip fades, clip inserts, and clip pan automation.",
      "Processed stems exclude master EQ, master compressor, master limiter, master gain, and master insert chain.",
      "Reference tracks are excluded from all audio exports.",
      "Ambience send return is exported separately as bus/ambience_bus.wav and is not burned into processed stems.",
    ],
  };

  entries.push(
    {
      path: "meta/export_manifest.json",
      data: JSON.stringify(manifest, null, 2),
    },
    {
      path: "meta/sweet_daw_project.json",
      data: JSON.stringify(createProjectBackup(project), null, 2),
    },
  );

  return {
    blob: await createStoredZip(entries),
    manifest,
    stemCount: processedStemPaths.length,
    busCount: busPaths.length,
  };
}

function resolveExportDither(bitDepth: WavBitDepth, dither: boolean) {
  return bitDepth === "pcm16" ? dither : false;
}

export async function createProcessedStemPackageStable(
  project: Project,
  registry: AudioBufferRegistry = audioBufferRegistry,
  options: ProcessedStemPackageStableOptions,
): Promise<ProcessedStemPackageStableResult> {
  const plan = buildExportStabilityPlan(project, {
    purpose: "processed-stem-package",
    sampleRate: options.sampleRate,
  });
  const mode = resolveStablePackageMode(project, plan.allowSingleZip, options.mode);
  const warnings = [...plan.warnings];
  const safeTitle = sanitizeFilePart(project.title || "sweet-daw") || "sweet-daw";

  if (mode === "single-zip") {
    const result = await createProcessedStemPackage(project, registry, options);
    await options.onPartReady?.({
      blob: result.blob,
      fileName: `${safeTitle}_reference_matched_stem_package.zip`,
      manifest: result.manifest,
      partIndex: 1,
      partCount: 1,
    });
    return {
      mode,
      stemCount: result.stemCount,
      partCount: 1,
      manifest: result.manifest,
      warnings,
    };
  }

  warnings.push(
    mode === "split-zip"
      ? "Large project detected. Sweet DAW exported stems in stable ZIP parts instead of one huge ZIP."
      : "Critical-size project detected. Sweet DAW exported one WAV at a time to avoid one huge ZIP.",
  );

  const createdAt = new Date().toISOString();
  const workTracks = project.tracks.filter((track) => !isReferenceTrack(track));
  const soloActive = hasSoloTrack(workTracks);
  const eligibleTracks = workTracks.filter((track) => isTrackAudible(track, soloActive) && project.clips.some((clip) => clip.trackId === track.id));
  const skippedTracks: ProcessedStemExportManifest["skippedTracks"] = [];
  for (const track of workTracks) {
    if (!isTrackAudible(track, soloActive)) skippedTracks.push(toSkippedTrack(track, "muted_or_unsoloed"));
    else if (!project.clips.some((clip) => clip.trackId === track.id)) skippedTracks.push(toSkippedTrack(track, "no_clips"));
  }
  for (const track of project.tracks.filter((track) => isReferenceTrack(track))) {
    skippedTracks.push(toSkippedTrack(track, "reference"));
  }

  const downOnlyPeakCeilingDb = resolveDownOnlyPeakCeilingDb(options.masterPeakTargetDb);
  const wavOptions = {
    normalizePeak: false,
    bitDepth: options.bitDepth,
    dither: resolveExportDither(options.bitDepth, options.dither),
    peakTargetDb: options.masterPeakTargetDb,
  };
  const renderDurationSec = Math.max(0.1, getProjectDurationSec(project) + 0.05);
  const processedStemPaths = eligibleTracks.map((track, index) => `stems_processed/${formatStemFileName(index, track)}`);
  const busPaths = mode === "split-zip" ? ["bus/ambience_bus.wav"] : [];
  const stemSafetyReports: ProcessedStemExportManifest["safety"]["processedStems"] = [];
  const busSafetyReports: ProcessedStemExportManifest["safety"]["buses"] = [];
  const masterSafety = createEmptySafetyReport(downOnlyPeakCeilingDb);
  const totalUnits = Math.max(1, eligibleTracks.length + (mode === "split-zip" ? 2 : 1));
  let completedUnits = 0;
  let partIndex = 0;

  const makeManifest = (): ProcessedStemExportManifest => ({
    format: "sweet-daw.reference-matched-stem-package",
    version: 1,
    createdAt,
    mode: "same-song-reference",
    referenceExcludedFromExport: true,
    masterProcessingIncludedOnlyInMasterWav: true,
    sampleRate: options.sampleRate,
    bitDepth: options.bitDepth,
    exports: {
      master: mode === "split-zip" ? "master/mix_master.wav" : "",
      processedStems: processedStemPaths,
      buses: busPaths,
    },
    skippedTracks,
    safety: {
      downOnlyPeakCeilingDb,
      masterNormalizePeakRequested: options.masterNormalizePeak,
      upwardNormalizationApplied: false,
      master: masterSafety,
      processedStems: stemSafetyReports,
      buses: busSafetyReports,
    },
    notes: [
      "Stable package export avoids one huge in-memory ZIP for larger projects.",
      "Reference tracks are excluded from all audio exports.",
      "Audio safety is down-only: this package never raises quiet audio during WAV encoding.",
      ...warnings,
    ],
  });

  if (mode === "individual-downloads") {
    for (const [index, track] of eligibleTracks.entries()) {
      throwIfAborted(options.signal);
      emitStablePackageProgress(options, completedUnits, totalUnits, `Rendering ${track.name}`);
      const rendered = await renderTrackOffline(project, track.id, registry, {
        sampleRate: options.sampleRate,
        includeMasterFx: false,
        normalizePeak: false,
        renderPaddingSec: 0,
        fixedDurationSec: renderDurationSec,
      });
      const path = processedStemPaths[index] ?? `stems_processed/${formatStemFileName(index, track)}`;
      const safety = applyDownOnlyPeakSafetyToAudioBuffer(rendered, downOnlyPeakCeilingDb);
      stemSafetyReports.push({ ...safety, path, trackId: track.id, trackName: track.name, role: track.role });
      partIndex += 1;
      await options.onPartReady?.({
        blob: encodeWavFromAudioBuffer(rendered, wavOptions),
        fileName: `${safeTitle}_${String(index + 1).padStart(2, "0")}_${sanitizeFilePart(track.name)}_processed.wav`,
        manifest: makeManifest(),
        partIndex,
      });
      completedUnits += 1;
      emitStablePackageProgress(options, completedUnits, totalUnits, `Downloaded ${track.name}`);
      await idleBetweenStemDownloads();
    }
    partIndex += 1;
    await options.onPartReady?.({
      blob: new Blob([JSON.stringify(makeManifest(), null, 2)], { type: "application/json" }),
      fileName: `${safeTitle}_processed_stems_manifest.json`,
      manifest: makeManifest(),
      partIndex,
      partCount: partIndex,
    });
    return { mode, stemCount: eligibleTracks.length, partCount: partIndex, manifest: makeManifest(), warnings };
  }

  const stemsPerPart = 6;
  const estimatedPartCount = Math.max(1, Math.ceil(eligibleTracks.length / stemsPerPart));
  const masterBuffer = await renderProjectOffline(project, registry, {
    sampleRate: options.sampleRate,
    renderPaddingSec: 0.05,
  });
  const actualMasterSafety = applyDownOnlyPeakSafetyToAudioBuffer(masterBuffer, downOnlyPeakCeilingDb);
  Object.assign(masterSafety, actualMasterSafety);
  completedUnits += 1;

  for (let start = 0; start < eligibleTracks.length; start += stemsPerPart) {
    throwIfAborted(options.signal);
    const entries: ZipEntryInput[] = [];
    if (start === 0) {
      entries.push({ path: "master/mix_master.wav", data: encodeWavFromAudioBuffer(masterBuffer, wavOptions) });
    }
    const tracks = eligibleTracks.slice(start, start + stemsPerPart);
    for (const track of tracks) {
      const trackIndex = eligibleTracks.indexOf(track);
      emitStablePackageProgress(options, completedUnits, totalUnits, `Rendering ${track.name}`);
      const rendered = await renderTrackOffline(project, track.id, registry, {
        sampleRate: options.sampleRate,
        includeMasterFx: false,
        normalizePeak: false,
        renderPaddingSec: 0,
        fixedDurationSec: renderDurationSec,
      });
      const path = processedStemPaths[trackIndex] ?? `stems_processed/${formatStemFileName(trackIndex, track)}`;
      const safety = applyDownOnlyPeakSafetyToAudioBuffer(rendered, downOnlyPeakCeilingDb);
      stemSafetyReports.push({ ...safety, path, trackId: track.id, trackName: track.name, role: track.role });
      entries.push({ path, data: encodeWavFromAudioBuffer(rendered, wavOptions) });
      completedUnits += 1;
    }
    if (start + stemsPerPart >= eligibleTracks.length) {
      const ambienceBuffer = await renderAmbienceBusOffline(project, registry, {
        sampleRate: options.sampleRate,
        renderPaddingSec: 0.05,
      });
      const ambiencePath = "bus/ambience_bus.wav";
      const ambienceSafety = applyDownOnlyPeakSafetyToAudioBuffer(ambienceBuffer, downOnlyPeakCeilingDb);
      busSafetyReports.push({ ...ambienceSafety, path: ambiencePath, busName: "Ambience" });
      entries.push({ path: ambiencePath, data: encodeWavFromAudioBuffer(ambienceBuffer, wavOptions) });
      completedUnits += 1;
    }
    const manifest = makeManifest();
    entries.push(
      { path: "meta/export_manifest.json", data: JSON.stringify(manifest, null, 2) },
      { path: "meta/sweet_daw_project.json", data: JSON.stringify(createProjectBackup(project), null, 2) },
    );
    partIndex += 1;
    await options.onPartReady?.({
      blob: await createStoredZip(entries),
      fileName: `${safeTitle}_processed_stems_part_${String(partIndex).padStart(2, "0")}_of_${String(estimatedPartCount).padStart(2, "0")}.zip`,
      manifest,
      partIndex,
      partCount: estimatedPartCount,
    });
    emitStablePackageProgress(options, completedUnits, totalUnits, `Exported package part ${partIndex}/${estimatedPartCount}`);
    await idleBetweenStemDownloads();
  }

  return {
    mode,
    stemCount: eligibleTracks.length,
    partCount: partIndex,
    manifest: makeManifest(),
    warnings,
  };
}

function resolveDownOnlyPeakCeilingDb(requested: number) {
  if (!Number.isFinite(requested)) return -1;
  return Math.min(-1, Math.max(-3, requested));
}

function resolveStablePackageMode(project: Project, allowSingleZip: boolean, requested: ProcessedStemPackageStableOptions["mode"]): ProcessedStemPackageMode {
  if (requested && requested !== "auto") return requested;
  const workTrackCount = project.tracks.filter((track) => !isReferenceTrack(track)).length;
  if (allowSingleZip && workTrackCount <= 8) return "single-zip";
  if (workTrackCount <= 64) return "split-zip";
  return "individual-downloads";
}

function createEmptySafetyReport(ceilingDb: number): AudioExportSafetyReport {
  return {
    ceilingDb,
    peakDbBefore: -120,
    peakDbAfter: -120,
    rmsDbBefore: -120,
    rmsDbAfter: -120,
    appliedGainDb: 0,
    invalidSampleCount: 0,
    samplesAboveCeilingBefore: 0,
    hardClipRiskSamplesBefore: 0,
    action: "none",
  };
}

function emitStablePackageProgress(
  options: ProcessedStemPackageStableOptions,
  completedChunks: number,
  totalChunks: number,
  currentLabel: string,
) {
  const safeTotal = Math.max(1, totalChunks);
  const safeCompleted = Math.max(0, Math.min(safeTotal, completedChunks));
  options.onProgress?.({
    completedChunks: safeCompleted,
    totalChunks: safeTotal,
    percent: Math.round((safeCompleted / safeTotal) * 1000) / 10,
    currentLabel,
  });
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (!signal?.aborted) return;
  if (typeof DOMException !== "undefined") throw new DOMException("Export job cancelled.", "AbortError");
  const error = new Error("Export job cancelled.");
  error.name = "AbortError";
  throw error;
}

function idleBetweenStemDownloads() {
  const requestIdle = (globalThis as typeof globalThis & { requestIdleCallback?: (callback: () => void, options?: { timeout?: number }) => number }).requestIdleCallback;
  if (typeof requestIdle === "function") {
    return new Promise<void>((resolve) => requestIdle(() => resolve(), { timeout: 80 }));
  }
  return new Promise<void>((resolve) => setTimeout(resolve, 80));
}

function formatStemFileName(index: number, track: Track) {
  const role = sanitizeFilePart(track.role || track.type || "track");
  const name = sanitizeFilePart(track.name || role);
  return `${String(index).padStart(2, "0")}_${role}_${name}_processed.wav`;
}

function sanitizeFilePart(value: string) {
  return value
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9-_]+/gi, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "track";
}

function toSkippedTrack(track: Track, reason: ProcessedStemExportManifest["skippedTracks"][number]["reason"]) {
  return {
    trackId: track.id,
    name: track.name,
    role: track.role,
    reason,
  };
}
