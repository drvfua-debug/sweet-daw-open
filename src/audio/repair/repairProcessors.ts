import type { RepairOperation } from "@/daw/repair/repairTypes";
import { applyEqualPowerFade, clamp, copyChannels, dbToGain, sanitizeFloat32, secondsToSample } from "./dspMath";
import { binToFrequency, createDefaultStftOptions, istftMono, stftMono } from "./stft";

export type RepairProcessSegment = {
  regionId: string;
  operation: RepairOperation;
  startLocalSec: number;
  endLocalSec: number;
  lowHz: number;
  highHz: number;
  amountDb: number;
  strength: number;
  featherTimeSec: number;
  protectVocal?: boolean;
  protectDrumAttack?: boolean;
};

export type RepairProcessResult = {
  channels: Float32Array[];
  appliedRegionIds: string[];
  warnings: string[];
};

export function applyRepairOperationsToChannels(
  inputChannels: Float32Array[],
  sampleRate: number,
  segments: RepairProcessSegment[],
): RepairProcessResult {
  const channels = copyChannels(inputChannels);
  const appliedRegionIds: string[] = [];
  const warnings: string[] = [];

  for (const segment of segments) {
    const operation = normalizeRepairOperation(segment.operation, segment.lowHz, segment.highHz);
    if (operation === "protect") {
      warnings.push(`Region ${segment.regionId}: protect is metadata-only.`);
      continue;
    }

    const before = snapshotForChangeCheck(channels);
    try {
      if (operation === "attenuate") applyAttenuate(channels, sampleRate, segment);
      else if (operation === "declick_lite") applyDeclickLite(channels, sampleRate, segment, warnings);
      else if (operation === "decrackle_lite") {
        applyDeclickLite(channels, sampleRate, { ...segment, strength: segment.strength * 0.45 }, warnings);
        applySpectralBandReduction(channels, sampleRate, segment, "decrackle_lite", warnings);
      } else if (operation === "deess_lite" || operation === "deharsh_lite" || operation === "dechirp_lite") {
        applySpectralBandReduction(channels, sampleRate, segment, operation, warnings);
      } else if (operation === "lowend_tighten_lite") {
        applyLowEndTightenLite(channels, sampleRate, segment, warnings);
      } else {
        applyAttenuate(channels, sampleRate, segment);
        warnings.push(`Region ${segment.regionId}: unknown operation fell back to attenuation.`);
      }
    } catch (error) {
      restoreSnapshot(channels, before);
      warnings.push(`Region ${segment.regionId}: repair failed and was bypassed (${error instanceof Error ? error.message : String(error)}).`);
      continue;
    }

    appliedRegionIds.push(segment.regionId);
  }

  sanitizeChannels(channels);
  return { channels, appliedRegionIds, warnings };
}

export function normalizeRepairOperation(operation: RepairOperation, lowHz = 20, highHz = 20000): RepairOperation {
  if (operation === "declick") return "declick_lite";
  if (operation === "deess") return "deess_lite";
  if (operation === "smooth") return highHz >= 7000 ? "dechirp_lite" : "deharsh_lite";
  return operation;
}

function applyAttenuate(channels: Float32Array[], sampleRate: number, segment: RepairProcessSegment) {
  const start = secondsToSample(segment.startLocalSec, sampleRate, channels[0]?.length ?? 0);
  const end = secondsToSample(segment.endLocalSec, sampleRate, channels[0]?.length ?? 0);
  if (end <= start) return;
  const targetGain = dbToGain(Math.min(0, clamp(segment.amountDb, -24, 0)));
  const strength = clamp(segment.strength, 0, 1);
  const feather = Math.min(Math.floor(clamp(segment.featherTimeSec, 0, 1) * sampleRate), Math.floor((end - start) * 0.45));
  for (const channel of channels) {
    for (let index = start; index < end && index < channel.length; index += 1) {
      const fadeIn = feather > 0 ? applyEqualPowerFade(clamp((index - start) / feather, 0, 1)) : 1;
      const fadeOut = feather > 0 ? applyEqualPowerFade(clamp((end - index) / feather, 0, 1)) : 1;
      const blend = Math.min(fadeIn, fadeOut);
      const gain = 1 + (targetGain - 1) * strength * blend;
      channel[index] = sanitizeFloat32((channel[index] ?? 0) * gain);
    }
  }
}

