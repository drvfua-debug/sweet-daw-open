import { audioBufferRegistry, type AudioBufferRegistry } from "@/audio/engine/AudioBufferRegistry";
import { prepareStreamingWavSources } from "@/audio/engine/StreamingWavSource";
import { connectPostInsertPath } from "@/audio/engine/AudioGraphRouting";
import { analyzeAudioBufferLoudness, type LoudnessAnalysis } from "@/audio/analysis/LoudnessAnalyzer";
import { createClipPanAutomationNode } from "@/audio/engine/ClipPanAutomation";
import { createMasterBus } from "@/audio/engine/MasterBus";
import {
  capPeakMaximizerOversample,
  detectBrowserEngineQualityMode,
  formatEngineQualityModeReport,
  resolveEngineProcessingBudget,
  type EngineProcessingBudget,
  type EngineQualityMode,
} from "@/audio/engine/EngineQualityMode";
import { dbToGain, hasSoloTrack, isReferenceTrack, isTrackAudible } from "@/audio/engine/TrackGraph";
import { createCharacter } from "@/audio/fx/Character";
import { createCompressor } from "@/audio/fx/Compressor";
import { buildVocalActivityEnvelope, buildVocalActivityWindows, createDynamicVocalDuckNode, shouldUseVocalDuck, type VocalDuckWindow } from "@/audio/fx/DynamicVocalDuck";
import { createParametricEQ } from "@/audio/fx/ParametricEQ";
import { createVocalImageLayer, isVocalImageLayerActive } from "@/audio/fx/VocalImageLayer";
import { buildPluginChain } from "@/audio/plugins/PluginChain";
import { processPeakMaximizerOffline, resolvePeakMaximizerMemoryPlan, resolvePeakMaximizerParams, type PeakMaximizerReport } from "@/audio/dsp/PeakMaximizer";
import { buildClipRepairAudio } from "@/audio/repair/repairPreview";
import { applyUnmaskOperationsToChannels } from "@/daw/aimixUnmask/unmaskDsp";
import type { PluginInstance } from "@/daw/model/Plugin";
import type { AudioFileRef, Clip, MasterState, Project, Track } from "@/daw/model/Project";
import type { SpectralRepairRegion } from "@/daw/repair/repairTypes";
import type { SweetUnmaskOperation } from "@/daw/aimixUnmask/aimixUnmaskTypes";
import { STABLE_EXPORT_SAMPLE_RATE } from "@/daw/export/ExportConsistency";

export type OfflineRenderOptions = {
  sampleRate?: 44100 | 48000;
  renderPaddingSec?: number;
  maxDurationSec?: number;
  engineQualityMode?: EngineQualityMode;
  memoryBudgetBytes?: number;
  skipMemoryPreflight?: boolean;
  streamSourceFiles?: boolean;
};

export type OfflineRenderResult = {
  buffer: AudioBuffer;
  warnings: string[];
  engineQualityMode: EngineQualityMode;
  processingBudget: EngineProcessingBudget;
  peakMaximizerReport?: PeakMaximizerReport;
};

export type OfflineRenderMemoryEstimateInput = {
  frameCount: number;
  channels: number;
  sampleRate: number;
  includePeakMaximizer?: boolean;
  peakMaximizerMemoryBytes?: number;
  memoryBudgetBytes?: number;
};

export type OfflineRenderMemoryEstimate = {
  estimatedBytes: number;
  memoryBudgetBytes: number;
  frameCount: number;
  channels: number;
  durationSec: number;
};

export const PEAK_MAXIMIZER_MEMORY_BYPASS_WARNING =
  "Peak Maximizer was bypassed by memory safety. Final peak trim was still applied, but loudness/drive lift may be lower than requested.";

export class OfflineRenderMemoryPreflightError extends Error {
  readonly estimate: OfflineRenderMemoryEstimate;

  constructor(estimate: OfflineRenderMemoryEstimate) {
    super(
      `Offline render is too large for stable browser memory (${formatMemoryMb(estimate.estimatedBytes)}MB estimated / ${formatMemoryMb(estimate.memoryBudgetBytes)}MB budget). Use a shorter export range or stable/chunked export when available.`,
    );
    this.name = "OfflineRenderMemoryPreflightError";
    this.estimate = estimate;
  }
}

export type OfflineRenderStage = "pre-master" | "post-master" | "export";

export type ProjectSliceRenderRange = {
  startSec: number;
  endSec: number;
  preRollSec: number;
  postRollSec: number;
};

export type PaddedProjectSliceRender = {
  channels: Float32Array[];
  cropStartFrame: number;
  cropFrameCount: number;
};

export type TrackRenderOptions = OfflineRenderOptions & {
  includeMasterFx?: boolean;
  normalizePeak?: boolean;
  ceilingDb?: number;
  fixedDurationSec?: number;
};

export type ClipRenderOptions = OfflineRenderOptions & {
  normalizePeak?: boolean;
  ceilingDb?: number;
  repairRegions?: SpectralRepairRegion[];
  unmaskOperations?: SweetUnmaskOperation[];
};

