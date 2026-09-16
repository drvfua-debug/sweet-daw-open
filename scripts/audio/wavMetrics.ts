import fs from "node:fs";
import path from "node:path";

export type WavAudioData = {
  sampleRate: number;
  channels: Float32Array[];
  durationSec: number;
};

export type WavMetrics = {
  filePath: string;
  durationSec: number;
  sampleRate: number;
  channels: number;
  samplePeakDb: number;
  truePeakApproxDb: number;
  rmsDb: number;
  integratedLufsApprox: number;
  crestDb: number;
  plrDb: number;
  shortTermLufsMax?: number;
  peakDensity?: number;
  sideMidDb: number;
  lrCorrelation: number;
  bandEnergyDb: {
    sub_20_60: number;
    low_60_120: number;
    lowMid_120_250: number;
    body_250_500: number;
    mid_500_2000: number;
    presence_2000_5000: number;
    air_5000_10000: number;
    gloss_9000_14000: number;
    ultraAir_10000_20000: number;
    sheen_14000_20000: number;
  };
  bandSideMidDb: {
    low_20_120: number;
    lowMid_120_500: number;
    mid_500_2000: number;
    presence_2000_5000: number;
    air_5000_10000: number;
    gloss_9000_14000: number;
    ultraAir_10000_20000: number;
    sheen_14000_20000: number;
  };
  bandCorrelation: {
    low_20_120: number;
    lowMid_120_500: number;
    mid_500_2000: number;
    presence_2000_5000: number;
    air_5000_10000: number;
    gloss_9000_14000: number;
    ultraAir_10000_20000: number;
    sheen_14000_20000: number;
  };
  spectralFlatnessHigh?: number;
  hfHashIndex?: number;
};

const LUFS_FROM_RMS_OFFSET_DB = -1.2;
const BANDS = [
  { key: "sub_20_60", points: [30, 45, 60] },
  { key: "low_60_120", points: [65, 90, 115] },
  { key: "lowMid_120_250", points: [130, 185, 240] },
  { key: "body_250_500", points: [260, 375, 490] },
  { key: "mid_500_2000", points: [650, 1100, 1800] },
  { key: "presence_2000_5000", points: [2200, 3500, 4800] },
  { key: "air_5000_10000", points: [5500, 7500, 9500] },
  { key: "gloss_9000_14000", points: [9200, 11000, 13500] },
  { key: "ultraAir_10000_20000", points: [10500, 14000, 18000] },
  { key: "sheen_14000_20000", points: [14500, 16500, 19000] },
] as const;

const SIDE_BANDS = [
  { key: "low_20_120", points: [35, 70, 110] },
  { key: "lowMid_120_500", points: [150, 280, 450] },
  { key: "mid_500_2000", points: [650, 1100, 1800] },
  { key: "presence_2000_5000", points: [2200, 3500, 4800] },
  { key: "air_5000_10000", points: [5500, 7500, 9500] },
  { key: "gloss_9000_14000", points: [9200, 11000, 13500] },
  { key: "ultraAir_10000_20000", points: [10500, 14000, 18000] },
  { key: "sheen_14000_20000", points: [14500, 16500, 19000] },
] as const;

export function analyzeWavFile(filePath: string): WavMetrics {
  return calculateWavMetrics(readWavFile(filePath), filePath);
}

