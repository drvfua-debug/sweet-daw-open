import { analyzeFloat32ChannelsLoudness, estimateTruePeakDbtpFromChannels } from "@/audio/analysis/LoudnessAnalyzer";

export type PeakMaximizerMode = "clean" | "punch" | "loud" | "streaming" | "dense";
export type PeakMaximizerOversample = "off" | "2x" | "4x";

export type PeakMaximizerParams = {
  preset: string;
  mode: PeakMaximizerMode;
  inputDriveDb: number;
  ceilingDb: number;
  lookaheadMs: number;
  releaseMs: number;
  transientProtect: number;
  stereoLink: number;
  softClipGuard: number;
  truePeakGuard: boolean;
  oversample: PeakMaximizerOversample;
  autoDrive: boolean;
  targetLufs: number;
  maxAutoDriveDb: number;
};

export type PeakMaximizerReport = {
  inputPeakDb: number;
  outputPeakDb: number;
  truePeakEstimateDb: number;
  maxGainReductionDb: number;
  avgGainReductionDb: number;
  appliedDriveDb: number;
  truePeakTrimDb: number;
  limitedSamples: number;
  effectiveOversample: PeakMaximizerOversample;
  memoryBudgetBytes: number;
  estimatedMemoryBytes: number;
  memoryFallbackApplied: boolean;
  memoryExceeded: boolean;
};

export type PeakMaximizerResult = {
  buffer: AudioBuffer;
  report: PeakMaximizerReport;
};

export const DEFAULT_PEAK_MAXIMIZER_PARAMS: PeakMaximizerParams = {
  preset: "Clean Lift",
  mode: "clean",
  inputDriveDb: 2,
  ceilingDb: -1,
  lookaheadMs: 2,
  releaseMs: 90,
  transientProtect: 0.65,
  stereoLink: 1,
  softClipGuard: 0.18,
  truePeakGuard: true,
  oversample: "4x",
  autoDrive: false,
  targetLufs: -10,
  maxAutoDriveDb: 6,
};

export type PeakMaximizerParamInput = Record<string, unknown> | Partial<PeakMaximizerParams>;

export type PeakMaximizerMemoryPlan = {
  requestedOversample: PeakMaximizerOversample;
  effectiveOversample: PeakMaximizerOversample;
  estimatedMemoryBytes: number;
  memoryBudgetBytes: number;
  memoryFallbackApplied: boolean;
  memoryExceeded: boolean;
};

export function resolvePeakMaximizerParams(params: PeakMaximizerParamInput = {}): PeakMaximizerParams {
  const mode = readMode(params.mode, DEFAULT_PEAK_MAXIMIZER_PARAMS.mode);
  const modeDefaults = getModeDefaults(mode);
  return {
    preset: readString(params.preset, modeDefaults.preset),
    mode,
    inputDriveDb: clamp(readNumber(params.inputDriveDb, modeDefaults.inputDriveDb), -3, 9),
    ceilingDb: clamp(readNumber(params.ceilingDb, modeDefaults.ceilingDb), -3, -0.3),
    lookaheadMs: clamp(readNumber(params.lookaheadMs, modeDefaults.lookaheadMs), 0.5, 5),
    releaseMs: clamp(readNumber(params.releaseMs, modeDefaults.releaseMs), 30, 300),
    transientProtect: clamp01(readNumber(params.transientProtect, modeDefaults.transientProtect)),
    stereoLink: clamp01(readNumber(params.stereoLink, modeDefaults.stereoLink)),
    softClipGuard: clamp(readNumber(params.softClipGuard, modeDefaults.softClipGuard), 0, 0.5),
    truePeakGuard: readBoolean(params.truePeakGuard, modeDefaults.truePeakGuard),
    oversample: readOversample(params.oversample, modeDefaults.oversample),
    autoDrive: readBoolean(params.autoDrive, modeDefaults.autoDrive),
    targetLufs: clamp(readNumber(params.targetLufs, modeDefaults.targetLufs), -16, -7),
    maxAutoDriveDb: clamp(readNumber(params.maxAutoDriveDb, modeDefaults.maxAutoDriveDb), 0, 9),
  };
}

