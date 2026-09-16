import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import type { BandEnergyMap, BandSideMidMap, MixDoctorBandId, StemFeatureReport } from "./mixDoctorTypes";
import type { StemRole, Track } from "@/daw/model/Project";
import { estimateIntegratedLufsApproxFromRms } from "./loudnessApprox";

export const BAND_DEFS: Array<{ id: MixDoctorBandId; low: number; high: number; center: number }> = [
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

const DEFAULT_BAND_LEVEL: BandEnergyMap = {
  "20-35": -18,
  "35-60": -16,
  "60-120": -14,
  "120-250": -12,
  "250-500": -10,
  "500-900": -11,
  "900-1500": -10,
  "1500-3000": -9,
  "3000-5000": -10,
  "5000-9000": -12,
  "9000-12000": -14,
  "12000-16000": -16,
  "16000-20000": -18,
};

export function emptyBandEnergyMap(value = -18): BandEnergyMap {
  return BAND_DEFS.reduce((acc, band) => {
    acc[band.id] = value;
    return acc;
  }, {} as BandEnergyMap);
}

export function cloneBandEnergyMap(value: BandEnergyMap): BandEnergyMap {
  return BAND_DEFS.reduce((acc, band) => {
    acc[band.id] = value[band.id];
    return acc;
  }, {} as BandEnergyMap);
}

export function createRoleBandProfile(role: StemRole): BandEnergyMap {
  const profile = cloneBandEnergyMap(DEFAULT_BAND_LEVEL);

  if (role === "vocal") {
    profile["250-500"] = -12;
    profile["500-900"] = -9;
    profile["900-1500"] = -6;
    profile["1500-3000"] = -3;
    profile["3000-5000"] = -4;
    profile["5000-9000"] = -7;
    profile["9000-12000"] = -8;
    profile["12000-16000"] = -11;
  } else if (role === "backingVocal") {
    profile["250-500"] = -12;
    profile["500-900"] = -10;
    profile["900-1500"] = -7;
    profile["1500-3000"] = -5;
    profile["3000-5000"] = -6;
    profile["5000-9000"] = -8;
    profile["9000-12000"] = -10;
  } else if (role === "drums") {
    profile["20-35"] = -12;
    profile["35-60"] = -6;
    profile["60-120"] = -4;
    profile["120-250"] = -9;
    profile["250-500"] = -11;
    profile["3000-5000"] = -7;
    profile["5000-9000"] = -6;
    profile["9000-12000"] = -8;
  } else if (role === "bass") {
    profile["20-35"] = -9;
    profile["35-60"] = -4;
    profile["60-120"] = -3;
    profile["120-250"] = -5;
    profile["250-500"] = -10;
    profile["500-900"] = -12;
    profile["900-1500"] = -13;
  } else if (role === "guitar") {
    profile["120-250"] = -12;
    profile["250-500"] = -8;
    profile["500-900"] = -6;
    profile["900-1500"] = -5;
    profile["1500-3000"] = -4;
    profile["3000-5000"] = -5;
    profile["5000-9000"] = -7;
  } else if (role === "synth" || role === "keys" || role === "music" || role === "loop" || role === "fx") {
    profile["120-250"] = -13;
    profile["250-500"] = -9;
    profile["500-900"] = -7;
    profile["900-1500"] = -6;
    profile["1500-3000"] = -5;
    profile["3000-5000"] = -5;
    profile["5000-9000"] = -6;
    profile["9000-12000"] = -8;
    profile["12000-16000"] = -10;
  }

  return profile;
}

export function summaryFromPeakSummary(summary: PeakSummary) {
  let peak = 0.00001;
  let rmsSum = 0;
  let bins = 0;

  for (let index = 0; index < summary.bins; index += 1) {
    const high = Math.abs(summary.max[index] ?? 0);
    const low = Math.abs(summary.min[index] ?? 0);
    const binPeak = Math.max(high, low);
    peak = Math.max(peak, binPeak);
    rmsSum += Math.pow((high + low) / 2, 2);
    bins += 1;
  }

  const rms = Math.max(0.00001, Math.sqrt(rmsSum / Math.max(1, bins)));
  return { peak, rms };
}

export function ampToDb(value: number) {
  return 20 * Math.log10(Math.max(0.00001, value));
}

export function dbToAmp(value: number) {
  return 10 ** (value / 20);
}

export function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function round1(value: number) {
  return Math.round(value * 10) / 10;
}

export function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function getBandCenterHz(bandId: MixDoctorBandId) {
  return BAND_DEFS.find((band) => band.id === bandId)?.center ?? 1000;
}

export function getBandKeys() {
  return BAND_DEFS.map((band) => band.id);
}

export function applyTrackToneToBands(track: Track, baseBandEnergy: BandEnergyMap) {
  const bands = cloneBandEnergyMap(baseBandEnergy);
  const highBoost = track.eq.bands.reduce((sum, band) => {
    if (!band.enabled || band.frequency < 2500) return sum;
    return sum + Math.max(0, band.gainDb);
  }, 0);
  const lowBoost = track.eq.bands.reduce((sum, band) => {
    if (!band.enabled || band.frequency > 180) return sum;
    return sum + Math.max(0, band.gainDb);
  }, 0);
  const midCut = track.eq.bands.reduce((sum, band) => {
    if (!band.enabled || band.type !== "peaking") return sum;
    if (band.frequency < 250 || band.frequency > 5000) return sum;
    return sum + Math.max(0, -band.gainDb);
  }, 0);
  const hpf = track.eq.bands.find((band) => band.enabled && band.type === "highpass");
  const shelfLow = track.eq.bands.find((band) => band.enabled && band.type === "lowshelf");
  const shelfHigh = track.eq.bands.find((band) => band.enabled && band.type === "highshelf");
  const presenceBoost = track.eq.bands.reduce((sum, band) => {
    if (!band.enabled || band.frequency < 1500 || band.frequency > 5000) return sum;
    return sum + Math.max(0, band.gainDb);
  }, 0);

  for (const band of BAND_DEFS) {
    let delta = 0;
    if (band.center <= 35) delta += lowBoost * 1.5;
    if (band.center <= 120) delta += lowBoost * 1.1;
    if (band.center >= 2500) delta += highBoost * 1.15;
    if (band.center >= 5000) delta += highBoost * 1.3;
    if (band.center >= 9000) delta += highBoost * 1.45;
    if (band.center >= 1500 && band.center <= 5000) delta += presenceBoost * 0.7;
    if (band.center >= 250 && band.center <= 1500) delta -= midCut * 0.35;
    if (hpf && band.center < hpf.frequency) delta -= 5;
    if (shelfLow && band.center <= 250) delta += Math.max(0, shelfLow.gainDb) * 1.3;
    if (shelfHigh && band.center >= 9000) delta += Math.max(0, shelfHigh.gainDb) * 1.25;
    bands[band.id] = round1(clamp(baseBandEnergy[band.id] + delta, -24, 0));
  }

  return bands;
}

export function estimateCentroidHz(bandEnergyDb: BandEnergyMap) {
  let weighted = 0;
  let total = 0;
  for (const band of BAND_DEFS) {
    const level = dbToAmp(bandEnergyDb[band.id] + 24);
    weighted += band.center * level;
    total += level;
  }
  return total > 0 ? weighted / total : 1000;
}

export function estimateFlatness(bandEnergyDb: BandEnergyMap) {
  const values = BAND_DEFS.map((band) => dbToAmp(bandEnergyDb[band.id] + 24));
  const gm = Math.exp(values.reduce((sum, value) => sum + Math.log(Math.max(value, 0.00001)), 0) / values.length);
  const am = values.reduce((sum, value) => sum + value, 0) / values.length;
  return am > 0 ? clamp(gm / am, 0, 1) : 0;
}

export function mapBandEnergyEnergy(track: Track, summary: PeakSummary) {
  if (summary.bandEnergyDb) {
    return applyTrackToneToBands(track, normalizeMeasuredBands(summary.bandEnergyDb, summaryFromPeakSummary(summary)));
  }

  const summaryStats = summaryFromPeakSummary(summary);
  const base = createRoleBandProfile(track.role);
  const levelOffset = ampToDb(summaryStats.rms) - 12;
  const peakOffset = ampToDb(summaryStats.peak) - 3;
  const raw = cloneBandEnergyMap(base);

  for (const band of BAND_DEFS) {
    const levelBias = band.center <= 120 ? peakOffset * 0.35 : band.center <= 500 ? levelOffset * 0.45 : levelOffset * 0.5;
    raw[band.id] = round1(clamp(base[band.id] + levelBias, -24, 0));
  }

  return applyTrackToneToBands(track, raw);
}

export function makeStemFeatureReport(track: Track, summary: PeakSummary | null | undefined, trackIndex = 0): StemFeatureReport {
  const safeSummary = summary ?? {
    bins: 32,
    min: new Array<number>(32).fill(-0.15),
    max: new Array<number>(32).fill(0.15),
    durationSec: 0,
  };
  const stats = summaryFromPeakSummary(safeSummary);
  const trackGainDb = Number.isFinite(track.gainDb) ? track.gainDb : 0;
  const rmsDb = ampToDb(stats.rms) + trackGainDb;
  const peakDb = ampToDb(stats.peak) + trackGainDb;
  const truePeakApproxDb = peakDb + 0.2;
  const crestFactorDb = Math.max(0, peakDb - rmsDb);
  const rawBandEnergyDb = mapBandEnergyEnergy(track, safeSummary);
  const bandEnergyDb = Object.fromEntries(
    Object.entries(rawBandEnergyDb).map(([key, value]) => [key, round1(clamp(value + trackGainDb, -36, 6))]),
  ) as BandEnergyMap;
  const spectralCentroidHz = safeSummary.spectralCentroidHz ?? estimateCentroidHz(bandEnergyDb);
  const spectralFlatness = safeSummary.spectralFlatness ?? estimateFlatness(bandEnergyDb);
  const lrCorrelation = safeSummary.lrCorrelation ?? estimateCorrelation(track, trackIndex);
  const sideMidRatioDb = safeSummary.sideMidRatioDb ?? estimateSideMidRatio(track, bandEnergyDb);
  const bandSideMidDb = normalizeMeasuredSideBands(safeSummary.bandSideMidDb);
  const stereoWidthScore = round1(clamp((sideMidRatioDb + 24) * 2.8 + Math.max(0, 1 - lrCorrelation) * 24 + Math.abs(track.pan) * 32, 0, 100));
  const integratedLufsApprox = estimateIntegratedLufsApproxFromRms(rmsDb);

  return {
    stemId: track.id,
    trackId: track.id,
    trackName: track.name,
    role: track.role,
    rmsDb: round1(rmsDb),
    peakDb: round1(peakDb),
    truePeakApproxDb: round1(truePeakApproxDb),
    crestFactorDb: round1(crestFactorDb),
    integratedLufsApprox: round1(integratedLufsApprox),
    lrCorrelation: round2(lrCorrelation),
    sideMidRatioDb: round1(sideMidRatioDb),
    stereoWidthScore: round1(stereoWidthScore),
    spectralCentroidHz: round0(spectralCentroidHz),
    spectralFlatness: round2(spectralFlatness),
    bandEnergyDb,
    ...(bandSideMidDb ? { bandSideMidDb } : {}),
    notes: [],
  };
}

function normalizeMeasuredSideBands(measuredBands: Record<string, number> | undefined): BandSideMidMap | undefined {
  if (!measuredBands) return undefined;
  const keys: Array<keyof BandSideMidMap> = [
    "low_20_120",
    "lowMid_120_500",
    "mid_500_2000",
    "presence_2000_5000",
    "air_5000_10000",
    "gloss_9000_14000",
    "ultraAir_10000_20000",
    "sheen_14000_20000",
  ];
  const out: BandSideMidMap = {};
  for (const key of keys) {
    const value = measuredBands[key];
    if (Number.isFinite(value)) out[key] = round1(clamp(Number(value), -48, 12));
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeMeasuredBands(measuredBands: Record<string, number>, stats: { rms: number; peak: number }): BandEnergyMap {
  const fallback = emptyBandEnergyMap(-18);
  const measuredValues = BAND_DEFS.map((band) => measuredBands[band.id]).filter((value): value is number => Number.isFinite(value));
  if (measuredValues.length === 0) return fallback;

  const measuredMedian = median(measuredValues);
  const rmsAnchor = clamp(ampToDb(stats.rms) + 18, -18, 3);
  return BAND_DEFS.reduce((acc, band) => {
    const measured = measuredBands[band.id];
    const normalized = Number.isFinite(measured) ? measured - measuredMedian + rmsAnchor : fallback[band.id];
    acc[band.id] = round1(clamp(normalized, -24, 0));
    return acc;
  }, {} as BandEnergyMap);
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? sorted[middle] ?? 0) + (sorted[middle] ?? 0)) / 2
    : sorted[middle] ?? 0;
}

function estimateCorrelation(track: Track, trackIndex: number) {
  if (track.role === "reference") return 0.68;
  if (track.role === "bass" || track.role === "drums" || track.role === "vocal") return 0.88 - Math.min(0.22, Math.abs(track.pan) * 0.2);
  const centerPenalty = Math.max(0, 0.18 - Math.abs(track.pan));
  const indexPenalty = trackIndex % 2 === 0 ? 0.03 : 0.05;
  return clamp(0.72 - centerPenalty - indexPenalty, 0.3, 0.96);
}

function estimateSideMidRatio(track: Track, bandEnergyDb: BandEnergyMap) {
  const top = (bandEnergyDb["5000-9000"] + bandEnergyDb["9000-12000"] + bandEnergyDb["12000-16000"]) / 3;
  const mid = (bandEnergyDb["500-900"] + bandEnergyDb["900-1500"] + bandEnergyDb["1500-3000"]) / 3;
  const panLift = Math.abs(track.pan) * 1.8;
  return round1(clamp((top - mid) * 0.55 + panLift, -18, 12));
}

function round0(value: number) {
  return Math.round(value);
}
