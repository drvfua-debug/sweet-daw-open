export const PEAK_SUMMARY_ANALYSIS_VERSION = 2;

export type PeakSummary = {
  analysisVersion?: number;
  bins: number;
  min: number[];
  max: number[];
  durationSec: number;
  bandEnergyDb?: Record<string, number>;
  bandSideMidDb?: Record<string, number>;
  lrCorrelation?: number;
  sideMidRatioDb?: number;
  spectralCentroidHz?: number;
  spectralFlatness?: number;
};

const ANALYSIS_BANDS = [
  { id: "20-35", low: 20, high: 35, center: 27.5 },
  { id: "35-60", low: 35, high: 60, center: 47.5 },
  { id: "60-120", low: 60, high: 120, center: 90 },
  { id: "120-250", low: 120, high: 250, center: 185 },
  { id: "250-500", low: 250, high: 500, center: 375 },
  { id: "500-900", low: 500, high: 900, center: 700 },
  { id: "900-1500", low: 900, high: 1500, center: 1200 },
  { id: "1500-3000", low: 1500, high: 3000, center: 2200 },
  { id: "3000-5000", low: 3000, high: 5000, center: 4000 },
  { id: "5000-9000", low: 5000, high: 9000, center: 7000 },
  { id: "9000-12000", low: 9000, high: 12000, center: 10500 },
  { id: "12000-16000", low: 12000, high: 16000, center: 14000 },
  { id: "16000-20000", low: 16000, high: 20000, center: 18000 },
];

const SIDE_ANALYSIS_BANDS = [
  { id: "low_20_120", points: [35, 70, 110] },
  { id: "lowMid_120_500", points: [150, 280, 450] },
  { id: "mid_500_2000", points: [650, 1100, 1800] },
  { id: "presence_2000_5000", points: [2200, 3500, 4800] },
  { id: "air_5000_10000", points: [5500, 7500, 9500] },
  { id: "gloss_9000_14000", points: [9200, 11000, 13500] },
  { id: "ultraAir_10000_20000", points: [10500, 14000, 18000] },
  { id: "sheen_14000_20000", points: [14500, 16500, 19000] },
] as const;

export function buildPeakSummary(buffer: AudioBuffer, bins = 4096): PeakSummary {
  const safeBins = Math.max(16, Math.min(16384, bins));
  const min = new Array<number>(safeBins).fill(0);
  const max = new Array<number>(safeBins).fill(0);
  const samplesPerBin = Math.max(1, Math.floor(buffer.length / safeBins));

  for (let bin = 0; bin < safeBins; bin += 1) {
    const start = bin * samplesPerBin;
    const end = bin === safeBins - 1 ? buffer.length : Math.min(buffer.length, start + samplesPerBin);
    let binMin = 0;
    let binMax = 0;

    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = start; i < end; i += 1) {
        const value = data[i] ?? 0;
        if (value < binMin) binMin = value;
        if (value > binMax) binMax = value;
      }
    }

    min[bin] = binMin;
    max[bin] = binMax;
  }

  return {
    analysisVersion: PEAK_SUMMARY_ANALYSIS_VERSION,
    bins: safeBins,
    min,
    max,
    durationSec: buffer.duration,
    ...analyzeAudioBufferFeatures(buffer),
  };
}

function analyzeAudioBufferFeatures(buffer: AudioBuffer) {
  const channels = Array.from({ length: Math.max(1, buffer.numberOfChannels) }, (_, index) => buffer.getChannelData(index));
  const stereo = scanStereoFeatures(channels, buffer.length);
  const bandEnergyDb = Object.fromEntries(
    ANALYSIS_BANDS.map((band) => [
      band.id,
      averageDb([
        estimateFrequencyDb(channels, buffer.sampleRate, buffer.length, band.low),
        estimateFrequencyDb(channels, buffer.sampleRate, buffer.length, band.center),
        estimateFrequencyDb(channels, buffer.sampleRate, buffer.length, band.high),
      ]),
    ]),
  );
  const bandSideMidDb = Object.fromEntries(
    SIDE_ANALYSIS_BANDS.map((band) => [
      band.id,
      round1(band.points.reduce((sum, frequency) => sum + estimateFrequencySideMidDb(channels, buffer.sampleRate, buffer.length, frequency), 0) / band.points.length),
    ]),
  );
  const spectralCentroidHz = estimateCentroidHz(bandEnergyDb);
  const spectralFlatness = estimateFlatness(bandEnergyDb);

  return {
    bandEnergyDb,
    bandSideMidDb,
    lrCorrelation: stereo.lrCorrelation,
    sideMidRatioDb: stereo.sideMidRatioDb,
    spectralCentroidHz,
    spectralFlatness,
  };
}

function scanStereoFeatures(channels: Float32Array[], length: number) {
  const left = channels[0];
  const right = channels[1] ?? channels[0];
  const step = Math.max(1, Math.floor(length / 220000));
  let leftSquares = 0;
  let rightSquares = 0;
  let cross = 0;
  let midSquares = 0;
  let sideSquares = 0;
  let count = 0;

  for (let index = 0; index < length; index += step) {
    const l = left[index] ?? 0;
    const r = right[index] ?? l;
    const mid = (l + r) * 0.5;
    const side = (l - r) * 0.5;
    leftSquares += l * l;
    rightSquares += r * r;
    cross += l * r;
    midSquares += mid * mid;
    sideSquares += side * side;
    count += 1;
  }

  const lrCorrelation = cross / Math.max(1e-12, Math.sqrt(leftSquares * rightSquares));
  const sideMidRatioDb = ampToDb(Math.sqrt(sideSquares / Math.max(1, count))) - ampToDb(Math.sqrt(midSquares / Math.max(1, count)));
  return {
    lrCorrelation: round2(clamp(lrCorrelation, -1, 1)),
    sideMidRatioDb: round1(clamp(sideMidRatioDb, -48, 12)),
  };
}

