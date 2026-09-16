import { gainToDb } from "./pluginDspUtils";

export type PluginBufferMetrics = {
  peak: number;
  peakDb: number;
  rms: number;
  rmsDb: number;
  crestDb: number;
};

export function analyzePluginFloatBuffer(samples: Float32Array): PluginBufferMetrics {
  let peak = 0;
  let sumSquares = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = Number.isFinite(samples[index]) ? samples[index] : 0;
    const abs = Math.abs(value);
    if (abs > peak) peak = abs;
    sumSquares += value * value;
  }
  const rms = Math.sqrt(sumSquares / Math.max(1, samples.length));
  return {
    peak,
    peakDb: gainToDb(peak),
    rms,
    rmsDb: gainToDb(rms),
    crestDb: gainToDb(peak) - gainToDb(rms),
  };
}

export function estimateSideMidRatioDb(left: Float32Array, right: Float32Array): number {
  const length = Math.min(left.length, right.length);
  let mid = 0;
  let side = 0;
  for (let index = 0; index < length; index += 1) {
    const l = Number.isFinite(left[index]) ? left[index] : 0;
    const r = Number.isFinite(right[index]) ? right[index] : 0;
    const m = (l + r) * 0.5;
    const s = (l - r) * 0.5;
    mid += m * m;
    side += s * s;
  }
  const midRms = Math.sqrt(mid / Math.max(1, length));
  const sideRms = Math.sqrt(side / Math.max(1, length));
  return gainToDb(sideRms) - gainToDb(midRms);
}

export function hasInvalidAudioSamples(samples: Float32Array): boolean {
  return samples.some((sample) => !Number.isFinite(sample));
}