export const SWEET_DAW_OFFLINE_RENDER_PROCESSING_ORDER = [
  "clip_region_repair",
  "aimix_unmask",
  "clip_gain",
  "clip_pan",
  "clip_insert_chain",
  "track_corrective_eq",
  "character",
  "compressor_leveler",
  "insert_plugin_chain",
  "vocal_duck",
  "vocal_image_layer",
  "pan_spatial",
  "track_gain",
  "sends_ambience",
  "mix_bus_trim",
  "master_corrective_eq",
  "master_compressor",
  "master_insert_chain",
  "master_gain",
  "limiter_or_peak_maximizer",
  "final_output_trim",
  "export_peak_safety",
] as const;

export async function renderProjectOffline(
  project: Project,
  registry: AudioBufferRegistry = audioBufferRegistry,
  options: OfflineRenderOptions = {},
) {
  return (await renderProjectOfflineWithReport(project, registry, options)).buffer;
}

export async function renderProjectOfflineWithReport(
  project: Project,
  registry: AudioBufferRegistry = audioBufferRegistry,
  options: OfflineRenderOptions = {},
) {
  const warnings: string[] = [];
  const engineQualityMode = options.engineQualityMode ?? detectBrowserEngineQualityMode(true);
  const processingBudget = resolveEngineProcessingBudget(engineQualityMode, { memoryBudgetBytes: options.memoryBudgetBytes });
  const renderReportBase = { engineQualityMode, processingBudget };
  const activePeakMax = findLastEnabledPeakMaximizer(project.master.insertChain);
  const renderProject = activePeakMax ? createProjectForOfflineRenderWithoutPeakMax(project) : project;
  const sampleRate = options.sampleRate ?? STABLE_EXPORT_SAMPLE_RATE;
  const exportTracks = renderProject.tracks.filter((track) => !isReferenceTrack(track));
  const exportTrackIds = new Set(exportTracks.map((track) => track.id));
  const fullDurationSec = getClipDurationSec(renderProject.clips.filter((clip) => exportTrackIds.has(clip.trackId))) + (options.renderPaddingSec ?? 0.05);
  const durationSec = Math.max(0.1, options.maxDurationSec ? Math.min(fullDurationSec, options.maxDurationSec) : fullDurationSec);
  const frameCount = Math.ceil(durationSec * sampleRate);
  const peakMaxParams = activePeakMax ? resolvePeakMaximizerParams(activePeakMax.params) : null;
  const peakMaxMemoryBudgetBytes = options.memoryBudgetBytes ?? processingBudget.peakMaxMemoryBudgetBytes;
  const requestedPeakMaxOversample = peakMaxParams
    ? capPeakMaximizerOversample(peakMaxParams.oversample, processingBudget.peakMaxOversampleCap)
    : null;
  const peakMaxMemoryPlan = peakMaxParams
    ? resolvePeakMaximizerMemoryPlan(frameCount, 2, requestedPeakMaxOversample ?? peakMaxParams.oversample, {
        ...(activePeakMax?.params ?? {}),
        memoryBudgetBytes: peakMaxMemoryBudgetBytes,
      })
    : null;
  warnings.push(formatEngineQualityModeReport(processingBudget));
  if (peakMaxParams && requestedPeakMaxOversample !== peakMaxParams.oversample) {
    warnings.push(`EngineQualityMode ${engineQualityMode}: Peak Maximizer oversample capped ${peakMaxParams.oversample} -> ${requestedPeakMaxOversample}.`);
  }
  if (peakMaxMemoryPlan?.memoryExceeded) {
    warnings.push(PEAK_MAXIMIZER_MEMORY_BYPASS_WARNING);
  }
  if (!options.skipMemoryPreflight) {
    assertOfflineRenderMemoryWithinBudget({
      frameCount,
      channels: 2,
      sampleRate,
      includePeakMaximizer: Boolean(activePeakMax),
      peakMaximizerMemoryBytes: peakMaxMemoryPlan && !peakMaxMemoryPlan.memoryExceeded ? peakMaxMemoryPlan.estimatedMemoryBytes : 0,
      memoryBudgetBytes: options.memoryBudgetBytes ?? processingBudget.offlineRenderMemoryBudgetBytes,
    });
  }
  const OfflineAudioContextCtor = window.OfflineAudioContext ?? window.webkitOfflineAudioContext;

  if (!OfflineAudioContextCtor) {
    throw new Error("This browser does not support OfflineAudioContext.");
  }

  const offlineContext = new OfflineAudioContextCtor(2, frameCount, sampleRate);
  const sourcePreparation = options.streamSourceFiles
    ? await prepareStreamingWavSources(renderProject, registry, offlineContext)
    : null;
  const graphProject = sourcePreparation?.project ?? renderProject;
  const graphRegistry = sourcePreparation?.registry ?? registry;
  if (sourcePreparation) {
    warnings.push(
      `Streaming WAV sources: ${sourcePreparation.streamedFileCount} partial / ${sourcePreparation.fallbackFileCount} full-buffer fallback.`,
      ...sourcePreparation.warnings,
    );
  }
  const graphExportTracks = graphProject.tracks.filter((track) => !isReferenceTrack(track));
  const masterBus = createMasterBus(offlineContext, graphProject.master);
  const sendBuses = createOfflineSendBuses(offlineContext, graphProject.bpm ?? 120);
  for (const bus of sendBuses.values()) {
    bus.output.connect(masterBus.input);
  }
  masterBus.output.connect(offlineContext.destination);

  const soloActive = hasSoloTrack(graphExportTracks);
  const trackInputs = new Map<string, GainNode>();
  const vocalDuckEnvelope = buildVocalActivityEnvelope(graphProject, graphRegistry);
  const vocalDuckWindows = vocalDuckEnvelope.windows;
  if (vocalDuckEnvelope.source !== "audio-analysis" && vocalDuckEnvelope.windows.length > 0) {
    warnings.push(`Vocal Duck used ${vocalDuckEnvelope.source} activity data (${vocalDuckEnvelope.analyzedClipCount} analyzed / ${vocalDuckEnvelope.fallbackClipCount} fallback clips).`);
  }

  for (const track of graphExportTracks) {
    if (!isTrackAudible(track, soloActive)) continue;


    const { input, output } = createOfflineTrackChain(offlineContext, track, graphProject.master, graphProject.bpm ?? 120, vocalDuckWindows);
    output.connect(masterBus.input);
    connectOfflineTrackSends(offlineContext, output, track, sendBuses);
    trackInputs.set(track.id, input);
  }

  for (const clip of graphProject.clips) {
    const trackInput = trackInputs.get(clip.trackId);
    const source = resolveClipSource(clip, graphRegistry);
    const buffer = source ? graphRegistry.getBuffer(source.fileId) : null;
    if (!trackInput || !buffer) continue;

    scheduleClipSource(offlineContext, trackInput, buffer, source.clip, graphProject.bpm ?? 120, graphProject.repairRegions, graphProject.aimixUnmaskState.operations);
  }

  let rendered: AudioBuffer;
  try {
    rendered = await offlineContext.startRendering();
  } finally {
    sourcePreparation?.dispose();
  }

  if (activePeakMax) {
    const peakMaxResult = processPeakMaximizerOffline(rendered, {
      ...activePeakMax.params,
      oversample: peakMaxMemoryPlan?.effectiveOversample ?? requestedPeakMaxOversample ?? peakMaxParams?.oversample,
      memoryBudgetBytes: peakMaxMemoryBudgetBytes,
    });
    warnings.push(...createPeakMaximizerRenderWarnings(peakMaxResult.report));
    const buffer = emergencyTrimPeakMaxBufferIfNeeded(
      peakMaxResult.buffer,
      peakMaxParams?.ceilingDb ?? resolvePeakMaximizerParams(activePeakMax.params).ceilingDb,
      peakMaxResult.report.truePeakEstimateDb,
    );
    return {
      buffer,
      warnings: [...new Set(warnings)],
      ...renderReportBase,
      peakMaximizerReport: peakMaxResult.report,
    };
  }

  // 1. If peak normalize option is explicitly enabled, normalize to a safer -1.0 dBFS ceiling.
  const exportPeakTargetDb = renderProject.master.exportPeakTargetDb ?? -1.0;

  if (renderProject.master.exportNormalizePeak) {
    return { buffer: normalizeAudioBufferPeak(rendered, exportPeakTargetDb), warnings, ...renderReportBase };
  }

  // 2. Otherwise, keep a final peak ceiling. This protects exported masters even when normalize is off.
  let peak = 0;
  for (let channel = 0; channel < rendered.numberOfChannels; channel += 1) {
    const data = rendered.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      peak = Math.max(peak, Math.abs(data[index] ?? 0));
    }
  }

  const finalPeakCeiling = dbToGain(exportPeakTargetDb);
  if (peak > finalPeakCeiling) {
    return { buffer: normalizeAudioBufferPeak(rendered, exportPeakTargetDb), warnings, ...renderReportBase };
  }

  return { buffer: rendered, warnings, ...renderReportBase };
}