function applyDeclickLite(channels: Float32Array[], sampleRate: number, segment: RepairProcessSegment, warnings: string[]) {
  const length = Math.max(0, ...channels.map((channel) => channel.length));
  const start = secondsToSample(segment.startLocalSec, sampleRate, length);
  const end = secondsToSample(segment.endLocalSec, sampleRate, length);
  if (end - start < 3) return;
  const maxEvents = Math.max(4, Math.floor(((end - start) / sampleRate) * 80));
  const events: number[] = [];
  const rms = localRmsAcrossChannels(channels, start, end);
  const threshold = Math.max(0.18, rms * 7.5, Math.abs(segment.amountDb) * 0.025);

  for (let index = Math.max(start + 1, 1); index < Math.min(end - 1, length - 1); index += 1) {
    const event = clickEventScoreAt(channels, index);
    if (event.diff > threshold && event.peak > rms * 2.5) {
      events.push(index);
      index += Math.max(1, Math.floor(sampleRate * 0.002));
      if (events.length >= maxEvents) {
        warnings.push(`Region ${segment.regionId}: declick event limit reached.`);
        break;
      }
    }
  }

  const radius = Math.max(1, Math.floor(sampleRate * clamp(0.0005 + segment.strength * 0.0025, 0.0005, 0.003)));
  for (const center of events) {
    const left = Math.max(start, center - radius);
    const right = Math.min(end - 1, center + radius);
    for (const channel of channels) {
      const leftValue = channel[left] ?? 0;
      const rightValue = channel[right] ?? leftValue;
      for (let index = left; index <= right && index < channel.length; index += 1) {
        const t = (index - left) / Math.max(1, right - left);
        const interpolated = leftValue + (rightValue - leftValue) * t;
        channel[index] = sanitizeFloat32((channel[index] ?? 0) * (1 - segment.strength) + interpolated * segment.strength);
      }
    }
  }
}

function applySpectralBandReduction(
  channels: Float32Array[],
  sampleRate: number,
  segment: RepairProcessSegment,
  mode: "decrackle_lite" | "deess_lite" | "deharsh_lite" | "dechirp_lite",
  warnings: string[],
) {
  const length = channels[0]?.length ?? 0;
  const start = secondsToSample(segment.startLocalSec, sampleRate, length);
  const end = secondsToSample(segment.endLocalSec, sampleRate, length);
  const regionLength = end - start;
  if (regionLength < 128) {
    warnings.push(`Region ${segment.regionId}: region too short for STFT, used attenuation fallback.`);
    applyAttenuate(channels, sampleRate, { ...segment, amountDb: Math.max(-3, segment.amountDb), strength: segment.strength * 0.4 });
    return;
  }
  if (regionLength / sampleRate > 30) warnings.push(`Region ${segment.regionId}: long spectral preview region; consider splitting.`);

  const fftSize = regionLength < 4096 ? 1024 : 2048;
  const options = createDefaultStftOptions(sampleRate, fftSize);
  const lowHz = Math.max(20, segment.lowHz || defaultBandForMode(mode).lowHz);
  const highHz = Math.min(sampleRate * 0.46, segment.highHz || defaultBandForMode(mode).highHz);
  const amountDb = clamp(segment.amountDb, mode === "deess_lite" ? -12 : -8, 0);
  const baseDepth = 1 - dbToGain(amountDb * clamp(segment.strength, 0, 1));
  if (baseDepth <= 1e-6) return;

  for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
    const channel = channels[channelIndex];
    if (!channel) continue;
    const slice = channel.slice(start, end);
    const frames = stftMono(slice, options);
    for (const frame of frames) {
      const half = Math.floor(options.fftSize / 2);
      let fullAvg = 0;
      let bandAvg = 0;
      let bandCount = 0;
      for (let bin = 1; bin < half; bin += 1) {
        const mag = frame.magnitude[bin] ?? 0;
        fullAvg += mag;
        const hz = binToFrequency(bin, sampleRate, options.fftSize);
        if (hz >= lowHz && hz <= highHz) {
          bandAvg += mag;
          bandCount += 1;
        }
      }
      fullAvg /= Math.max(1, half - 1);
      bandAvg /= Math.max(1, bandCount);
      for (let bin = 1; bin < half; bin += 1) {
        const hz = binToFrequency(bin, sampleRate, options.fftSize);
        if (hz < lowHz || hz > highHz) continue;
        const mag = frame.magnitude[bin] ?? 0;
        const peakRatio = mag / Math.max(1e-8, bandAvg);
        const fullRatio = mag / Math.max(1e-8, fullAvg);
        const weight = spectralWeight(mode, peakRatio, fullRatio, hz, lowHz, highHz, segment);
        if (weight <= 0) continue;
        const scale = clamp(1 - baseDepth * weight, 0.18, 1);
        scaleBin(frame.real, frame.imag, bin, scale);
      }
    }
    const rebuilt = istftMono(frames, options, slice.length);
    copyWithBoundaryFade(channel, rebuilt, start, end, Math.min(Math.floor(sampleRate * 0.006), Math.floor(regionLength * 0.1)));
  }
}

