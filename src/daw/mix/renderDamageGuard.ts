import type { ABCompareReport, DamageGuardReport, PerceptualScoreReport } from "./mixDoctorTypes";
import { evaluateDamageGuard } from "./damageGuard";

type RenderedBufferLike = {
  readonly length: number;
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  getChannelData(channel: number): Float32Array;
};

export type RenderedAudioMetrics = {
  peakDb: number;
  rmsDb: number;
  crestFactorDb: number;
  lowDb: number;
  lowMidDb: number;
  presenceDb: number;
  highDb: number;
  airDb: number;
  sideMidRatioDb: number;
  correlation: number;
};

export function buildRenderedDamageGuard(
  beforeBuffer: RenderedBufferLike,
  afterBuffer: RenderedBufferLike,
  targetIds: string[],
): {
  damageGuardReport: DamageGuardReport;
  abCompareReport: ABCompareReport;
  beforeMetrics: RenderedAudioMetrics;
  afterMetrics: RenderedAudioMetrics;
} {
  const beforeMetrics = analyzeRenderedBuffer(beforeBuffer);
  const afterMetrics = analyzeRenderedBuffer(afterBuffer);
  const beforeScore = metricsToPerceptualScore(beforeMetrics);
  const afterScore = metricsToPerceptualScore(afterMetrics);
  const damageGuardReport = evaluateDamageGuard(beforeScore, afterScore, targetIds);
  const gainCompensationDb = round1(beforeMetrics.rmsDb - afterMetrics.rmsDb);

  return {
    damageGuardReport: {
      ...damageGuardReport,
      warnings: [
        "Render Guard compared actual offline-rendered before/after audio.",
        ...damageGuardReport.warnings,
      ],
    },
    abCompareReport: {
      beforeLabel: "Rendered Before",
      afterLabel: "Rendered After",
      loudnessMatched: Math.abs(gainCompensationDb) <= 0.75,
      gainCompensationDb,
      notes: [
        `Before RMS ${beforeMetrics.rmsDb.toFixed(1)} dB / After RMS ${afterMetrics.rmsDb.toFixed(1)} dB`,
        `Before peak ${beforeMetrics.peakDb.toFixed(1)} dB / After peak ${afterMetrics.peakDb.toFixed(1)} dB`,
        "A/B judgment should use the gain compensation above if loudness differs.",
      ],
    },
    beforeMetrics,
    afterMetrics,
  };
}

export function analyzeRenderedBuffer(buffer: RenderedBufferLike): RenderedAudioMetrics {
  const channels = getChannels(buffer);
  const scan = scanTimeDomain(channels, buffer.length);
  const lowDb = averageDb([
    estimateBandDb(channels, buffer.sampleRate, buffer.length, 60),
    estimateBandDb(channels, buffer.sampleRate, buffer.length, 100),
  ]);
  const lowMidDb = averageDb([
    estimateBandDb(channels, buffer.sampleRate, buffer.length, 220),
    estimateBandDb(channels, buffer.sampleRate, buffer.length, 420),
  ]);
  const presenceDb = averageDb([
    estimateBandDb(channels, buffer.sampleRate, buffer.length, 2500),
    estimateBandDb(channels, buffer.sampleRate, buffer.length, 3600),
  ]);
  const highDb = averageDb([
    estimateBandDb(channels, buffer.sampleRate, buffer.length, 6500),
    estimateBandDb(channels, buffer.sampleRate, buffer.length, 9000),
  ]);
  const airDb = estimateBandDb(channels, buffer.sampleRate, buffer.length, 12000);

  return {
    peakDb: ampToDb(scan.peak),
    rmsDb: ampToDb(scan.rms),
    crestFactorDb: round1(Math.max(0, ampToDb(scan.peak) - ampToDb(scan.rms))),
    lowDb,
    lowMidDb,
    presenceDb,
    highDb,
    airDb,
    sideMidRatioDb: scan.sideMidRatioDb,
    correlation: scan.correlation,
  };
}