export async function renderProjectSliceOffline(
  project: Project,
  registry: AudioBufferRegistry = audioBufferRegistry,
  slice: ProjectSliceRenderRange,
  options: Pick<OfflineRenderOptions, "sampleRate" | "streamSourceFiles"> = {},
): Promise<Float32Array[]> {
  const padded = await renderProjectSliceOfflinePadded(project, registry, slice, options);
  return cropPaddedProjectSliceChannels(padded.channels, padded.cropStartFrame, padded.cropFrameCount);
}

export async function renderProjectSliceOfflinePadded(
  project: Project,
  registry: AudioBufferRegistry = audioBufferRegistry,
  slice: ProjectSliceRenderRange,
  options: Pick<OfflineRenderOptions, "sampleRate" | "streamSourceFiles"> = {},
): Promise<PaddedProjectSliceRender> {
  const sampleRate = options.sampleRate ?? STABLE_EXPORT_SAMPLE_RATE;
  const startSec = Math.max(0, slice.startSec);
  const endSec = Math.max(startSec + 0.001, slice.endSec);
  const renderStartSec = Math.max(0, startSec - Math.max(0, slice.preRollSec));
  const renderEndSec = Math.max(renderStartSec + 0.01, endSec + Math.max(0, slice.postRollSec));
  const sliceProject = createProjectSliceForOfflineRender(project, renderStartSec, renderEndSec);
  const rendered = await renderProjectOffline(sliceProject, registry, {
    sampleRate,
    renderPaddingSec: 0,
    maxDurationSec: renderEndSec - renderStartSec,
    streamSourceFiles: options.streamSourceFiles ?? true,
  });
  return {
    channels: cropRenderedBufferToChannels(rendered, 0, renderEndSec - renderStartSec, sampleRate),
    cropStartFrame: Math.max(0, Math.floor((startSec - renderStartSec) * sampleRate)),
    cropFrameCount: Math.max(1, Math.ceil((endSec - startSec) * sampleRate)),
  };
}