export function processPeakMaximizerOffline(buffer: AudioBuffer, params: PeakMaximizerParamInput = {}): PeakMaximizerResult {
  const resolved = resolvePeakMaximizerParams(params);
  const channelCount = Math.max(1, buffer.numberOfChannels || 1);
  const length = Math.max(0, buffer.length || 0);
  const sampleRate = Math.max(1, buffer.sampleRate || 48000);
  const memoryPlan = resolvePeakMaximizerMemoryPlan(length, channelCount, resolved.oversample, params);
  if (memoryPlan.memoryExceeded) {
    const inputPeak = measureAudioBufferPeak(buffer, channelCount, length);
    return {
      buffer,
      report: {
        inputPeakDb: round2(gainToDb(inputPeak)),
        outputPeakDb: round2(gainToDb(inputPeak)),
        truePeakEstimateDb: round2(gainToDb(inputPeak)),
        maxGainReductionDb: 0,
        avgGainReductionDb: 0,
        appliedDriveDb: 0,
        truePeakTrimDb: 0,
        limitedSamples: 0,
        effectiveOversample: memoryPlan.effectiveOversample,
        memoryBudgetBytes: memoryPlan.memoryBudgetBytes,
        estimatedMemoryBytes: memoryPlan.estimatedMemoryBytes,
        memoryFallbackApplied: true,
        memoryExceeded: true,
      },
    };
  }
  const sourceChannels = copyChannels(buffer, channelCount, length);
  const inputPeak = measurePeak(sourceChannels);
  const autoDriveDb = resolveAutoDriveDb(sourceChannels, sampleRate, resolved);
  const appliedDriveDb = clamp(resolved.inputDriveDb + autoDriveDb, -3, 12);
  const driveGain = dbToGain(appliedDriveDb);
  const drivenChannels = sourceChannels;
  for (const channel of drivenChannels) applyGainInPlace(channel, driveGain);
  const processedChannels = drivenChannels.map((channel) => new Float32Array(channel.length));

  if (length === 0) {
    const empty = createAudioBufferLike(channelCount, 0, sampleRate);
    return {
      buffer: empty,
      report: {
        inputPeakDb: gainToDb(inputPeak),
        outputPeakDb: gainToDb(0),
        truePeakEstimateDb: gainToDb(0),
        maxGainReductionDb: 0,
        avgGainReductionDb: 0,
        appliedDriveDb,
        truePeakTrimDb: 0,
        limitedSamples: 0,
        effectiveOversample: memoryPlan.effectiveOversample,
        memoryBudgetBytes: memoryPlan.memoryBudgetBytes,
        estimatedMemoryBytes: memoryPlan.estimatedMemoryBytes,
        memoryFallbackApplied: memoryPlan.memoryFallbackApplied,
        memoryExceeded: memoryPlan.memoryExceeded,
      },
    };
  }

  const lookaheadSamples = Math.max(1, Math.round((resolved.lookaheadMs / 1000) * sampleRate));
  const framePeaks = collectFramePeaks(drivenChannels, length);
  const linkedLookahead = buildLookaheadPeaks(framePeaks, lookaheadSamples);
  const useLinkedOnly = resolved.stereoLink >= 0.999;
  const channelLookaheads = useLinkedOnly ? [] : drivenChannels.map((channel) => buildLookaheadPeaksFromAbsChannel(channel, lookaheadSamples));
  const ceiling = dbToGain(resolved.ceilingDb);
  const releaseSec = (resolved.releaseMs / 1000) * (0.85 + resolved.transientProtect * 0.35);
  const releaseCoeff = Math.exp(-1 / Math.max(1, releaseSec * sampleRate));
  const attackCoeff = Math.exp(-1 / Math.max(1, 0.0015 * sampleRate));
  let gainState = 1;
  let maxGainReductionDb = 0;
  let gainReductionSumDb = 0;
  let limitedSamples = 0;

  for (let index = 0; index < length; index += 1) {
    const linkedPeak = linkedLookahead[index] ?? 0;
    const channelPeakAverage = useLinkedOnly ? 0 : averageChannelPeak(channelLookaheads, index);
    const controlPeak = useLinkedOnly ? linkedPeak : linkedPeak * resolved.stereoLink + channelPeakAverage * (1 - resolved.stereoLink);
    const targetGain = controlPeak > ceiling ? ceiling / Math.max(controlPeak, 1e-12) : 1;
    if (targetGain < gainState) {
      gainState = targetGain + (gainState - targetGain) * attackCoeff;
    } else {
      gainState = targetGain + (gainState - targetGain) * releaseCoeff;
    }

    const gainReductionDb = gainState < 0.9999 ? -gainToDb(gainState) : 0;
    if (gainReductionDb > 0) {
      maxGainReductionDb = Math.max(maxGainReductionDb, gainReductionDb);
      gainReductionSumDb += gainReductionDb;
    }

    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = drivenChannels[channel]?.[index] ?? 0;
      const limited = sample * gainState;
      const shaped = applySoftClipGuard(limited, ceiling, resolved.softClipGuard);
      processedChannels[channel]![index] = clamp(shaped, -1, 1);
      if (gainReductionDb > 0.001 || Math.abs(shaped - limited) > 1e-7) {
        limitedSamples += 1;
      }
    }
  }

  let truePeakTrimDb = 0;
  const oversample = oversampleToFactor(memoryPlan.effectiveOversample);
  let truePeakEstimateDb = estimateTruePeakDbtpFromChannels(processedChannels, oversample, length);
  if (resolved.truePeakGuard && Number.isFinite(truePeakEstimateDb) && truePeakEstimateDb > resolved.ceilingDb) {
    truePeakTrimDb = resolved.ceilingDb - truePeakEstimateDb;
    const trimGain = dbToGain(truePeakTrimDb);
    for (const channel of processedChannels) {
      for (let index = 0; index < channel.length; index += 1) {
        channel[index] = clamp((channel[index] ?? 0) * trimGain, -1, 1);
      }
    }
    truePeakEstimateDb = estimateTruePeakDbtpFromChannels(processedChannels, oversample, length);
  }

  const outputPeak = measurePeak(processedChannels);
  const output = createAudioBufferLike(channelCount, length, sampleRate);
  for (let channel = 0; channel < channelCount; channel += 1) {
    output.getChannelData(channel).set(processedChannels[channel] ?? new Float32Array(length));
  }

  return {
    buffer: output,
    report: {
      inputPeakDb: round2(gainToDb(inputPeak)),
      outputPeakDb: round2(gainToDb(outputPeak)),
      truePeakEstimateDb: round2(truePeakEstimateDb),
      maxGainReductionDb: round2(maxGainReductionDb),
      avgGainReductionDb: round2(gainReductionSumDb / Math.max(1, length)),
      appliedDriveDb: round2(appliedDriveDb),
      truePeakTrimDb: round2(truePeakTrimDb),
      limitedSamples,
      effectiveOversample: memoryPlan.effectiveOversample,
      memoryBudgetBytes: memoryPlan.memoryBudgetBytes,
      estimatedMemoryBytes: memoryPlan.estimatedMemoryBytes,
      memoryFallbackApplied: memoryPlan.memoryFallbackApplied,
      memoryExceeded: memoryPlan.memoryExceeded,
    },
  };
}