function estimateFrequencyDb(channels: Float32Array[], sampleRate: number, length: number, frequency: number) {
  const nyquist = sampleRate / 2;
  const targetFrequency = Math.min(Math.max(20, frequency), Math.max(20, nyquist - 100));
  const windowSize = Math.min(2048, Math.max(256, Math.floor(length / 2)));
  if (length < 8 || windowSize < 8) return -96;

  const durationSec = length / sampleRate;
  const frameCount = Math.max(4, Math.min(80, Math.floor(durationSec)));
  const omega = (2 * Math.PI * targetFrequency) / sampleRate;
  let magnitudeSum = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frameCount === 1 ? 0 : Math.floor((frame / (frameCount - 1)) * Math.max(0, length - windowSize));
    let real = 0;
    let imag = 0;
    for (let offset = 0; offset < windowSize; offset += 1) {
      const sample = averageSample(channels, start + offset);
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * offset) / Math.max(1, windowSize - 1));
      const value = sample * window;
      real += value * Math.cos(omega * offset);
      imag -= value * Math.sin(omega * offset);
    }
    magnitudeSum += Math.sqrt(real * real + imag * imag) / (windowSize * 0.5);
  }

  return round1(ampToDb(magnitudeSum / Math.max(1, frameCount)));
}

function estimateFrequencySideMidDb(channels: Float32Array[], sampleRate: number, length: number, frequency: number) {
  const left = channels[0];
  const right = channels[1] ?? channels[0];
  if (!left || !right || channels.length < 2) return -48;
  const nyquist = sampleRate / 2;
  const targetFrequency = Math.min(Math.max(20, frequency), Math.max(20, nyquist - 100));
  const windowSize = Math.min(2048, Math.max(256, Math.floor(length / 2)));
  if (length < 8 || windowSize < 8) return -48;

  const durationSec = length / sampleRate;
  const frameCount = Math.max(4, Math.min(48, Math.floor(durationSec)));
  const omega = (2 * Math.PI * targetFrequency) / sampleRate;
  let midMagnitudeSum = 0;
  let sideMagnitudeSum = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    const start = frameCount === 1 ? 0 : Math.floor((frame / (frameCount - 1)) * Math.max(0, length - windowSize));
    let midReal = 0;
    let midImag = 0;
    let sideReal = 0;
    let sideImag = 0;
    for (let offset = 0; offset < windowSize; offset += 1) {
      const l = left[start + offset] ?? 0;
      const r = right[start + offset] ?? l;
      const mid = (l + r) * 0.5;
      const side = (l - r) * 0.5;
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * offset) / Math.max(1, windowSize - 1));
      const cos = Math.cos(omega * offset);
      const sin = Math.sin(omega * offset);
      midReal += mid * window * cos;
      midImag -= mid * window * sin;
      sideReal += side * window * cos;
      sideImag -= side * window * sin;
    }
    midMagnitudeSum += Math.sqrt(midReal * midReal + midImag * midImag) / (windowSize * 0.5);
    sideMagnitudeSum += Math.sqrt(sideReal * sideReal + sideImag * sideImag) / (windowSize * 0.5);
  }

  return clamp(
    ampToDb(sideMagnitudeSum / Math.max(1, frameCount)) - ampToDb(midMagnitudeSum / Math.max(1, frameCount)),
    -48,
    12,
  );
}

function averageSample(channels: Float32Array[], index: number) {
  let sum = 0;
  for (const channel of channels) {
    sum += channel[index] ?? 0;
  }
  return sum / Math.max(1, channels.length);
}

function averageDb(values: number[]) {
  const powers = values.map((value) => 10 ** (value / 10));
  const average = powers.reduce((sum, value) => sum + value, 0) / Math.max(1, powers.length);
  return round1(10 * Math.log10(Math.max(1e-12, average)));
}

function estimateCentroidHz(bandEnergyDb: Record<string, number>) {
  let weighted = 0;
  let total = 0;
  for (const band of ANALYSIS_BANDS) {
    const energy = 10 ** ((bandEnergyDb[band.id] ?? -96) / 10);
    weighted += band.center * energy;
    total += energy;
  }
  return total > 0 ? Math.round(weighted / total) : 1000;
}

function estimateFlatness(bandEnergyDb: Record<string, number>) {
  const values = ANALYSIS_BANDS.map((band) => 10 ** ((bandEnergyDb[band.id] ?? -96) / 10));
  const gm = Math.exp(values.reduce((sum, value) => sum + Math.log(Math.max(value, 1e-12)), 0) / values.length);
  const am = values.reduce((sum, value) => sum + value, 0) / values.length;
  return round2(am > 0 ? clamp(gm / am, 0, 1) : 0);
}

function ampToDb(value: number) {
  return 20 * Math.log10(Math.max(1e-9, Math.abs(value)));
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