export function cropPaddedProjectSliceChannels(channels: Float32Array[], cropStartFrame: number, cropFrameCount: number) {
  const startFrame = Math.max(0, Math.floor(cropStartFrame));
  const frameCount = Math.max(1, Math.floor(cropFrameCount));
  return channels.map((channel) => {
    const output = new Float32Array(frameCount);
    output.set(channel.subarray(startFrame, startFrame + frameCount));
    return output;
  });
}

export async function renderPreMasterOffline(
  project: Project,
  registry: AudioBufferRegistry = audioBufferRegistry,
  options: OfflineRenderOptions = {},
) {
  const sampleRate = options.sampleRate ?? STABLE_EXPORT_SAMPLE_RATE;
  const exportTracks = project.tracks.filter((track) => !isReferenceTrack(track));
  const exportTrackIds = new Set(exportTracks.map((track) => track.id));
  const fullDurationSec = getClipDurationSec(project.clips.filter((clip) => exportTrackIds.has(clip.trackId))) + (options.renderPaddingSec ?? 0.05);
  const durationSec = Math.max(0.1, options.maxDurationSec ? Math.min(fullDurationSec, options.maxDurationSec) : fullDurationSec);
  const frameCount = Math.ceil(durationSec * sampleRate);
  const OfflineAudioContextCtor = window.OfflineAudioContext ?? window.webkitOfflineAudioContext;

  if (!OfflineAudioContextCtor) {
    throw new Error("This browser does not support OfflineAudioContext.");
  }

  const offlineContext = new OfflineAudioContextCtor(2, frameCount, sampleRate);
  const mixBusTrim = offlineContext.createGain();
  mixBusTrim.gain.value = dbToGain(project.master.mixBusTrimDb ?? 0);
  mixBusTrim.connect(offlineContext.destination);

  const sendBuses = createOfflineSendBuses(offlineContext, project.bpm ?? 120);
  for (const bus of sendBuses.values()) {
    bus.output.connect(mixBusTrim);
  }

  const soloActive = hasSoloTrack(exportTracks);
  const trackInputs = new Map<string, GainNode>();
  const vocalDuckWindows = buildVocalActivityWindows(project, registry);

  for (const track of exportTracks) {
    if (!isTrackAudible(track, soloActive)) continue;
    const { input, output } = createOfflineTrackChain(offlineContext, track, project.master, project.bpm ?? 120, vocalDuckWindows);
    output.connect(mixBusTrim);
    connectOfflineTrackSends(offlineContext, output, track, sendBuses);
    trackInputs.set(track.id, input);
  }

  for (const clip of project.clips) {
    const trackInput = trackInputs.get(clip.trackId);
    const source = resolveClipSource(clip, registry);
    const buffer = source ? registry.getBuffer(source.fileId) : null;
    if (!trackInput || !buffer) continue;
    scheduleClipSource(offlineContext, trackInput, buffer, source.clip, project.bpm ?? 120, project.repairRegions, project.aimixUnmaskState.operations);
  }

  return offlineContext.startRendering();
}

export async function analyzePreMaster(
  project: Project,
  registry: AudioBufferRegistry = audioBufferRegistry,
  options: OfflineRenderOptions = {},
): Promise<LoudnessAnalysis> {
  return analyzeAudioBufferLoudness(await renderPreMasterOffline(project, registry, options), { engineQualityMode: options.engineQualityMode });
}

export async function analyzePostMaster(
  project: Project,
  registry: AudioBufferRegistry = audioBufferRegistry,
  options: OfflineRenderOptions = {},
): Promise<LoudnessAnalysis> {
  const sampleRate = options.sampleRate ?? (project.master.exportSampleRate === 44100 ? 44100 : STABLE_EXPORT_SAMPLE_RATE);
  return analyzeAudioBufferLoudness(await renderProjectOffline(project, registry, { ...options, sampleRate }), { engineQualityMode: options.engineQualityMode });
}

export async function renderTrackOffline(
  project: Project,
  trackId: string,
  registry: AudioBufferRegistry = audioBufferRegistry,
  options: TrackRenderOptions = {},
) {
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new Error("Track was not found.");
  if (isReferenceTrack(track)) throw new Error("Reference tracks are analysis-only and are not rendered.");

  const trackClips = project.clips.filter((clip) => clip.trackId === trackId);
  if (trackClips.length === 0) throw new Error("Track has no clips to render.");

  const sampleRate = options.sampleRate ?? STABLE_EXPORT_SAMPLE_RATE;
  const durationSec = Math.max(0.1, (options.fixedDurationSec ?? getClipDurationSec(trackClips)) + (options.renderPaddingSec ?? 0.1));
  const frameCount = Math.ceil(durationSec * sampleRate);
  const OfflineAudioContextCtor = window.OfflineAudioContext ?? window.webkitOfflineAudioContext;

  if (!OfflineAudioContextCtor) {
    throw new Error("This browser does not support OfflineAudioContext.");
  }

  const offlineContext = new OfflineAudioContextCtor(2, frameCount, sampleRate);
  const { input, output } = createOfflineTrackChain(offlineContext, track, project.master, project.bpm ?? 120, buildVocalActivityWindows(project, registry));

  if (options.includeMasterFx) {
    const masterBus = createMasterBus(offlineContext, project.master);
    output.connect(masterBus.input);
    masterBus.output.connect(offlineContext.destination);
  } else {
    output.connect(offlineContext.destination);
  }

  for (const clip of trackClips) {
    const source = resolveClipSource(clip, registry);
    const buffer = source ? registry.getBuffer(source.fileId) : null;
    if (!buffer) continue;
    scheduleClipSource(offlineContext, input, buffer, source.clip, project.bpm ?? 120, project.repairRegions, project.aimixUnmaskState.operations);
  }

  const rendered = await offlineContext.startRendering();
  return options.normalizePeak ? normalizeAudioBufferPeak(rendered, options.ceilingDb ?? -1) : rendered;
}