export function resolvePeakMaximizerMemoryPlan(
  length: number,
  channelCount: number,
  requestedOversample: PeakMaximizerOversample,
  params: PeakMaximizerParamInput = {},
): PeakMaximizerMemoryPlan {
  const budget = Math.max(16 * 1024 * 1024, readNumber((params as Record<string, unknown>).memoryBudgetBytes, resolveDefaultPeakMaximizerMemoryBudgetBytes()));
  const stereoLink = clamp01(readNumber((params as Record<string, unknown>).stereoLink, 1));
  let effectiveOversample = requestedOversample;
  let estimated = estimatePeakMaximizerMemoryBytes(length, channelCount, effectiveOversample, stereoLink);
  if (estimated > budget && effectiveOversample === "4x") {
    effectiveOversample = "2x";
    estimated = estimatePeakMaximizerMemoryBytes(length, channelCount, effectiveOversample, stereoLink);
  }
  if (estimated > budget && effectiveOversample === "2x") {
    effectiveOversample = "off";
    estimated = estimatePeakMaximizerMemoryBytes(length, channelCount, effectiveOversample, stereoLink);
  }
  const memoryExceeded = estimated > budget && effectiveOversample === "off";
  return {
    requestedOversample,
    effectiveOversample,
    estimatedMemoryBytes: Math.round(estimated),
    memoryBudgetBytes: Math.round(budget),
    memoryFallbackApplied: effectiveOversample !== requestedOversample || memoryExceeded,
    memoryExceeded,
  };
}