function applyLowEndTightenLite(channels: Float32Array[], sampleRate: number, segment: RepairProcessSegment, warnings: string[]) {
  const length = channels[0]?.length ?? 0;
  const start = secondsToSample(segment.startLocalSec, sampleRate, length);
  const end = secondsToSample(segment.endLocalSec, sampleRate, length);
  if (end <= start) return;
  const reduction = clamp(segment.strength, 0, 1) * (1 - dbToGain(clamp(segment.amountDb, -8, 0)));
  if (channels.length < 2) {
    applyAttenuate(channels, sampleRate, { ...segment, amountDb: Math.max(-2.5, segment.amountDb), strength: segment.strength * 0.25 });
    warnings.push(`Region ${segment.regionId}: mono low-end tighten used a very light fallback attenuation.`);
    return;
  }

  const left = channels[0];
  const right = channels[1];
  const alpha = onePoleLowpassAlpha(120, sampleRate);
  let sideLow = 0;
  for (let index = start; index < end && index < left.length && index < right.length; index += 1) {
    const mid = ((left[index] ?? 0) + (right[index] ?? 0)) * 0.5;
    const side = ((left[index] ?? 0) - (right[index] ?? 0)) * 0.5;
    sideLow += alpha * (side - sideLow);
    const tightenedSide = side - sideLow * reduction;
    left[index] = sanitizeFloat32(mid + tightenedSide);
    right[index] = sanitizeFloat32(mid - tightenedSide);
  }
}

function spectralWeight(
  mode: "decrackle_lite" | "deess_lite" | "deharsh_lite" | "dechirp_lite",
  peakRatio: number,
  fullRatio: number,
  hz: number,
  lowHz: number,
  highHz: number,
  segment: RepairProcessSegment,
) {
  const centerWeight = Math.sin(clamp((hz - lowHz) / Math.max(1, highHz - lowHz), 0, 1) * Math.PI);
  if (mode === "deharsh_lite") {
    const vocalPresenceProtect = segment.protectVocal && hz >= 2000 && hz <= 4500 ? 0.65 : 1;
    return clamp((peakRatio - 1.05) * 0.5 + (fullRatio - 1.65) * 0.12, 0, 0.9) * centerWeight * vocalPresenceProtect;
  }
  if (mode === "dechirp_lite") {
    const vocalProtect = segment.protectVocal && hz < 8500 ? 0.72 : 1;
    return clamp((peakRatio - 0.95) * 0.55 + (fullRatio - 1.8) * 0.08, 0, 1) * centerWeight * vocalProtect;
  }
  if (mode === "deess_lite") return clamp((peakRatio - 0.75) * 0.35 + (fullRatio - 1.25) * 0.12, 0, 0.75) * centerWeight;
  return clamp((peakRatio - 1.1) * 0.2, 0, 0.42) * centerWeight;
}