export async function renderAmbienceBusOffline(
  project: Project,
  registry: AudioBufferRegistry = audioBufferRegistry,
  options: OfflineRenderOptions = {},
) {
  const sampleRate = options.sampleRate ?? STABLE_EXPORT_SAMPLE_RATE;
  const exportTracks = project.tracks.filter((track) => !isReferenceTrack(track));
  const exportTrackIds = new Set(exportTracks.map((track) => track.id));
  const fullDurationSec = getClipDurationSec(project.clips.filter((clip) => exportTrackIds.has(clip.trackId))) + (options.renderPaddingSec ?? 0.05);
  const durationSec = Math.max(0.1, options.maxDurationSec ? Math.min(fullDurationSec, options.maxDurationSec) : fullDurationSec);
  const frameCount = Math.ceil(durationSec * sampleRate);
  const OfflineAudioContextCtor = window.OfflineAudioContext ?? window.webkitOfflineAudioContext;

  if (!OfflineAudioContextCtor) {
    throw new Error("This browser does not support OfflineAudioContext.");
  }

  const offlineContext = new OfflineAudioContextCtor(2, frameCount, sampleRate);
  const sendBuses = createOfflineSendBuses(offlineContext, project.bpm ?? 120);
  const ambienceBus = sendBuses.get("bus-ambience");
  if (ambienceBus) {
    ambienceBus.output.connect(offlineContext.destination);
  }

  const soloActive = hasSoloTrack(exportTracks);
  const trackInputs = new Map<string, GainNode>();
  const vocalDuckWindows = buildVocalActivityWindows(project, registry);

  for (const track of exportTracks) {
    if (!isTrackAudible(track, soloActive)) continue;
    const { input, output } = createOfflineTrackChain(offlineContext, track, project.master, project.bpm ?? 120, vocalDuckWindows);
    connectOfflineTrackSends(offlineContext, output, track, sendBuses);
    trackInputs.set(track.id, input);
  }

  for (const clip of project.clips) {
    const trackInput = trackInputs.get(clip.trackId);
    const source = resolveClipSource(clip, registry);
    const buffer = source ? registry.getBuffer(source.fileId) : null;
    if (!trackInput || !buffer) continue;
    scheduleClipSource(offlineContext, trackInput, buffer, source.clip, project.bpm ?? 120, project.repairRegions, project.aimixUnmaskState.operations);
  }

  return offlineContext.startRendering();
}

export async function renderClipOffline(
  clip: Clip,
  sourceFile: AudioFileRef,
  registry: AudioBufferRegistry = audioBufferRegistry,
  options: ClipRenderOptions = {},
) {
  const buffer = registry.getBuffer(clip.fileId);
  if (!buffer) throw new Error("Clip source audio is not decoded.");

  const sampleRate = options.sampleRate ?? STABLE_EXPORT_SAMPLE_RATE;
  const durationSec = Math.max(0.05, Math.min(clip.durationSec, Math.max(0, buffer.duration - clip.sourceStartSec)));
  const frameCount = Math.ceil(durationSec * sampleRate);
  const OfflineAudioContextCtor = window.OfflineAudioContext ?? window.webkitOfflineAudioContext;

  if (!OfflineAudioContextCtor) {
    throw new Error("This browser does not support OfflineAudioContext.");
  }

  const offlineContext = new OfflineAudioContextCtor(Math.min(2, Math.max(1, sourceFile.channelCount)), frameCount, sampleRate);
  const renderClip: Clip = {
    ...clip,
    timelineStartSec: 0,
    durationSec,
  };
  scheduleClipSource(offlineContext, offlineContext.destination, buffer, renderClip, 120, options.repairRegions ?? [], options.unmaskOperations ?? []);
  const rendered = await offlineContext.startRendering();
  return options.normalizePeak ? normalizeAudioBufferPeak(rendered, options.ceilingDb ?? -1) : rendered;
}