export function calculateWavMetrics(audio: WavAudioData, filePath = "<memory>"): WavMetrics {
  const length = audio.channels[0]?.length ?? 0;
  const left = audio.channels[0] ?? new Float32Array(0);
  const right = audio.channels[1] ?? left;
  const shortTermStep = Math.max(1, Math.floor(Math.max(1, length) / 300000));
  let peak = 0;
  let squareSum = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  let cross = 0;
  let midSquares = 0;
  let sideSquares = 0;
  let peakDenseSamples = 0;
  let count = 0;

  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? l;
    const mono = (l + r) * 0.5;
    const channelPower = audio.channels.length > 1 ? (l * l + r * r) * 0.5 : l * l;
    const mid = mono;
    const side = (l - r) * 0.5;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    if (Math.max(Math.abs(l), Math.abs(r)) >= 0.5) peakDenseSamples += 1;
    squareSum += channelPower;
    leftSquares += l * l;
    rightSquares += r * r;
    cross += l * r;
    midSquares += mid * mid;
    sideSquares += side * side;
    count += 1;
  }

  const rms = Math.sqrt(squareSum / Math.max(1, count));
  const rmsDb = ampToDb(rms);
  const samplePeakDb = ampToDb(peak);
  const midRms = Math.sqrt(midSquares / Math.max(1, count));
  const sideRms = Math.sqrt(sideSquares / Math.max(1, count));
  const bandStats = Object.fromEntries(
    BANDS.map((band) => [band.key, estimateBandStats(audio, band.points)]),
  ) as Record<keyof WavMetrics["bandEnergyDb"], BandStats>;
  const sideBandStats = Object.fromEntries(
    SIDE_BANDS.map((band) => [band.key, estimateBandStats(audio, band.points)]),
  ) as Record<keyof WavMetrics["bandSideMidDb"], BandStats>;
  const bandEnergyDb = Object.fromEntries(
    BANDS.map((band) => [band.key, bandStats[band.key].energyDb]),
  ) as WavMetrics["bandEnergyDb"];
  const bandSideMidDb = Object.fromEntries(
    SIDE_BANDS.map((band) => [band.key, sideBandStats[band.key].sideMidDb]),
  ) as WavMetrics["bandSideMidDb"];
  const bandCorrelation = Object.fromEntries(
    SIDE_BANDS.map((band) => [band.key, sideBandStats[band.key].correlation]),
  ) as WavMetrics["bandCorrelation"];
  const integratedLufsApprox = rmsDb + LUFS_FROM_RMS_OFFSET_DB;
  const truePeakApproxDb = samplePeakDb + 0.2;
  const highFlatness = spectralFlatness([
    bandEnergyDb.air_5000_10000,
    bandEnergyDb.gloss_9000_14000,
    bandEnergyDb.ultraAir_10000_20000,
    bandEnergyDb.sheen_14000_20000,
  ]);

  return {
    filePath: path.resolve(filePath),
    durationSec: round2(audio.durationSec),
    sampleRate: audio.sampleRate,
    channels: audio.channels.length,
    samplePeakDb: round2(samplePeakDb),
    truePeakApproxDb: round2(truePeakApproxDb),
    rmsDb: round2(rmsDb),
    integratedLufsApprox: round2(integratedLufsApprox),
    crestDb: round2(samplePeakDb - rmsDb),
    plrDb: round2(truePeakApproxDb - integratedLufsApprox),
    shortTermLufsMax: estimateShortTermLufsMax(audio, shortTermStep),
    peakDensity: round3(peakDenseSamples / Math.max(1, count)),
    sideMidDb: round2(ampToDb(sideRms) - ampToDb(midRms)),
    lrCorrelation: round3(clamp(cross / Math.max(1e-12, Math.sqrt(leftSquares * rightSquares)), -1, 1)),
    bandEnergyDb,
    bandSideMidDb,
    bandCorrelation,
    spectralFlatnessHigh: highFlatness,
    hfHashIndex: round3(clamp((bandEnergyDb.sheen_14000_20000 - bandEnergyDb.presence_2000_5000 + 12) / 24 + Math.max(0, 0.35 - highFlatness), 0, 1)),
  };
}

export function readWavFile(filePath: string): WavAudioData {
  const buffer = fs.readFileSync(filePath);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`Not a WAV file: ${filePath}`);
  }
  let offset = 12;
  let fmt: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number; blockAlign: number } | null = null;
  let dataOffset = -1;
  let dataSize = 0;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (id === "fmt ") {
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        blockAlign: buffer.readUInt16LE(chunkStart + 12),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14),
      };
    } else if (id === "data") {
      dataOffset = chunkStart;
      dataSize = size;
      break;
    }
    offset = chunkStart + size + (size % 2);
  }
  if (!fmt || dataOffset < 0) throw new Error(`Missing WAV fmt/data chunk: ${filePath}`);
  const frames = Math.floor(dataSize / fmt.blockAlign);
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  const bytesPerSample = fmt.bitsPerSample / 8;
  for (let frame = 0; frame < frames; frame += 1) {
    const frameOffset = dataOffset + frame * fmt.blockAlign;
    for (let channel = 0; channel < fmt.channels; channel += 1) {
      const sampleOffset = frameOffset + channel * bytesPerSample;
      channels[channel]![frame] = readSample(buffer, sampleOffset, fmt.bitsPerSample, fmt.audioFormat);
    }
  }
  return { sampleRate: fmt.sampleRate, channels, durationSec: frames / fmt.sampleRate };
}

