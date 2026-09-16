import { resolveMobileProcessingBudget, type MobileAudioQuality } from "./MobileProcessingBudget.ts";
import { engineModeToMobileAudioQuality, type EngineQualityMode } from "../engine/EngineQualityMode.ts";

export type LoudnessAnalysis = {
  durationSec: number;
  integratedLufs: number | null;
  shortTermMaxLufs: number | null;
  momentaryMaxLufs: number | null;
  loudnessRangeLu: number | null;
  samplePeakDbfs: number;
  truePeakDbtp: number;
  clippedSampleRatio: number;
  dcOffset: number;
};

export type LoudnessAnalyzerOptions = {
  quality?: MobileAudioQuality;
  engineQualityMode?: EngineQualityMode;
  truePeakOversample?: 1 | 2 | 4;
  useKWeightingLite?: boolean;
  useRelativeGate?: boolean;
};

type ChannelSource = {
  sampleRate: number;
  channelCount: number;
  length: number;
  getChannelData: (channel: number) => Float32Array;
};

const SILENCE_DB = -Infinity;
const CLIP_THRESHOLD = 0.999;
const MOMENTARY_WINDOW_SEC = 0.4;
const SHORT_TERM_WINDOW_SEC = 3;

export function analyzeAudioBufferLoudness(buffer: AudioBuffer, options: LoudnessAnalyzerOptions = {}): LoudnessAnalysis {
  return analyzeChannelSource(
    {
      sampleRate: Math.max(1, buffer.sampleRate || 48000),
      channelCount: Math.max(1, buffer.numberOfChannels || 1),
      length: Math.max(0, buffer.length || 0),
      getChannelData: (channel) => buffer.getChannelData(channel),
    },
    options,
  );
}

export function analyzeFloat32ChannelsLoudness(
  channels: readonly Float32Array[],
  sampleRate: number,
  options: LoudnessAnalyzerOptions = {},
): LoudnessAnalysis {
  const length = channels.length === 0 ? 0 : Math.min(...channels.map((channel) => channel.length));
  return analyzeChannelSource(
    {
      sampleRate: Math.max(1, sampleRate || 48000),
      channelCount: Math.max(1, channels.length || 1),
      length: Math.max(0, length),
      getChannelData: (channel) => channels[channel] ?? channels[0] ?? new Float32Array(),
    },
    options,
  );
}

export function estimateTruePeakDbtpFromChannels(
  channels: readonly Float32Array[],
  oversample: 1 | 2 | 4 = 2,
  sampleCount = channels.length === 0 ? 0 : Math.min(...channels.map((channel) => channel.length)),
) {
  return round2(gainToDb(estimateTruePeakStreaming(channels, oversample, sampleCount)));
}