function createOfflineTrackChain(context: BaseAudioContext, track: Track, master: MasterState, bpm: number, vocalDuckWindows: VocalDuckWindow[] = []) {
  const input = context.createGain();
  const eq = createParametricEQ(context, track.eq);
  const character = createCharacter(context, track.character);
  const compressor = createCompressor(context, track.compressor);
  const insertChain = buildPluginChain(context, track.insertChain, { bpm });
  const vocalDuck = shouldUseVocalDuck(track) ? createDynamicVocalDuckNode(context, track.insertChain) : null;
  const vocalImageLayer = isVocalImageLayerActive(master, track) ? createVocalImageLayer(context, track.vocalImage) : null;
  const gain = context.createGain();
  const pan = "createStereoPanner" in context ? context.createStereoPanner() : null;

  input.connect(eq.input);
  eq.output.connect(character.input);
  character.output.connect(compressor.input);
  compressor.output.connect(insertChain.input);
  insertChain.update(track.insertChain, { bpm });
  vocalDuck?.scheduleDuckWindows(vocalDuckWindows);
  gain.gain.value = dbToGain(track.gainDb);
  if (pan) {
    pan.pan.value = track.pan;
  }
  connectPostInsertPath({
    insertOutput: insertChain.output,
    vocalDuck,
    vocalImageLayer,
    pan,
    gain,
  });

  return {
    input,
    output: gain,
  };
}

function createOfflineSendBuses(context: BaseAudioContext, bpm: number) {
  const buses = new Map<string, { input: GainNode; output: GainNode }>();
  const input = context.createGain();
  const chain = buildPluginChain(context, [createOfflineAmbienceReverbPlugin()], { bpm });
  const output = context.createGain();
  output.gain.value = 0.75;
  input.connect(chain.input);
  chain.output.connect(output);
  buses.set("bus-ambience", { input, output });
  return buses;
}

function connectOfflineTrackSends(
  context: BaseAudioContext,
  source: AudioNode,
  track: Track,
  sendBuses: Map<string, { input: GainNode; output: GainNode }>,
) {
  for (const send of track.sends) {
    const bus = sendBuses.get(send.targetBusId);
    if (!send.enabled || !bus) continue;
    const sendGain = context.createGain();
    sendGain.gain.value = dbToGain(send.gainDb);
    source.connect(sendGain);
    sendGain.connect(bus.input);
  }
}

function createOfflineAmbienceReverbPlugin(): PluginInstance {
  const now = new Date().toISOString();
  return {
    id: "offline-send-bus-ambience-reverb",
    pluginId: "sweet-reverb-lite",
    name: "Ambience Bus",
    enabled: true,
    target: "track",
    params: {
      room: 0.32,
      damp: 0.62,
      preDelayMs: 18,
      lowCutHz: 180,
      highCutHz: 9000,
      width: 0.38,
      mix: 0.16,
    },
    createdAt: now,
    updatedAt: now,
  };
}

function scheduleClipSource(context: BaseAudioContext, destination: AudioNode, buffer: AudioBuffer, clip: Clip, bpm: number, repairRegions: SpectralRepairRegion[] = [], unmaskOperations: SweetUnmaskOperation[] = []) {
  const source = context.createBufferSource();
  const clipGain = context.createGain();
  const clipInsertChain = clip.insertChain.length > 0 ? buildPluginChain(context, clip.insertChain, { bpm }) : null;
  const durationSecForClip = Math.min(clip.durationSec, Math.max(0, buffer.duration - clip.sourceStartSec));
  if (durationSecForClip <= 0) return;

  const repaired = createRepairRenderBuffer(context, buffer, clip, repairRegions, unmaskOperations, durationSecForClip);
  source.buffer = repaired.buffer;
  scheduleClipGain(clipGain.gain, dbToGain(clip.gainDb), clip.timelineStartSec, durationSecForClip, clip.fadeInSec, clip.fadeOutSec);
  source.connect(clipGain);
  const clipPan = createClipPanAutomationNode(context, clip, clip.timelineStartSec, 0, durationSecForClip);
  const clipOutput = clipPan?.output ?? clipGain;
  if (clipPan) {
    clipGain.connect(clipPan.input);
  }
  if (clipInsertChain) {
    clipOutput.connect(clipInsertChain.input);
    clipInsertChain.output.connect(destination);
  } else {
    clipOutput.connect(destination);
  }
  source.start(clip.timelineStartSec, repaired.offsetSec, durationSecForClip);
}
function resolveClipSource(clip: Clip, registry: AudioBufferRegistry) {
  if (clip.isFrozen && clip.frozenRenderFileId && registry.getBuffer(clip.frozenRenderFileId)) {
    return {
      fileId: clip.frozenRenderFileId,
      clip: {
        ...clip,
        fileId: clip.frozenRenderFileId,
        sourceStartSec: clip.sourceStartSec,
        insertChain: [],
      },
    };
  }

  return {
    fileId: clip.fileId,
    clip,
  };
}