export function estimatePeakMaximizerMemoryBytes(
  length: number,
  channelCount: number,
  oversample: PeakMaximizerOversample,
  stereoLink = 1,
) {
  const frames = Math.max(0, Math.round(length));
  const channels = Math.max(1, Math.round(channelCount));
  const floatBytes = 4;
  const pcmCopies = channels * frames * floatBytes * 2; // in-place driven channels + processed channels
  const outputBuffer = channels * frames * floatBytes;
  const controlCurves = frames * floatBytes * 2; // frame peaks + linked lookahead
  const channelLookaheadCurves = stereoLink < 0.999 ? channels * frames * floatBytes : 0;
  const truePeakScratch = frames * floatBytes * Math.max(0, oversampleToFactor(oversample) - 1) * Math.min(2, channels);
  return pcmCopies + outputBuffer + controlCurves + channelLookaheadCurves + truePeakScratch + 8 * 1024 * 1024;
}

function getModeDefaults(mode: PeakMaximizerMode): PeakMaximizerParams {
  if (mode === "punch") {
    return { ...DEFAULT_PEAK_MAXIMIZER_PARAMS, preset: "Punch Preserve", mode, inputDriveDb: 2.5, lookaheadMs: 1.2, releaseMs: 70, transientProtect: 0.85, softClipGuard: 0.12 };
  }
  if (mode === "loud") {
    return { ...DEFAULT_PEAK_MAXIMIZER_PARAMS, preset: "Loud Clear", mode, inputDriveDb: 4, lookaheadMs: 2.5, releaseMs: 120, transientProtect: 0.55, softClipGuard: 0.22 };
  }
  if (mode === "streaming") {
    return {
      ...DEFAULT_PEAK_MAXIMIZER_PARAMS,
      preset: "Streaming Safe",
      mode,
      inputDriveDb: 1.5,
      ceilingDb: -1.2,
      lookaheadMs: 2,
      releaseMs: 110,
      transientProtect: 0.7,
      softClipGuard: 0.1,
      autoDrive: true,
      targetLufs: -14,
      maxAutoDriveDb: 4,
    };
  }
  if (mode === "dense") {
    return { ...DEFAULT_PEAK_MAXIMIZER_PARAMS, preset: "Dense Master", mode, inputDriveDb: 5, ceilingDb: -0.8, lookaheadMs: 3, releaseMs: 150, transientProtect: 0.45, softClipGuard: 0.25 };
  }
  return { ...DEFAULT_PEAK_MAXIMIZER_PARAMS, preset: "Clean Lift", mode: "clean" };
}