function analyzeChannelSource(source: ChannelSource, options: LoudnessAnalyzerOptions): LoudnessAnalysis {
  const budget = resolveMobileProcessingBudget(options.quality ?? (options.engineQualityMode ? engineModeToMobileAudioQuality(options.engineQualityMode) : "mobile-hq"));
  const sampleRate = Math.max(1, source.sampleRate || 48000);
  const channelCount = Math.max(1, source.channelCount || 1);
  const length = Math.max(0, source.length || 0);
  const durationSec = length / sampleRate;

  if (length === 0) {
    return emptyAnalysis(durationSec);
  }

  const truePeakOversample = options.truePeakOversample ?? budget.truePeakOversample;
  const useKWeightingLite = options.useKWeightingLite ?? budget.quality !== "fast";
  const useRelativeGate = options.useRelativeGate ?? budget.quality !== "fast";
  const blockLength = Math.max(1, Math.floor(MOMENTARY_WINDOW_SEC * sampleRate));
  const blockCount = Math.max(1, Math.ceil(length / blockLength));
  const blockSquares = new Float64Array(blockCount);
  const blockSamples = new Float64Array(blockCount);

  let peak = 0;
  let truePeak = 0;
  let rawSquares = 0;
  let rawSum = 0;
  let clipped = 0;
  let samples = 0;

  for (let channel = 0; channel < channelCount; channel += 1) {
    const data = source.getChannelData(channel);
    const weightedSample = createKWeightingLiteProcessor(sampleRate, useKWeightingLite);
    truePeak = Math.max(truePeak, estimateTruePeakStreaming([data], truePeakOversample, length));
    for (let index = 0; index < length; index += 1) {
      const sample = sanitizeSample(data[index] ?? 0);
      const abs = Math.abs(sample);
      const weighted = weightedSample(sample);
      const blockIndex = Math.min(blockCount - 1, Math.floor(index / blockLength));

      peak = Math.max(peak, abs);
      rawSquares += sample * sample;
      rawSum += sample;
      blockSquares[blockIndex] += weighted * weighted;
      blockSamples[blockIndex] += 1;
      if (abs >= CLIP_THRESHOLD) clipped += 1;
      samples += 1;
    }
  }

  if (samples === 0 || rawSquares <= 0 || peak <= 0) {
    return emptyAnalysis(durationSec);
  }

  const blockPowers = collectBlockPowers(blockSquares, blockSamples);
  const integratedLufs = calculateIntegratedLufs(blockPowers, useRelativeGate);
  const momentary = blockPowers.map((power) => powerToLufs(power)).filter(Number.isFinite);
  const shortTerms = collectBlockWindowLoudness(blockPowers, SHORT_TERM_WINDOW_SEC / MOMENTARY_WINDOW_SEC);

  return {
    durationSec: round2(durationSec),
    integratedLufs: integratedLufs == null ? round2(powerToLufs(rawSquares / samples)) : round2(integratedLufs),
    shortTermMaxLufs: maxOrNull(shortTerms),
    momentaryMaxLufs: maxOrNull(momentary),
    loudnessRangeLu: loudnessRange(shortTerms),
    samplePeakDbfs: round2(gainToDb(peak)),
    truePeakDbtp: round2(gainToDb(Math.max(peak, truePeak))),
    clippedSampleRatio: round4(clipped / samples),
    dcOffset: round4(rawSum / samples),
  };
}

function collectBlockPowers(blockSquares: Float64Array, blockSamples: Float64Array) {
  const powers: number[] = [];
  for (let index = 0; index < blockSquares.length; index += 1) {
    const samples = blockSamples[index] ?? 0;
    const power = samples > 0 ? (blockSquares[index] ?? 0) / samples : 0;
    if (power > 0) powers.push(power);
  }
  return powers;
}

function calculateIntegratedLufs(blockPowers: number[], useRelativeGate: boolean) {
  const absolute = blockPowers.filter((power) => powerToLufs(power) > -70);
  if (absolute.length === 0) return null;
  if (!useRelativeGate) return powerToLufs(averagePower(absolute));

  const ungatedLufs = powerToLufs(averagePower(absolute));
  const relativeGate = ungatedLufs - 10;
  const gated = absolute.filter((power) => powerToLufs(power) > relativeGate);
  if (gated.length === 0) return ungatedLufs;
  return powerToLufs(averagePower(gated));
}

function collectBlockWindowLoudness(blockPowers: number[], blocksPerWindowFloat: number) {
  if (blockPowers.length === 0) return [];
  const blocksPerWindow = Math.max(1, Math.round(blocksPerWindowFloat));
  const values: number[] = [];
  for (let start = 0; start < blockPowers.length; start += 1) {
    const end = Math.min(blockPowers.length, start + blocksPerWindow);
    if (end <= start) break;
    values.push(powerToLufs(averagePower(blockPowers.slice(start, end))));
    if (end === blockPowers.length) break;
  }
  return values.filter(Number.isFinite);
}

function loudnessRange(values: number[]) {
  const gated = values.filter((value) => Number.isFinite(value) && value > -70).sort((a, b) => a - b);
  if (gated.length < 2) return null;
  return round2(percentile(gated, 0.95) - percentile(gated, 0.1));
}

function percentile(sorted: number[], ratio: number) {
  const index = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * ratio)));
  return sorted[index] ?? sorted[0] ?? 0;
}