function defaultBandForMode(mode: "decrackle_lite" | "deess_lite" | "deharsh_lite" | "dechirp_lite") {
  if (mode === "deess_lite") return { lowHz: 4500, highHz: 10000 };
  if (mode === "deharsh_lite") return { lowHz: 2000, highHz: 7000 };
  if (mode === "dechirp_lite") return { lowHz: 6000, highHz: 14000 };
  return { lowHz: 3000, highHz: 14000 };
}

function scaleBin(real: Float32Array, imag: Float32Array, bin: number, scale: number) {
  const mirror = real.length - bin;
  real[bin] = sanitizeFloat32((real[bin] ?? 0) * scale);
  imag[bin] = sanitizeFloat32((imag[bin] ?? 0) * scale);
  if (mirror > 0 && mirror < real.length) {
    real[mirror] = sanitizeFloat32((real[mirror] ?? 0) * scale);
    imag[mirror] = sanitizeFloat32((imag[mirror] ?? 0) * scale);
  }
}

function copyWithBoundaryFade(target: Float32Array, source: Float32Array, start: number, end: number, fadeFrames: number) {
  const safeEnd = Math.min(end, target.length, start + source.length);
  for (let index = start; index < safeEnd; index += 1) {
    const local = index - start;
    const fadeIn = fadeFrames > 0 ? applyEqualPowerFade(clamp(local / fadeFrames, 0, 1)) : 1;
    const fadeOut = fadeFrames > 0 ? applyEqualPowerFade(clamp((safeEnd - index) / fadeFrames, 0, 1)) : 1;
    const blend = Math.min(fadeIn, fadeOut);
    target[index] = sanitizeFloat32((target[index] ?? 0) * (1 - blend) + (source[local] ?? 0) * blend);
  }
}

function localRmsAcrossChannels(channels: Float32Array[], start: number, end: number) {
  let sum = 0;
  let count = 0;
  for (const channel of channels) {
    for (let index = start; index < end && index < channel.length; index += 1) {
      const sample = channel[index] ?? 0;
      sum += sample * sample;
      count += 1;
    }
  }
  return Math.sqrt(sum / Math.max(1, count));
}

function clickEventScoreAt(channels: Float32Array[], index: number) {
  let diff = 0;
  let peak = 0;
  for (const channel of channels) {
    if (index <= 0 || index >= channel.length - 1) continue;
    const prev = channel[index - 1] ?? 0;
    const current = channel[index] ?? 0;
    const next = channel[index + 1] ?? 0;
    diff = Math.max(diff, Math.abs(current - prev) + Math.abs(current - next));
    peak = Math.max(peak, Math.abs(current));
  }
  return { diff, peak };
}

function onePoleLowpassAlpha(frequency: number, sampleRate: number) {
  const dt = 1 / Math.max(1, sampleRate);
  const rc = 1 / (2 * Math.PI * Math.max(1, frequency));
  return dt / (rc + dt);
}

function sanitizeChannels(channels: Float32Array[]) {
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) channel[index] = sanitizeFloat32(channel[index] ?? 0);
  }
}

function snapshotForChangeCheck(channels: Float32Array[]) {
  return channels.map((channel) => new Float32Array(channel));
}

function restoreSnapshot(channels: Float32Array[], snapshot: Float32Array[]) {
  for (let channelIndex = 0; channelIndex < channels.length; channelIndex += 1) {
    channels[channelIndex]?.set(snapshot[channelIndex] ?? new Float32Array());
  }
}