function createRepairRenderBuffer(
  context: BaseAudioContext,
  buffer: AudioBuffer,
  clip: Clip,
  repairRegions: SpectralRepairRegion[],
  unmaskOperations: SweetUnmaskOperation[],
  durationSecForClip: number,
) {
  const hasFixedRegion = repairRegions.some(
    (region) =>
      region.enabled &&
      region.fixed &&
      (region.clipId === clip.id || region.fileId === clip.fileId || region.trackId === clip.trackId) &&
      region.operation !== "protect",
  );
  const hasFixedUnmask = unmaskOperations.some(
    (operation) =>
      operation.enabled &&
      operation.fixed &&
      operation.kind === "aimix_unmask" &&
      operation.targetTrackId === clip.trackId &&
      Math.max(operation.startSec, clip.timelineStartSec) < Math.min(operation.endSec, clip.timelineStartSec + durationSecForClip),
  );
  if (!hasFixedRegion && !hasFixedUnmask) return { buffer, offsetSec: clip.sourceStartSec };

  // Keep clip-local repair before unmasking so masking decisions hear the repaired signal.
  const repaired = buildClipRepairAudio(buffer, clip, repairRegions, { fixedOnly: true });
  let processed = repaired.processed;
  let appliedCount = repaired.appliedRegionIds.length;
  if (hasFixedUnmask) {
    const unmasked = applyUnmaskOperationsToChannels(processed, buffer.sampleRate, clip, unmaskOperations, { fixedOnly: true, clipDurationSec: durationSecForClip });
    processed = unmasked.channels;
    appliedCount += unmasked.appliedOperationIds.length;
  }
  if (appliedCount === 0) return { buffer, offsetSec: clip.sourceStartSec };

  const frameCount = Math.max(1, Math.floor(durationSecForClip * buffer.sampleRate));
  const channelCount = Math.max(1, processed.length);
  const processedBuffer = context.createBuffer(channelCount, frameCount, buffer.sampleRate);
  processed.forEach((channel, channelIndex) => {
    processedBuffer.copyToChannel(new Float32Array(channel.subarray(0, frameCount)), channelIndex);
  });
  return { buffer: processedBuffer, offsetSec: 0 };
}
function scheduleClipGain(
  param: AudioParam,
  baseGain: number,
  startSec: number,
  durationSec: number,
  fadeInSec: number,
  fadeOutSec: number,
) {
  // Implement a 2ms micro-fade (de-clicking) to completely prevent audio clicks/pops at boundaries
  const MIN_FADE_SEC = 0.002;
  const effectiveFadeIn = fadeInSec > 0 ? fadeInSec : MIN_FADE_SEC;
  const effectiveFadeOut = fadeOutSec > 0 ? fadeOutSec : MIN_FADE_SEC;

  const fadeIn = Math.min(Math.max(0, effectiveFadeIn), durationSec);
  const fadeOut = Math.min(Math.max(0, effectiveFadeOut), Math.max(0, durationSec - fadeIn));
  const endSec = startSec + durationSec;

  // Web Audio API schedule timeline initialization
  param.setValueAtTime(0, startSec);
  param.linearRampToValueAtTime(baseGain, startSec + fadeIn);

  if (fadeOut > 0) {
    param.setValueAtTime(baseGain, Math.max(startSec, endSec - fadeOut));
    param.linearRampToValueAtTime(0, endSec);
  } else {
    param.setValueAtTime(baseGain, endSec);
  }
}

function getClipDurationSec(clips: Clip[]) {
  return clips.reduce((duration, clip) => Math.max(duration, clip.timelineStartSec + clip.durationSec), 0);
}

function createProjectSliceForOfflineRender(project: Project, renderStartSec: number, renderEndSec: number): Project {
  const durationSec = Math.max(0.001, renderEndSec - renderStartSec);
  const clips = project.clips
    .map((clip) => sliceClipForRender(clip, renderStartSec, renderEndSec))
    .filter((clip): clip is Clip => !!clip);
  return {
    ...project,
    clips,
    repairRegions: project.repairRegions
      .map((region) => {
        if (region.coordinateSpace !== "timeline") return region;
        return {
          ...region,
          startSec: region.startSec - renderStartSec,
          endSec: region.endSec - renderStartSec,
        };
      })
      .filter((region) => region.coordinateSpace !== "timeline" || (region.endSec > 0 && region.startSec < durationSec)),
    aimixUnmaskState: {
      ...project.aimixUnmaskState,
      operations: project.aimixUnmaskState.operations
        .map((operation) => ({
          ...operation,
          startSec: operation.startSec - renderStartSec,
          endSec: operation.endSec - renderStartSec,
        }))
        .filter((operation) => operation.endSec > 0 && operation.startSec < durationSec),
    },
  };
}

function sliceClipForRender(clip: Clip, renderStartSec: number, renderEndSec: number): Clip | null {
  const clipStartSec = clip.timelineStartSec;
  const clipEndSec = clip.timelineStartSec + clip.durationSec;
  const overlapStartSec = Math.max(clipStartSec, renderStartSec);
  const overlapEndSec = Math.min(clipEndSec, renderEndSec);
  if (overlapEndSec <= overlapStartSec) return null;
  const trimmedFromClipSec = overlapStartSec - clipStartSec;
  return {
    ...clip,
    timelineStartSec: overlapStartSec - renderStartSec,
    sourceStartSec: clip.sourceStartSec + trimmedFromClipSec,
    durationSec: overlapEndSec - overlapStartSec,
    fadeInSec: trimmedFromClipSec > 0 ? 0 : clip.fadeInSec,
    fadeOutSec: overlapEndSec < clipEndSec ? 0 : clip.fadeOutSec,
    panAutomation: clip.panAutomation
      ? {
          ...clip.panAutomation,
          anchorPoints: clip.panAutomation.anchorPoints.map((point) => ({
            ...point,
            time: point.time - trimmedFromClipSec,
          })),
        }
      : clip.panAutomation,
  };
}