function resolveAutoDriveDb(channels: readonly Float32Array[], sampleRate: number, params: PeakMaximizerParams) {
  if (!params.autoDrive || channels.length === 0) return 0;
  const analysis = analyzeFloat32ChannelsLoudness(channels, sampleRate, { truePeakOversample: 1, useKWeightingLite: true, useRelativeGate: true });
  const currentLoudness = analysis.integratedLufs ?? estimateApproxLoudnessDb(channels);
  if (!Number.isFinite(currentLoudness)) return 0;
  return clamp(params.targetLufs - currentLoudness, 0, params.maxAutoDriveDb);
}

function collectFramePeaks(channels: readonly Float32Array[], length: number) {
  const peaks = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    let peak = 0;
    for (const channel of channels) {
      peak = Math.max(peak, Math.abs(channel[index] ?? 0));
    }
    peaks[index] = peak;
  }
  return peaks;
}

function buildLookaheadPeaks(peaks: Float32Array, lookaheadSamples: number) {
  const length = peaks.length;
  const result = new Float32Array(length);
  const deque: number[] = [];
  let lastEntered = -1;
  let head = 0;

  for (let index = 0; index < length; index += 1) {
    const targetEnter = Math.min(length - 1, index + lookaheadSamples);
    while (lastEntered < targetEnter) {
      lastEntered += 1;
      while (deque.length > head && (peaks[deque[deque.length - 1]!] ?? 0) <= (peaks[lastEntered] ?? 0)) {
        deque.pop();
      }
      deque.push(lastEntered);
    }

    while (head < deque.length && (deque[head] ?? 0) < index) {
      head += 1;
    }

    if (head > 4096 && head * 2 > deque.length) {
      deque.splice(0, head);
      head = 0;
    }

    result[index] = peaks[deque[head] ?? index] ?? 0;
  }

  return result;
}

function buildLookaheadPeaksFromAbsChannel(channel: Float32Array, lookaheadSamples: number) {
  const length = channel.length;
  const result = new Float32Array(length);
  const deque: number[] = [];
  let lastEntered = -1;
  let head = 0;

  for (let index = 0; index < length; index += 1) {
    const targetEnter = Math.min(length - 1, index + lookaheadSamples);
    while (lastEntered < targetEnter) {
      lastEntered += 1;
      while (deque.length > head && Math.abs(channel[deque[deque.length - 1]!] ?? 0) <= Math.abs(channel[lastEntered] ?? 0)) {
        deque.pop();
      }
      deque.push(lastEntered);
    }

    while (head < deque.length && (deque[head] ?? 0) < index) {
      head += 1;
    }

    if (head > 4096 && head * 2 > deque.length) {
      deque.splice(0, head);
      head = 0;
    }

    result[index] = Math.abs(channel[deque[head] ?? index] ?? 0);
  }
  return result;
}

function averageChannelPeak(channelLookaheads: readonly Float32Array[], index: number) {
  if (channelLookaheads.length === 0) return 0;
  let sum = 0;
  for (const peaks of channelLookaheads) {
    sum += peaks[index] ?? 0;
  }
  return sum / channelLookaheads.length;
}

function applySoftClipGuard(sample: number, ceiling: number, guard: number) {
  const clean = sanitizeSample(sample);
  if (guard <= 0) return clean;
  const sign = Math.sign(clean);
  const abs = Math.abs(clean);
  const kneeStart = ceiling * (1 - clamp(guard, 0, 0.5));
  if (abs <= kneeStart) return clean;
  const range = Math.max(1e-6, ceiling - kneeStart);
  const shaped = kneeStart + range * Math.tanh((abs - kneeStart) / range);
  return sign * Math.min(ceiling, shaped);
}

function copyChannels(buffer: AudioBuffer, channelCount: number, length: number) {
  return Array.from({ length: channelCount }, (_, channel) => {
    const source = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
    return new Float32Array(source.subarray(0, length));
  });
}

