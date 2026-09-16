import type { Clip } from "@/daw/model/Project";
import { createSpectralRepairRegion, type RepairAnalysisBand, type SpectralRepairRegion } from "@/daw/repair/repairTypes";
import { clamp, gainToDb, rmsOfChannel, sanitizeFloat32 } from "./dspMath";

export type RepairAnalysisFrame = {
  startSec: number;
  endSec: number;
  scores: Partial<Record<RepairAnalysisBand, number>>;
  peakHz?: number;
  rms?: number;
  peak?: number;
  crest?: number;
  spectralCentroid?: number;
  spectralFlux?: number;
  stereoCorrelation?: number;
};

export type RepairAnalysisResult = {
  frames: RepairAnalysisFrame[];
  warnings: string[];
  summary: Partial<Record<RepairAnalysisBand, number>>;
};

export function analyzeRepairIssues(
  channels: Float32Array[],
  sampleRate: number,
  options: { startSec?: number; durationSec?: number; frameMs?: number } = {},
): RepairAnalysisResult {
  const warnings: string[] = [];
  const length = channels[0]?.length ?? 0;
  const start = Math.floor(clamp((options.startSec ?? 0) * sampleRate, 0, length));
  const durationFrames = Math.floor(clamp((options.durationSec ?? length / sampleRate) * sampleRate, 1, length - start));
  const end = Math.min(length, start + durationFrames);
  const frameSize = Math.max(256, Math.floor(((options.frameMs ?? 46) / 1000) * sampleRate));
  const hop = Math.max(128, Math.floor(frameSize / 2));
  if ((end - start) / sampleRate > 30) warnings.push("Analysis range is longer than 30s; v0.2a uses lightweight frame analysis only.");

  const frames: RepairAnalysisFrame[] = [];
  for (let offset = start; offset < end; offset += hop) {
    const frameEnd = Math.min(end, offset + frameSize);
    const left = channels[0]?.subarray(offset, frameEnd) ?? new Float32Array();
    const right = channels[1]?.subarray(offset, frameEnd);
    const rms = rmsOfChannel(left);
    const peak = peakAbs(left);
    const diffScore = transientDiffScore(left, rms);
    const crest = gainToDb(peak / Math.max(1e-9, rms));
    const lowSub = bandScore(left, sampleRate, 30);
    const lowMud = (bandScore(left, sampleRate, 220) + bandScore(left, sampleRate, 360)) * 0.5;
    const harsh = (bandScore(left, sampleRate, 3000) + bandScore(left, sampleRate, 4500) + bandScore(left, sampleRate, 6200)) / 3;
    const sibilance = (bandScore(left, sampleRate, 6500) + bandScore(left, sampleRate, 8500)) * 0.5;
    const chirp = (bandScore(left, sampleRate, 9000) + bandScore(left, sampleRate, 12000)) * 0.5;
    const flux = spectralFluxLite(left);
    const correlation = right ? stereoCorrelation(left, right) : undefined;
    const sideLow = right ? lowSideScore(left, right, sampleRate) : 0;
    const scores: RepairAnalysisFrame["scores"] = {
      clipping: clamp(countAbove(left, 0.98) * 18, 0, 1),
      click: clamp(diffScore * 1.4, 0, 1),
      crackle: clamp(diffScore * 0.45 + flux * 0.25, 0, 1),
      sibilance: clamp((sibilance - harsh * 0.35) * 2.2, 0, 1),
      harshness: clamp(harsh * 1.85, 0, 1),
      chirp: clamp(chirp * 1.7 + flux * 0.22, 0, 1),
      low_sub: clamp(lowSub * 2.4, 0, 1),
      low_mud: clamp(lowMud * 1.65, 0, 1),
      low_side: clamp(sideLow * 2.3, 0, 1),
      phase_risk: typeof correlation === "number" ? clamp((0.15 - correlation) * 2.2, 0, 1) : 0,
    };
    frames.push({
      startSec: offset / sampleRate,
      endSec: frameEnd / sampleRate,
      scores,
      peakHz: strongestApproxHz(left, sampleRate),
      rms,
      peak,
      crest,
      spectralFlux: flux,
      stereoCorrelation: correlation,
    });
  }

  const summary: RepairAnalysisResult["summary"] = {};
  for (const frame of frames) {
    for (const [band, score] of Object.entries(frame.scores) as Array<[RepairAnalysisBand, number]>) {
      summary[band] = Math.max(summary[band] ?? 0, score);
    }
  }
  return { frames, warnings, summary };
}

