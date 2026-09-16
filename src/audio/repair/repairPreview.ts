import type { Clip } from "@/daw/model/Project";
import type { RepairPreviewMode, SpectralRepairRegion } from "@/daw/repair/repairTypes";
import { applyRepairOperationsToChannels, type RepairProcessSegment } from "./repairProcessors";
import { clamp, copyChannels, dbToGain, gainToDb, rmsOfChannels, sanitizeFloat32 } from "./dspMath";

export type RepairPreviewResult = {
  original: Float32Array[];
  processed: Float32Array[];
  removed: Float32Array[];
  preview: Float32Array[];
  appliedRegionIds: string[];
  warnings: string[];
  metrics: {
    originalRmsDb: number;
    processedRmsDb: number;
    rmsDeltaDb: number;
    matchGainDb: number;
  };
};

export type RepairPreviewOptions = {
  previewMode?: RepairPreviewMode;
  matchLoudness?: boolean;
  fixedOnly?: boolean;
  removedPreviewGainDb?: number;
};

export type RepairGainSegment = RepairProcessSegment & {
  startSec: number;
  endSec: number;
  gain: number;
};

export function buildClipRepairPreview(
  buffer: AudioBuffer,
  clip: Clip,
  regions: SpectralRepairRegion[],
  options: RepairPreviewOptions = {},
): RepairPreviewResult {
  const result = buildClipRepairAudio(buffer, clip, regions, options);
  const previewMode = options.previewMode ?? "processed";
  const removedGain = dbToGain(clamp(options.removedPreviewGainDb ?? -12, -24, 0));
  const preview =
    previewMode === "original"
      ? copyChannels(result.original)
      : previewMode === "removed_only" || previewMode === "delta"
        ? cloneAndScaleChannels(result.removed, removedGain)
        : copyChannels(result.processed);

  const warnings = [...result.warnings];
  if ((previewMode === "removed_only" || previewMode === "delta") && result.appliedRegionIds.length > 0) {
    warnings.push("Removed-only/Delta preview is attenuated by -12dB for safety.");
  }

  return { ...result, preview, warnings };
}

export function buildClipRepairAudio(
  buffer: AudioBuffer,
  clip: Clip,
  regions: SpectralRepairRegion[],
  options: Omit<RepairPreviewOptions, "previewMode" | "removedPreviewGainDb"> = {},
): Omit<RepairPreviewResult, "preview"> {
  const durationSec = Math.max(0.001, Math.min(clip.durationSec, Math.max(0, buffer.duration - clip.sourceStartSec)));
  const sampleRate = buffer.sampleRate;
  const frameCount = Math.max(1, Math.floor(durationSec * sampleRate));
  const original = copyClipChannels(buffer, clip.sourceStartSec, frameCount);
  const segments = getClipRepairSegments(clip, regions, { fixedOnly: options.fixedOnly, clipDurationSec: durationSec });
  const processedResult = applyRepairOperationsToChannels(original, sampleRate, segments);
  const processed = processedResult.channels;
  const warnings = [...processedResult.warnings];

  const originalRms = rmsOfChannels(original);
  let processedRms = rmsOfChannels(processed);
  let matchGainDb = 0;
  if (options.matchLoudness && processedRms > 1e-9 && originalRms > 1e-9) {
    matchGainDb = clamp(gainToDb(originalRms / processedRms), -6, 6);
    multiplyChannels(processed, dbToGain(matchGainDb));
    processedRms = rmsOfChannels(processed);
  }

  const removed = subtractChannels(original, processed);
  return {
    original,
    processed,
    removed,
    appliedRegionIds: processedResult.appliedRegionIds,
    warnings,
    metrics: {
      originalRmsDb: round2(gainToDb(originalRms)),
      processedRmsDb: round2(gainToDb(processedRms)),
      rmsDeltaDb: round2(gainToDb(processedRms) - gainToDb(originalRms)),
      matchGainDb: round2(matchGainDb),
    },
  };
}

