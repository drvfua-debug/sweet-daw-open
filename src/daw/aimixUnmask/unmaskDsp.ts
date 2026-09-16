import type { Clip } from "@/daw/model/Project";
import { SWEET_MASKING_BANDS } from "./maskingBands";
import type { SweetUnmaskOperation, SweetUnmaskPreviewMode } from "./aimixUnmaskTypes";
import { binToFrequency, createDefaultStftOptions, istftMono, stftMono } from "@/audio/repair/stft";
import { clamp, copyChannels, dbToGain, gainToDb, rmsOfChannels, sanitizeFloat32 } from "@/audio/repair/dspMath";

export type UnmaskPreviewResult = {
  original: Float32Array[];
  processed: Float32Array[];
  removed: Float32Array[];
  preview: Float32Array[];
  appliedOperationIds: string[];
  warnings: string[];
  metrics: {
    originalRmsDb: number;
    processedRmsDb: number;
    rmsDeltaDb: number;
    matchGainDb: number;
  };
};

export type UnmaskProcessOptions = {
  fixedOnly?: boolean;
  previewMode?: SweetUnmaskPreviewMode;
  equalLoudness?: boolean;
  removedPreviewGainDb?: number;
};

export type UnmaskProcessSegment = {
  operationId: string;
  startLocalSec: number;
  endLocalSec: number;
  lowHz: number;
  highHz: number;
  reductionDb: number;
  maxReductionDb: number;
  attackSec: number;
  releaseSec: number;
  protectTransient?: boolean;
  protectVocalConsonant?: boolean;
  protectBassFundamental?: boolean;
};

export function buildClipUnmaskPreview(buffer: AudioBuffer, clip: Clip, operations: SweetUnmaskOperation[], options: UnmaskProcessOptions = {}): UnmaskPreviewResult {
  const result = buildClipUnmaskAudio(buffer, clip, operations, options);
  const previewMode = options.previewMode ?? "unmask";
  const removedGain = dbToGain(clamp(options.removedPreviewGainDb ?? -12, -24, 0));
  const preview = previewMode === "original"
    ? copyChannels(result.original)
    : previewMode === "removed" || previewMode === "delta"
      ? cloneAndScaleChannels(result.removed, removedGain)
      : copyChannels(result.processed);
  const warnings = [...result.warnings];
  if ((previewMode === "removed" || previewMode === "delta") && result.appliedOperationIds.length > 0) warnings.push("Removed-only / Delta preview is attenuated by -12dB for safety.");
  return { ...result, preview, warnings };
}

export function buildClipUnmaskAudio(buffer: AudioBuffer, clip: Clip, operations: SweetUnmaskOperation[], options: Omit<UnmaskProcessOptions, "previewMode" | "removedPreviewGainDb"> = {}): Omit<UnmaskPreviewResult, "preview"> {
  const durationSec = Math.max(0.001, Math.min(clip.durationSec, Math.max(0, buffer.duration - clip.sourceStartSec)));
  const sampleRate = buffer.sampleRate;
  const frameCount = Math.max(1, Math.floor(durationSec * sampleRate));
  const original = copyClipChannels(buffer, clip.sourceStartSec, frameCount);
  const result = applyUnmaskOperationsToChannels(original, sampleRate, clip, operations, { ...options, clipDurationSec: durationSec });
  const processed = result.channels;
  const originalRms = rmsOfChannels(original);
  let processedRms = rmsOfChannels(processed);
  let matchGainDb = 0;
  if (options.equalLoudness && processedRms > 1e-9 && originalRms > 1e-9) {
    matchGainDb = clamp(gainToDb(originalRms / processedRms), -3, 3);
    multiplyChannels(processed, dbToGain(matchGainDb));
    processedRms = rmsOfChannels(processed);
  }
  return {
    original,
    processed,
    removed: subtractChannels(original, processed),
    appliedOperationIds: result.appliedOperationIds,
    warnings: result.warnings,
    metrics: {
      originalRmsDb: round2(gainToDb(originalRms)),
      processedRmsDb: round2(gainToDb(processedRms)),
      rmsDeltaDb: round2(gainToDb(processedRms) - gainToDb(originalRms)),
      matchGainDb: round2(matchGainDb),
    },
  };
}

export function applyUnmaskOperationsToChannels(channels: Float32Array[], sampleRate: number, clip: Clip, operations: SweetUnmaskOperation[], options: { fixedOnly?: boolean; clipDurationSec?: number; equalLoudness?: boolean } = {}) {
  const clipDurationSec = Math.max(0.001, options.clipDurationSec ?? clip.durationSec);
  const segments = getClipUnmaskSegments(clip, operations, { fixedOnly: options.fixedOnly, clipDurationSec });
  if (segments.length === 0) return { channels: copyChannels(channels), appliedOperationIds: [], warnings: [] };
  const warnings: string[] = [];
  const processed = channels.map((channel) => processChannel(channel, sampleRate, segments, warnings));
  return { channels: processed, appliedOperationIds: segments.map((segment) => segment.operationId), warnings: Array.from(new Set(warnings)).slice(0, 12) };
}

export function getClipUnmaskSegments(clip: Clip, operations: SweetUnmaskOperation[], options: { fixedOnly?: boolean; clipDurationSec?: number } = {}): UnmaskProcessSegment[] {
  const clipDurationSec = Math.max(0, options.clipDurationSec ?? clip.durationSec);
  return operations
    .filter((operation) => operation.enabled)
    .filter((operation) => !options.fixedOnly || operation.fixed)
    .filter((operation) => operation.kind === "aimix_unmask" && operation.targetTrackId === clip.trackId)
    .map((operation) => operationToSegment(operation, clip, clipDurationSec))
    .filter((segment): segment is UnmaskProcessSegment => !!segment)
    .sort((a, b) => a.startLocalSec - b.startLocalSec || a.operationId.localeCompare(b.operationId));
}