function cropRenderedBufferToChannels(buffer: AudioBuffer, startSec: number, durationSec: number, sampleRate: number) {
  const startFrame = Math.max(0, Math.floor(startSec * sampleRate));
  const frameCount = Math.max(1, Math.ceil(durationSec * sampleRate));
  return Array.from({ length: 2 }, (_, channelIndex) => {
    const source = buffer.getChannelData(Math.min(channelIndex, buffer.numberOfChannels - 1));
    const output = new Float32Array(frameCount);
    for (let index = 0; index < frameCount; index += 1) {
      output[index] = source[startFrame + index] ?? 0;
    }
    return output;
  });
}

function findLastEnabledPeakMaximizer(chain: PluginInstance[]) {
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const plugin = chain[index];
    if (plugin?.enabled && plugin.pluginId === "sweet-peak-maximizer") return plugin;
  }
  return null;
}

export function createPeakMaximizerRenderWarnings(report: PeakMaximizerReport | null | undefined) {
  if (!report?.memoryExceeded) return [];
  return [
    PEAK_MAXIMIZER_MEMORY_BYPASS_WARNING,
    "PeakMaximizer skipped: final peak trim only. Soft clip, lookahead limiting, and drive lift were not applied.",
  ];
}

export function assertOfflineRenderMemoryWithinBudget(input: OfflineRenderMemoryEstimateInput) {
  const estimate = createOfflineRenderMemoryEstimate(input);
  if (estimate.estimatedBytes > estimate.memoryBudgetBytes) {
    throw new OfflineRenderMemoryPreflightError(estimate);
  }
  return estimate;
}

export function createOfflineRenderMemoryEstimate(input: OfflineRenderMemoryEstimateInput): OfflineRenderMemoryEstimate {
  const frameCount = Math.max(0, Math.round(input.frameCount));
  const channels = Math.max(1, Math.round(input.channels));
  const sampleRate = Math.max(1, Math.round(input.sampleRate));
  return {
    estimatedBytes: estimateOfflineRenderMemoryBytes(input),
    memoryBudgetBytes: resolveOfflineRenderMemoryBudgetBytes(input.memoryBudgetBytes),
    frameCount,
    channels,
    durationSec: frameCount / sampleRate,
  };
}

export function estimateOfflineRenderMemoryBytes(input: OfflineRenderMemoryEstimateInput) {
  const frameCount = Math.max(0, Math.round(input.frameCount));
  const channels = Math.max(1, Math.round(input.channels));
  const floatBytes = 4;
  const renderedPcmBytes = frameCount * channels * floatBytes;
  const offlineGraphScratchBytes = renderedPcmBytes * 3.25;
  const schedulingAndNodeOverheadBytes = 16 * 1024 * 1024;
  const peakMaximizerBytes = input.includePeakMaximizer ? Math.max(0, input.peakMaximizerMemoryBytes ?? 0) : 0;
  return Math.round(renderedPcmBytes + offlineGraphScratchBytes + peakMaximizerBytes + schedulingAndNodeOverheadBytes);
}

export function resolveOfflineRenderMemoryBudgetBytes(explicitBudgetBytes?: number) {
  if (typeof explicitBudgetBytes === "number" && Number.isFinite(explicitBudgetBytes)) {
    return Math.max(16 * 1024 * 1024, explicitBudgetBytes);
  }
  const nav = typeof navigator !== "undefined" ? navigator as Navigator & { deviceMemory?: number } : undefined;
  const deviceMemoryGb = typeof nav?.deviceMemory === "number" && Number.isFinite(nav.deviceMemory) ? nav.deviceMemory : null;
  if (deviceMemoryGb != null) {
    return clampNumber(deviceMemoryGb * 1024 * 1024 * 1024 * 0.18, 192 * 1024 * 1024, 1536 * 1024 * 1024);
  }
  const userAgent = nav?.userAgent ?? "";
  return /iPhone|iPad|iPod|Android|Mobile/i.test(userAgent) ? 256 * 1024 * 1024 : 1024 * 1024 * 1024;
}

function createProjectForOfflineRenderWithoutPeakMax(project: Project): Project {
  return {
    ...project,
    master: {
      ...project.master,
      limiterEnabled: false,
      insertChain: project.master.insertChain.filter((plugin) => plugin.pluginId !== "sweet-peak-maximizer"),
    },
  };
}

function emergencyTrimPeakMaxBufferIfNeeded(buffer: AudioBuffer, ceilingDb: number, truePeakEstimateDb: number) {
  const peak = measureAudioBufferPeak(buffer);
  if (peak <= 1 && (!Number.isFinite(truePeakEstimateDb) || truePeakEstimateDb <= 0)) {
    return buffer;
  }
  return normalizeAudioBufferPeak(buffer, Math.min(ceilingDb, -0.1));
}

function measureAudioBufferPeak(buffer: AudioBuffer) {
  let peak = 0;
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      peak = Math.max(peak, Math.abs(data[index] ?? 0));
    }
  }
  return peak;
}

function normalizeAudioBufferPeak(buffer: AudioBuffer, ceilingDb: number) {
  const peak = measureAudioBufferPeak(buffer);

  if (peak <= 0) return buffer;
  const target = dbToGain(ceilingDb);
  const gain = Math.min(1, target / peak);
  if (gain >= 0.999) return buffer;

  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < data.length; index += 1) {
      data[index] = (data[index] ?? 0) * gain;
    }
  }

  return buffer;
}

function formatMemoryMb(bytes: number) {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