export function getClipRepairSegments(
  clip: Clip,
  regions: SpectralRepairRegion[],
  options: { fixedOnly?: boolean; clipDurationSec?: number } = {},
): RepairGainSegment[] {
  const clipDurationSec = Math.max(0, options.clipDurationSec ?? clip.durationSec);
  return regions
    .filter((region) => region.enabled)
    .filter((region) => !options.fixedOnly || region.fixed)
    .filter((region) => region.clipId === clip.id || region.fileId === clip.fileId || region.trackId === clip.trackId)
    .map((region) => regionToSegment(region, clip, clipDurationSec))
    .filter((segment): segment is RepairGainSegment => !!segment)
    .sort((a, b) => a.startLocalSec - b.startLocalSec || a.regionId.localeCompare(b.regionId));
}

export function applyRepairSegmentsToChannels(
  channels: Float32Array[],
  sampleRate: number,
  clip: Clip,
  regions: SpectralRepairRegion[],
  options: { fixedOnly?: boolean; clipDurationSec?: number } = {},
) {
  const segments = getClipRepairSegments(clip, regions, options).filter((segment) => segment.operation !== "protect");
  const result = applyRepairOperationsToChannels(channels, sampleRate, segments);
  channels.splice(0, channels.length, ...result.channels);
  return result.appliedRegionIds;
}

function regionToSegment(region: SpectralRepairRegion, clip: Clip, clipDurationSec: number): RepairGainSegment | null {
  const baseSec = region.coordinateSpace === "source" ? clip.sourceStartSec : clip.timelineStartSec;
  const startLocalSec = Math.max(0, region.startSec - baseSec);
  const endLocalSec = Math.min(clipDurationSec, region.endSec - baseSec);
  if (!Number.isFinite(startLocalSec) || !Number.isFinite(endLocalSec) || endLocalSec <= startLocalSec) return null;

  const amountDb = clamp(Math.min(0, region.amountDb), -24, 0);
  const strength = clamp(region.strength, 0, 1);
  const targetGain = dbToGain(amountDb);
  const gain = clamp(1 + (targetGain - 1) * strength, 0, 1);
  return {
    regionId: region.id,
    startSec: clip.timelineStartSec + startLocalSec,
    endSec: clip.timelineStartSec + endLocalSec,
    startLocalSec,
    endLocalSec,
    gain,
    featherTimeSec: clamp(region.featherTimeMs / 1000, 0, 2),
    operation: region.operation,
    lowHz: region.lowHz,
    highHz: region.highHz,
    amountDb,
    strength,
    protectVocal: region.protectVocal,
    protectDrumAttack: region.protectDrumAttack,
  };
}

function copyClipChannels(buffer: AudioBuffer, sourceStartSec: number, frameCount: number) {
  const startFrame = Math.max(0, Math.floor(sourceStartSec * buffer.sampleRate));
  const channelCount = Math.max(1, buffer.numberOfChannels);
  return Array.from({ length: channelCount }, (_, channelIndex) => {
    const source = buffer.getChannelData(channelIndex);
    const output = new Float32Array(frameCount);
    for (let index = 0; index < frameCount; index += 1) {
      output[index] = sanitizeFloat32(source[startFrame + index] ?? 0);
    }
    return output;
  });
}

function subtractChannels(original: Float32Array[], processed: Float32Array[]) {
  return original.map((channel, channelIndex) => {
    const other = processed[channelIndex] ?? channel;
    const output = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) {
      output[index] = sanitizeFloat32((channel[index] ?? 0) - (other[index] ?? 0));
    }
    return output;
  });
}

function cloneAndScaleChannels(channels: Float32Array[], gain: number) {
  const next = copyChannels(channels);
  multiplyChannels(next, gain);
  return next;
}

function multiplyChannels(channels: Float32Array[], gain: number) {
  const safeGain = clamp(gain, 0, 4);
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      channel[index] = sanitizeFloat32((channel[index] ?? 0) * safeGain);
    }
  }
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