export function createRepairRegionsFromAnalysis(input: {
  analysis: RepairAnalysisResult;
  clip: Clip;
  fileId: string;
  trackId: string;
  maxRegions?: number;
  minScore?: number;
}): SpectralRepairRegion[] {
  const minScore = input.minScore ?? 0.62;
  const regions: SpectralRepairRegion[] = [];
  const bands: RepairAnalysisBand[] = ["click", "crackle", "sibilance", "harshness", "chirp", "low_sub", "low_mud", "low_side", "phase_risk", "clipping"];
  for (const band of bands) {
    const grouped = groupFrames(input.analysis.frames, band, minScore);
    for (const group of grouped) {
      const defaults = defaultsForBand(band);
      regions.push(createSpectralRepairRegion({
        fileId: input.fileId,
        clipId: input.clip.id,
        trackId: input.trackId,
        problemType: defaults.problemType,
        operation: defaults.operation,
        startSec: input.clip.timelineStartSec + group.startSec,
        endSec: input.clip.timelineStartSec + group.endSec,
        lowHz: defaults.lowHz,
        highHz: defaults.highHz,
        amountDb: defaults.amountDb,
        strength: clamp(group.score * defaults.strength, 0.18, defaults.strength),
        confidence: clamp(group.score, 0, 1),
        featherTimeMs: defaults.featherTimeMs,
        protectVocal: defaults.protectVocal,
        protectDrumAttack: defaults.protectDrumAttack,
        analysisSource: { band, score: group.score, createdAt: new Date().toISOString(), fftSize: 0 },
      }));
      if (regions.length >= (input.maxRegions ?? 20)) return regions;
    }
  }
  return regions;
}

function groupFrames(frames: RepairAnalysisFrame[], band: RepairAnalysisBand, minScore: number) {
  const groups: Array<{ startSec: number; endSec: number; score: number }> = [];
  let active: { startSec: number; endSec: number; score: number; count: number } | null = null;
  for (const frame of frames) {
    const score = frame.scores[band] ?? 0;
    if (score >= minScore) {
      if (!active) active = { startSec: frame.startSec, endSec: frame.endSec, score, count: 1 };
      else {
        active.endSec = frame.endSec;
        active.score += score;
        active.count += 1;
      }
    } else if (active) {
      groups.push({ startSec: active.startSec, endSec: active.endSec, score: active.score / active.count });
      active = null;
    }
  }
  if (active) groups.push({ startSec: active.startSec, endSec: active.endSec, score: active.score / active.count });
  return groups.map((group) => ({ ...group, endSec: Math.max(group.startSec + 0.04, group.endSec) })).slice(0, 20);
}