export function writeWavPcm16(filePath: string, audio: WavAudioData) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const frames = audio.channels[0]?.length ?? 0;
  const channels = Math.max(1, audio.channels.length);
  const dataSize = frames * channels * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write("WAVE", 8, "ascii");
  buffer.write("fmt ", 12, "ascii");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(audio.sampleRate, 24);
  buffer.writeUInt32LE(audio.sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "ascii");
  buffer.writeUInt32LE(dataSize, 40);
  let offset = 44;
  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const samples = audio.channels[channel] ?? audio.channels[0]!;
      const value = clamp(samples[frame] ?? 0, -1, 1);
      buffer.writeInt16LE(Math.round(value * 32767), offset);
      offset += 2;
    }
  }
  fs.writeFileSync(filePath, buffer);
}

function readSample(buffer: Buffer, offset: number, bitsPerSample: number, audioFormat: number) {
  if (audioFormat === 3 && bitsPerSample === 32) return buffer.readFloatLE(offset);
  if (audioFormat !== 1) throw new Error(`Unsupported WAV audio format ${audioFormat}`);
  if (bitsPerSample === 16) return buffer.readInt16LE(offset) / 32768;
  if (bitsPerSample === 24) return buffer.readIntLE(offset, 3) / 8388608;
  if (bitsPerSample === 32) return buffer.readInt32LE(offset) / 2147483648;
  throw new Error(`Unsupported WAV bit depth ${bitsPerSample}`);
}

type BandStats = {
  energyDb: number;
  sideMidDb: number;
  correlation: number;
};

function estimateBandStats(audio: WavAudioData, points: readonly number[]): BandStats {
  const stats = points.map((frequency) => estimateFrequencyStats(audio, frequency));
  return {
    energyDb: averageDb(stats.map((entry) => entry.energyDb)),
    sideMidDb: round2(averageLinear(stats.map((entry) => entry.sideMidDb))),
    correlation: round3(averageLinear(stats.map((entry) => entry.correlation))),
  };
}