function averagePower(values: readonly number[]) {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function powerToLufs(meanSquare: number) {
  // Lightweight BS.1770-style estimate: RMS power in dB with the LUFS calibration offset.
  return -0.691 + 10 * Math.log10(Math.max(meanSquare, 1e-12));
}

function maxOrNull(values: number[]) {
  if (values.length === 0) return null;
  return round2(Math.max(...values));
}

function emptyAnalysis(durationSec: number): LoudnessAnalysis {
  return {
    durationSec: round2(Math.max(0, durationSec)),
    integratedLufs: null,
    shortTermMaxLufs: null,
    momentaryMaxLufs: null,
    loudnessRangeLu: null,
    samplePeakDbfs: SILENCE_DB,
    truePeakDbtp: SILENCE_DB,
    clippedSampleRatio: 0,
    dcOffset: 0,
  };
}

function estimateTruePeakStreaming(channels: readonly Float32Array[], oversample: 1 | 2 | 4, sampleCount: number) {
  let peak = 0;
  const steps = Math.max(1, oversample);
  for (const channel of channels) {
    const length = Math.min(sampleCount, channel.length);
    for (let index = 0; index < length; index += 1) {
      const p1 = sanitizeSample(channel[index] ?? 0);
      peak = Math.max(peak, Math.abs(p1));
      if (steps <= 1 || index >= length - 1) continue;

      const p0 = sanitizeSample(channel[index - 1] ?? p1);
      const p2 = sanitizeSample(channel[index + 1] ?? p1);
      const p3 = sanitizeSample(channel[index + 2] ?? p2);
      for (let step = 1; step < steps; step += 1) {
        const interpolated = cubicHermite(p0, p1, p2, p3, step / steps);
        peak = Math.max(peak, Math.abs(interpolated));
      }
    }
  }
  return peak;
}

function cubicHermite(p0: number, p1: number, p2: number, p3: number, t: number) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

function createKWeightingLiteProcessor(sampleRate: number, enabled: boolean) {
  if (!enabled) return (sample: number) => sample;
  const highpass = createBiquadProcessor(makeHighpass(sampleRate, 38, 0.5));
  const highshelf = createBiquadProcessor(makeHighshelf(sampleRate, 1500, 3.8, 0.75));
  return (sample: number) => highshelf(highpass(sample));
}

function createBiquadProcessor(coefficients: BiquadCoefficients) {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return (x0: number) => {
    const y0 = coefficients.b0 * x0 + coefficients.b1 * x1 + coefficients.b2 * x2 - coefficients.a1 * y1 - coefficients.a2 * y2;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
    return sanitizeSample(y0);
  };
}

type BiquadCoefficients = {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
};

function makeHighpass(sampleRate: number, frequency: number, q: number): BiquadCoefficients {
  const omega = 2 * Math.PI * clampNumber(frequency, 10, sampleRate * 0.45) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const alpha = sin / (2 * q);
  const b0 = (1 + cos) / 2;
  const b1 = -(1 + cos);
  const b2 = (1 + cos) / 2;
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  return normalizeBiquad(b0, b1, b2, a0, a1, a2);
}

function makeHighshelf(sampleRate: number, frequency: number, gainDb: number, slope: number): BiquadCoefficients {
  const a = 10 ** (gainDb / 40);
  const omega = 2 * Math.PI * clampNumber(frequency, 20, sampleRate * 0.45) / sampleRate;
  const sin = Math.sin(omega);
  const cos = Math.cos(omega);
  const safeSlope = clampNumber(slope, 0.3, 1.2);
  const beta = 2 * Math.sqrt(a) * Math.sqrt(Math.max(0, (a + 1 / a) * (1 / safeSlope - 1) + 2));
  const b0 = a * ((a + 1) + (a - 1) * cos + beta * sin);
  const b1 = -2 * a * ((a - 1) + (a + 1) * cos);
  const b2 = a * ((a + 1) + (a - 1) * cos - beta * sin);
  const a0 = (a + 1) - (a - 1) * cos + beta * sin;
  const a1 = 2 * ((a - 1) - (a + 1) * cos);
  const a2 = (a + 1) - (a - 1) * cos - beta * sin;
  return normalizeBiquad(b0, b1, b2, a0, a1, a2);
}

function normalizeBiquad(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number): BiquadCoefficients {
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

function sanitizeSample(value: number) {
  return Number.isFinite(value) ? Math.max(-8, Math.min(8, value)) : 0;
}

function gainToDb(gain: number) {
  return gain > 0 ? 20 * Math.log10(gain) : SILENCE_DB;
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function round2(value: number) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : value;
}

function round4(value: number) {
  return Number.isFinite(value) ? Math.round(value * 10000) / 10000 : value;
}