function operationToSegment(operation: SweetUnmaskOperation, clip: Clip, clipDurationSec: number): UnmaskProcessSegment | null {
  const band = SWEET_MASKING_BANDS[operation.bandId];
  if (!band) return null;
  const startLocalSec = Math.max(0, operation.startSec - clip.timelineStartSec);
  const endLocalSec = Math.min(clipDurationSec, operation.endSec - clip.timelineStartSec);
  if (!Number.isFinite(startLocalSec) || !Number.isFinite(endLocalSec) || endLocalSec <= startLocalSec) return null;
  const maxReductionDb = clamp(Math.abs(operation.maxReductionDb || Math.abs(band.hardMaxReductionDb)), 0.1, Math.abs(band.hardMaxReductionDb));
  const reductionDb = clamp(Math.min(0, operation.reductionDb), -maxReductionDb, 0);
  return {
    operationId: operation.id,
    startLocalSec,
    endLocalSec,
    lowHz: band.minHz,
    highHz: band.maxHz,
    reductionDb,
    maxReductionDb,
    attackSec: clamp(operation.attackMs / 1000, 0.002, 0.12),
    releaseSec: clamp(operation.releaseMs / 1000, 0.03, 0.5),
    protectTransient: operation.protectTransient,
    protectVocalConsonant: operation.protectVocalConsonant,
    protectBassFundamental: operation.protectBassFundamental,
  };
}

function processChannel(channel: Float32Array, sampleRate: number, segments: UnmaskProcessSegment[], warnings: string[]) {
  if (channel.length < 128) return new Float32Array(channel);
  const fftSize = channel.length < 4096 ? 1024 : 2048;
  const options = createDefaultStftOptions(sampleRate, fftSize);
  const frames = stftMono(channel, options);
  const half = Math.floor(options.fftSize / 2);
  let editedFrameCount = 0;
  for (let frameIndex = 0; frameIndex < frames.length; frameIndex += 1) {
    const frame = frames[frameIndex];
    if (!frame) continue;
    const activeSegments = segments.filter((segment) => envelopeAt(frame.timeSec, segment) > 0);
    if (activeSegments.length === 0) continue;
    editedFrameCount += 1;
    for (let bin = 1; bin < options.fftSize; bin += 1) {
      const frequency = bin <= half ? binToFrequency(bin, sampleRate, options.fftSize) : binToFrequency(options.fftSize - bin, sampleRate, options.fftSize);
      const gainDb = activeSegments.reduce((current, segment) => {
        if (frequency < segment.lowHz || frequency > segment.highHz) return current;
        let strength = envelopeAt(frame.timeSec, segment);
        if (segment.protectTransient && isLikelyTransient(frame.magnitude, bin)) strength *= 0.68;
        if (segment.protectVocalConsonant && frequency > 5000) strength *= 0.72;
        if (segment.protectBassFundamental && frequency < 95) strength *= 0.55;
        return Math.min(current, segment.reductionDb * strength);
      }, 0);
      if (gainDb >= -0.01) continue;
      const gain = dbToGain(gainDb);
      frame.real[bin] = sanitizeFloat32((frame.real[bin] ?? 0) * gain);
      frame.imag[bin] = sanitizeFloat32((frame.imag[bin] ?? 0) * gain);
      frame.magnitude[bin] = sanitizeFloat32((frame.magnitude[bin] ?? 0) * gain);
    }
  }
  if (editedFrameCount === 0) warnings.push("No Unmask frame was active inside this clip range.");
  return istftMono(frames, options, channel.length);
}

function envelopeAt(timeSec: number, segment: UnmaskProcessSegment) {
  const start = segment.startLocalSec;
  const end = segment.endLocalSec;
  const attack = Math.max(0.002, segment.attackSec);
  const release = Math.max(0.02, segment.releaseSec);
  if (timeSec < start - attack || timeSec > end + release) return 0;
  if (timeSec < start) return clamp((timeSec - (start - attack)) / attack, 0, 1);
  if (timeSec <= end) return 1;
  return clamp(1 - (timeSec - end) / release, 0, 1);
}

function isLikelyTransient(magnitude: Float32Array, bin: number) {
  const center = magnitude[bin] ?? 0;
  const near = ((magnitude[bin - 1] ?? center) + (magnitude[bin + 1] ?? center)) * 0.5;
  return center > near * 2.2 && center > 0.02;
}

function copyClipChannels(buffer: AudioBuffer, sourceStartSec: number, frameCount: number) {
  const startFrame = Math.max(0, Math.floor(sourceStartSec * buffer.sampleRate));
  const channelCount = Math.max(1, buffer.numberOfChannels);
  return Array.from({ length: channelCount }, (_, channelIndex) => {
    const source = buffer.getChannelData(channelIndex);
    const output = new Float32Array(frameCount);
    for (let index = 0; index < frameCount; index += 1) output[index] = sanitizeFloat32(source[startFrame + index] ?? 0);
    return output;
  });
}

function subtractChannels(original: Float32Array[], processed: Float32Array[]) {
  return original.map((channel, channelIndex) => {
    const other = processed[channelIndex] ?? channel;
    const output = new Float32Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) output[index] = sanitizeFloat32((channel[index] ?? 0) - (other[index] ?? 0));
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
    for (let index = 0; index < channel.length; index += 1) channel[index] = sanitizeFloat32((channel[index] ?? 0) * safeGain);
  }
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}