function estimateFrequencyStats(audio: WavAudioData, frequency: number): BandStats {
  const length = audio.channels[0]?.length ?? 0;
  const windowSize = Math.min(2048, Math.max(256, Math.floor(length / 2)));
  if (length < 8 || windowSize < 8) return { energyDb: -96, sideMidDb: -48, correlation: 1 };
  const frameCount = Math.max(4, Math.min(48, Math.floor(audio.durationSec)));
  const omega = (2 * Math.PI * Math.min(frequency, audio.sampleRate / 2 - 100)) / audio.sampleRate;
  let monoMagnitudeSum = 0;
  let midMagnitudeSum = 0;
  let sideMagnitudeSum = 0;
  let correlationSum = 0;
  let correlationCount = 0;
  const leftChannel = audio.channels[0] ?? new Float32Array(0);
  const rightChannel = audio.channels[1] ?? leftChannel;
  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frameCount === 1 ? 0 : Math.floor((frame / (frameCount - 1)) * Math.max(0, length - windowSize));
    let monoReal = 0;
    let monoImag = 0;
    let midReal = 0;
    let midImag = 0;
    let sideReal = 0;
    let sideImag = 0;
    let leftReal = 0;
    let leftImag = 0;
    let rightReal = 0;
    let rightImag = 0;
    for (let offset = 0; offset < windowSize; offset += 1) {
      const l = leftChannel[start + offset] ?? 0;
      const r = rightChannel[start + offset] ?? l;
      const sample = (l + r) * 0.5;
      const mid = sample;
      const side = (l - r) * 0.5;
      const win = 0.5 - 0.5 * Math.cos((2 * Math.PI * offset) / Math.max(1, windowSize - 1));
      const cos = Math.cos(omega * offset);
      const sin = Math.sin(omega * offset);
      const monoValue = sample * win;
      const midValue = mid * win;
      const sideValue = side * win;
      const leftValue = l * win;
      const rightValue = r * win;
      monoReal += monoValue * cos;
      monoImag -= monoValue * sin;
      midReal += midValue * cos;
      midImag -= midValue * sin;
      sideReal += sideValue * cos;
      sideImag -= sideValue * sin;
      leftReal += leftValue * cos;
      leftImag -= leftValue * sin;
      rightReal += rightValue * cos;
      rightImag -= rightValue * sin;
    }
    const monoMagnitude = Math.sqrt(monoReal * monoReal + monoImag * monoImag) / (windowSize * 0.5);
    const midMagnitude = Math.sqrt(midReal * midReal + midImag * midImag) / (windowSize * 0.5);
    const sideMagnitude = Math.sqrt(sideReal * sideReal + sideImag * sideImag) / (windowSize * 0.5);
    const leftMagnitude = Math.sqrt(leftReal * leftReal + leftImag * leftImag);
    const rightMagnitude = Math.sqrt(rightReal * rightReal + rightImag * rightImag);
    monoMagnitudeSum += monoMagnitude;
    midMagnitudeSum += midMagnitude;
    sideMagnitudeSum += sideMagnitude;
    if (leftMagnitude > 1e-9 && rightMagnitude > 1e-9) {
      correlationSum += clamp((leftReal * rightReal + leftImag * rightImag) / Math.max(1e-12, leftMagnitude * rightMagnitude), -1, 1);
      correlationCount += 1;
    }
  }
  const monoMagnitude = monoMagnitudeSum / Math.max(1, frameCount);
  const midMagnitude = midMagnitudeSum / Math.max(1, frameCount);
  const sideMagnitude = sideMagnitudeSum / Math.max(1, frameCount);
  return {
    energyDb: round2(ampToDb(monoMagnitude)),
    sideMidDb: round2(ampToDb(sideMagnitude) - ampToDb(midMagnitude)),
    correlation: round3(correlationCount > 0 ? correlationSum / correlationCount : 1),
  };
}

function estimateShortTermLufsMax(audio: WavAudioData, baseStep: number) {
  const length = audio.channels[0]?.length ?? 0;
  const windowFrames = Math.max(1, Math.floor(audio.sampleRate * 3));
  if (length <= 0) return -96;
  const hopFrames = Math.max(1, Math.floor(audio.sampleRate));
  const step = Math.max(1, baseStep);
  let maxRmsDb = -96;
  for (let start = 0; start < length; start += hopFrames) {
    const end = Math.min(length, start + windowFrames);
    let sum = 0;
    let count = 0;
    for (let index = start; index < end; index += step) {
      sum += averageFramePower(audio.channels, index);
      count += 1;
    }
    if (count > 0) {
      maxRmsDb = Math.max(maxRmsDb, ampToDb(Math.sqrt(sum / count)) + LUFS_FROM_RMS_OFFSET_DB);
    }
    if (end >= length) break;
  }
  return round2(maxRmsDb);
}

function averageFramePower(channels: Float32Array[], index: number) {
  let sum = 0;
  for (const channel of channels) {
    const sample = channel[index] ?? 0;
    sum += sample * sample;
  }
  return sum / Math.max(1, channels.length);
}

function averageDb(values: number[]) {
  const powers = values.map((value) => 10 ** (value / 10));
  return round2(10 * Math.log10(Math.max(1e-12, powers.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length))));
}

function averageLinear(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function spectralFlatness(valuesDb: number[]) {
  const powers = valuesDb.map((value) => Math.max(1e-12, 10 ** (value / 10)));
  const geometricMean = Math.exp(powers.reduce((sum, value) => sum + Math.log(value), 0) / Math.max(1, powers.length));
  const arithmeticMean = powers.reduce((sum, value) => sum + value, 0) / Math.max(1, powers.length);
  return round3(clamp(geometricMean / Math.max(1e-12, arithmeticMean), 0, 1));
}

function ampToDb(value: number) {
  return 20 * Math.log10(Math.max(1e-9, Math.abs(value)));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}