function defaultsForBand(band: RepairAnalysisBand): Pick<SpectralRepairRegion, "problemType" | "operation" | "lowHz" | "highHz" | "amountDb" | "strength" | "featherTimeMs" | "protectVocal" | "protectDrumAttack"> {
  if (band === "click" || band === "clipping") return { problemType: "click", operation: "declick_lite", lowHz: 1200, highHz: 18000, amountDb: -6, strength: 0.42, featherTimeMs: 8, protectDrumAttack: true };
  if (band === "crackle") return { problemType: "hiss", operation: "decrackle_lite", lowHz: 3000, highHz: 14000, amountDb: -2.4, strength: 0.34, featherTimeMs: 20 };
  if (band === "sibilance") return { problemType: "sibilance", operation: "deess_lite", lowHz: 4500, highHz: 9500, amountDb: -3, strength: 0.4, featherTimeMs: 28, protectVocal: true };
  if (band === "harshness") return { problemType: "metallic_high", operation: "deharsh_lite", lowHz: 2500, highHz: 6500, amountDb: -2.2, strength: 0.36, featherTimeMs: 32, protectVocal: true };
  if (band === "chirp") return { problemType: "metallic_high", operation: "dechirp_lite", lowHz: 6500, highHz: 14000, amountDb: -2.8, strength: 0.38, featherTimeMs: 35, protectVocal: true, protectDrumAttack: true };
  if (band === "low_sub" || band === "low_side" || band === "phase_risk") return { problemType: "low_end_blur", operation: "lowend_tighten_lite", lowHz: 20, highHz: 140, amountDb: -2, strength: 0.34, featherTimeMs: 45 };
  return { problemType: "mud", operation: "attenuate", lowHz: 160, highHz: 420, amountDb: -1.4, strength: 0.35, featherTimeMs: 45 };
}

function bandScore(channel: Float32Array, sampleRate: number, frequency: number) {
  if (channel.length === 0) return 0;
  let real = 0;
  let imag = 0;
  for (let index = 0; index < channel.length; index += 1) {
    const angle = (2 * Math.PI * frequency * index) / Math.max(1, sampleRate);
    const sample = sanitizeFloat32(channel[index] ?? 0);
    real += sample * Math.cos(angle);
    imag -= sample * Math.sin(angle);
  }
  return clamp(Math.hypot(real, imag) / Math.max(1, channel.length) * 4, 0, 1);
}

function transientDiffScore(channel: Float32Array, rms: number) {
  let maxDiff = 0;
  for (let index = 1; index < channel.length; index += 1) maxDiff = Math.max(maxDiff, Math.abs((channel[index] ?? 0) - (channel[index - 1] ?? 0)));
  return clamp(maxDiff / Math.max(0.08, rms * 6), 0, 1);
}

function spectralFluxLite(channel: Float32Array) {
  let total = 0;
  for (let index = 2; index < channel.length; index += 1) total += Math.abs((channel[index] ?? 0) - 2 * (channel[index - 1] ?? 0) + (channel[index - 2] ?? 0));
  return clamp(total / Math.max(1, channel.length) * 8, 0, 1);
}

function strongestApproxHz(channel: Float32Array, sampleRate: number) {
  const probes = [60, 120, 250, 500, 1000, 3000, 5000, 8000, 10000, 14000];
  let bestHz = probes[0];
  let bestScore = 0;
  for (const hz of probes) {
    const score = bandScore(channel, sampleRate, hz);
    if (score > bestScore) {
      bestScore = score;
      bestHz = hz;
    }
  }
  return bestHz;
}

function peakAbs(channel: Float32Array) {
  let peak = 0;
  for (const sample of channel) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

function countAbove(channel: Float32Array, threshold: number) {
  let count = 0;
  for (const sample of channel) if (Math.abs(sample) >= threshold) count += 1;
  return count / Math.max(1, channel.length);
}

function stereoCorrelation(left: Float32Array, right: Float32Array) {
  let lr = 0;
  let ll = 0;
  let rr = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const l = left[index] ?? 0;
    const r = right[index] ?? 0;
    lr += l * r;
    ll += l * l;
    rr += r * r;
  }
  return clamp(lr / Math.sqrt(Math.max(1e-12, ll * rr)), -1, 1);
}

function lowSideScore(left: Float32Array, right: Float32Array, sampleRate: number) {
  const length = Math.min(left.length, right.length);
  const side = new Float32Array(length);
  const mid = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    mid[index] = ((left[index] ?? 0) + (right[index] ?? 0)) * 0.5;
    side[index] = ((left[index] ?? 0) - (right[index] ?? 0)) * 0.5;
  }
  const sideLow = bandScore(side, sampleRate, 80);
  const midLow = bandScore(mid, sampleRate, 80);
  return clamp(sideLow / Math.max(0.05, midLow), 0, 1);
}