function applyGainInPlace(channel: Float32Array, gain: number) {
  for (let index = 0; index < channel.length; index += 1) {
    channel[index] = sanitizeSample(channel[index] ?? 0) * gain;
  }
}

function measurePeak(channels: readonly Float32Array[]) {
  let peak = 0;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      peak = Math.max(peak, Math.abs(channel[index] ?? 0));
    }
  }
  return peak;
}

function measureAudioBufferPeak(buffer: AudioBuffer, channelCount: number, length: number) {
  let peak = 0;
  for (let channelIndex = 0; channelIndex < channelCount; channelIndex += 1) {
    const channel = buffer.getChannelData(Math.min(channelIndex, buffer.numberOfChannels - 1));
    for (let index = 0; index < length; index += 1) {
      peak = Math.max(peak, Math.abs(channel[index] ?? 0));
    }
  }
  return peak;
}

function estimateApproxLoudnessDb(channels: readonly Float32Array[]) {
  let squares = 0;
  let samples = 0;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index += 1) {
      const sample = sanitizeSample(channel[index] ?? 0);
      squares += sample * sample;
      samples += 1;
    }
  }
  if (samples === 0 || squares <= 0) return -Infinity;
  return gainToDb(Math.sqrt(squares / samples)) - 1.2;
}

function createAudioBufferLike(numberOfChannels: number, length: number, sampleRate: number): AudioBuffer {
  const AudioBufferCtor = globalThis.AudioBuffer;
  if (typeof AudioBufferCtor === "function") {
    return new AudioBufferCtor({ numberOfChannels, length, sampleRate });
  }

  const channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  return {
    numberOfChannels,
    length,
    sampleRate,
    duration: sampleRate > 0 ? length / sampleRate : 0,
    getChannelData: (channel: number) => channels[channel] ?? channels[0] ?? new Float32Array(length),
    copyFromChannel: (destination: Float32Array, channelNumber: number, startInChannel = 0) => {
      destination.set((channels[channelNumber] ?? channels[0] ?? new Float32Array()).subarray(startInChannel, startInChannel + destination.length));
    },
    copyToChannel: (source: Float32Array, channelNumber: number, startInChannel = 0) => {
      (channels[channelNumber] ?? channels[0])?.set(source, startInChannel);
    },
  } as AudioBuffer;
}

function oversampleToFactor(value: PeakMaximizerOversample): 1 | 2 | 4 {
  if (value === "4x") return 4;
  if (value === "2x") return 2;
  return 1;
}

function readMode(value: unknown, fallback: PeakMaximizerMode): PeakMaximizerMode {
  return value === "clean" || value === "punch" || value === "loud" || value === "streaming" || value === "dense" ? value : fallback;
}

function readOversample(value: unknown, fallback: PeakMaximizerOversample): PeakMaximizerOversample {
  return value === "off" || value === "2x" || value === "4x" ? value : fallback;
}

function readString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function readBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function readNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function resolveDefaultPeakMaximizerMemoryBudgetBytes() {
  const nav = typeof navigator !== "undefined" ? navigator as Navigator & { deviceMemory?: number } : undefined;
  const deviceMemoryGb = typeof nav?.deviceMemory === "number" && Number.isFinite(nav.deviceMemory) ? nav.deviceMemory : 2;
  return clamp(deviceMemoryGb * 1024 * 1024 * 1024 * 0.14, 96 * 1024 * 1024, 384 * 1024 * 1024);
}

function sanitizeSample(sample: number) {
  return Number.isFinite(sample) ? sample : 0;
}

function dbToGain(db: number) {
  return 10 ** (db / 20);
}

function gainToDb(gain: number) {
  return gain > 0 ? 20 * Math.log10(gain) : -Infinity;
}

function clamp01(value: number) {
  return clamp(value, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function round2(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : value;
}