function metricsToPerceptualScore(metrics: RenderedAudioMetrics): PerceptualScoreReport {
  const peakSafety = clamp(100 - Math.max(0, metrics.peakDb + 1) * 30 - Math.max(0, 6 - metrics.crestFactorDb) * 4, 0, 100);
  const harshnessRisk = clamp(35 + Math.max(0, metrics.highDb - metrics.lowMidDb) * 5 + Math.max(0, metrics.airDb - metrics.presenceDb) * 4, 0, 100);
  const mudRisk = clamp(35 + Math.max(0, metrics.lowMidDb - metrics.presenceDb) * 4 + Math.max(0, metrics.lowDb - metrics.lowMidDb - 4) * 2, 0, 100);
  const clarity = clamp(74 + (metrics.presenceDb - metrics.lowMidDb) * 3 - Math.max(0, metrics.highDb - metrics.presenceDb) * 2, 0, 100);
  const body = clamp(70 + (metrics.lowMidDb - metrics.highDb) * 1.5 - Math.max(0, metrics.lowMidDb - metrics.presenceDb - 10) * 1.5, 0, 100);
  const stereoImage = clamp(58 + (metrics.sideMidRatioDb + 18) * 1.8 - Math.max(0, 0.15 - Math.abs(metrics.correlation)) * 18, 0, 100);
  const overall = round1((clarity + body + stereoImage + peakSafety + (100 - harshnessRisk) + (100 - mudRisk)) / 6);

  return {
    overall,
    clarity: round1(clarity),
    body: round1(body),
    vocalFocus: round1(clarity),
    lowEndTightness: round1(clamp(100 - mudRisk + Math.max(0, metrics.lowDb - metrics.lowMidDb) * 0.5, 0, 100)),
    stereoImage: round1(stereoImage),
    harshness: round1(harshnessRisk),
    mud: round1(mudRisk),
    reverbCleanliness: round1(clamp(100 - Math.max(0, 7 - metrics.crestFactorDb) * 8, 0, 100)),
    aiArtifact: round1(clamp(100 - harshnessRisk * 0.35, 0, 100)),
    peakSafety: round1(peakSafety),
    notes: ["Measured from offline-rendered audio."],
  };
}

function getChannels(buffer: RenderedBufferLike) {
  const count = Math.max(1, buffer.numberOfChannels);
  return Array.from({ length: count }, (_, index) => buffer.getChannelData(index));
}

function scanTimeDomain(channels: Float32Array[], length: number) {
  const step = Math.max(1, Math.floor(length / 120000));
  let peak = 0;
  let sumSquares = 0;
  let count = 0;
  let midSquares = 0;
  let sideSquares = 0;
  let leftSquares = 0;
  let rightSquares = 0;
  let cross = 0;
  const left = channels[0];
  const right = channels[1] ?? channels[0];

  for (let index = 0; index < length; index += step) {
    const l = left[index] ?? 0;
    const r = right[index] ?? l;
    const mono = (l + r) * 0.5;
    const mid = (l + r) * 0.5;
    const side = (l - r) * 0.5;
    peak = Math.max(peak, Math.abs(l), Math.abs(r));
    sumSquares += mono * mono;
    midSquares += mid * mid;
    sideSquares += side * side;
    leftSquares += l * l;
    rightSquares += r * r;
    cross += l * r;
    count += 1;
  }

  const rms = Math.sqrt(sumSquares / Math.max(1, count));
  const sideMidRatioDb = ampToDb(Math.sqrt(sideSquares / Math.max(1, count))) - ampToDb(Math.sqrt(midSquares / Math.max(1, count)));
  const correlation = cross / Math.max(1e-9, Math.sqrt(leftSquares * rightSquares));
  return {
    peak: Math.max(peak, 1e-9),
    rms: Math.max(rms, 1e-9),
    sideMidRatioDb: round1(clamp(sideMidRatioDb, -48, 12)),
    correlation: round2(clamp(correlation, -1, 1)),
  };
}

function estimateBandDb(channels: Float32Array[], sampleRate: number, length: number, frequency: number) {
  const nyquist = sampleRate / 2;
  const targetFrequency = Math.min(frequency, Math.max(20, nyquist - 200));
  const windowSize = getFrequencyWindowSize(length, sampleRate, targetFrequency);
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
      const index = start + offset;
      const sample = averageSample(channels, index);
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * offset) / Math.max(1, windowSize - 1));
      const value = sample * window;
      real += value * Math.cos(omega * offset);
      imag -= value * Math.sin(omega * offset);
    }
    magnitudeSum += Math.sqrt(real * real + imag * imag) / (windowSize * 0.5);
  }

  return round1(ampToDb(magnitudeSum / Math.max(1, frameCount)));
}

function getFrequencyWindowSize(length: number, sampleRate: number, frequency: number) {
  if (length < 8) return 0;
  const maxWindow = Math.max(8, Math.min(length, Math.floor(length / 2)));
  const minWindow = Math.min(256, maxWindow);
  const cycles = frequency <= 120 ? 5 : frequency <= 250 ? 4 : 3;
  const cycleWindow = Math.ceil((sampleRate / Math.max(20, frequency)) * cycles);
  return Math.max(8, Math.min(maxWindow, Math.max(minWindow, Math.min(8192, cycleWindow))));
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
