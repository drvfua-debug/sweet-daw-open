import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import type { Clip, Project, StemRole, Track } from "@/daw/model/Project";
import { createSpectralRepairRegion, type RepairProblemType, type SpectralRepairRegion } from "./repairTypes";

export type RepairCandidate = SpectralRepairRegion & {
  score: number;
  reason: string;
};

export function suggestRepairRegionsForClip(
  project: Project,
  clipId: string,
  peaksByFileId: Record<string, PeakSummary>,
): RepairCandidate[] {
  const clip = project.clips.find((candidate) => candidate.id === clipId);
  if (!clip) return [];
  const track = project.tracks.find((candidate) => candidate.id === clip.trackId) ?? null;
  const peaks = peaksByFileId[clip.fileId];
  if (!peaks) return [];

  const candidates: RepairCandidate[] = [];
  const base = {
    fileId: clip.fileId,
    clipId: clip.id,
    trackId: clip.trackId,
    targetLayer: roleToLayer(track?.role ?? clip.role),
    startSec: clip.timelineStartSec,
    endSec: clip.timelineStartSec + Math.min(clip.durationSec, 6),
  } as const;

  const clipping = findPeakRun(peaks, clip, 0.965);
  if (clipping) {
    candidates.push(candidate({
      ...base,
      problemType: "clipping",
      lowHz: 20,
      highHz: 20000,
      startSec: clipping.startSec,
      endSec: clipping.endSec,
      amountDb: -5.5,
      strength: 0.72,
      confidence: 0.82,
      score: 88,
      reason: "Near-full-scale peaks were found in a short window. Marked as a de-click/de-clip candidate for visual review.",
    }));
  }

  const click = findTransientSpike(peaks, clip);
  if (click) {
    candidates.push(candidate({
      ...base,
      problemType: "click",
      lowHz: 1200,
      highHz: 18000,
      startSec: click.startSec,
      endSec: click.endSec,
      amountDb: -4,
      strength: 0.62,
      confidence: 0.68,
      score: 76,
      reason: "A very narrow waveform spike was found. This is a lightweight marker, not destructive audio repair yet.",
    }));
  }

  const bands = peaks.bandEnergyDb ?? {};
  const rumbleDb = avgDb([bands["20-35"], bands["35-60"], bands["60-120"]]);
  const lowMidDb = avgDb([bands["120-250"], bands["250-500"]]);
  const vocalDb = avgDb([bands["1500-3000"], bands["3000-5000"]]);
  const sibilanceDb = avgDb([bands["5000-9000"], bands["9000-12000"]]);
  const metallicDb = avgDb([bands["9000-12000"], bands["12000-16000"], bands["16000-20000"]]);

  if (rumbleDb > lowMidDb + 1.5 || (rumbleDb > -28 && track?.role !== "bass")) {
    candidates.push(candidate({
      ...base,
      problemType: "rumble",
      lowHz: 20,
      highHz: 90,
      amountDb: -2.2,
      strength: 0.48,
      confidence: 0.66,
      score: 70,
      reason: "20-120Hz energy is high compared with the low-mid body. Review before mastering so the limiter is not overfed.",
    }));
  }

  if (lowMidDb > vocalDb + 2.2 || lowMidDb > -22) {
    candidates.push(candidate({
      ...base,
      problemType: "mud",
      lowHz: 180,
      highHz: 520,
      amountDb: -1.6,
      strength: 0.42,
      confidence: 0.63,
      score: 68,
      reason: "180-520Hz appears dense. This marker is for local cleanup, not a broad master cut.",
    }));
  }

  if (sibilanceDb > vocalDb + 1.2 && (track?.role === "vocal" || track?.role === "backingVocal" || clip.role === "vocal")) {
    candidates.push(candidate({
      ...base,
      problemType: "sibilance",
      lowHz: 5600,
      highHz: 9800,
      amountDb: -2.2,
      strength: 0.5,
      confidence: 0.7,
      score: 73,
      reason: "Vocal high band is strong around sibilance range. Use a small region so the air band is not dulled.",
    }));
  }

  if (metallicDb > vocalDb + 2.4 || (peaks.spectralFlatness ?? 0) > 0.55) {
    candidates.push(candidate({
      ...base,
      problemType: "metallic_high",
      lowHz: 8500,
      highHz: 16500,
      amountDb: -1.8,
      strength: 0.38,
      confidence: 0.58,
      score: 64,
      reason: "Upper band looks narrow or grainy. Review as AI metallic/high artifact before adding air.",
    }));
  }

  return dedupeCandidates(candidates).slice(0, 8);
}

export function createManualRepairRegion(input: {
  project: Project;
  clipId: string;
  positionSec: number;
  problemType: RepairProblemType;
}): SpectralRepairRegion | null {
  const clip = input.project.clips.find((candidate) => candidate.id === input.clipId);
  if (!clip) return null;
  const track = input.project.tracks.find((candidate) => candidate.id === clip.trackId) ?? null;
  const startSec = clamp(input.positionSec - 0.5, clip.timelineStartSec, clip.timelineStartSec + Math.max(0, clip.durationSec - 0.05));
  const endSec = clamp(startSec + 1, startSec + 0.05, clip.timelineStartSec + clip.durationSec);
  const range = defaultRangeForProblem(input.problemType);
  return createSpectralRepairRegion({
    fileId: clip.fileId,
    clipId: clip.id,
    trackId: clip.trackId,
    targetLayer: roleToLayer(track?.role ?? clip.role),
    transformHint: input.problemType === "clipping" || input.problemType === "click" ? "waveform" : "stft",
    problemType: input.problemType,
    startSec,
    endSec,
    lowHz: range.lowHz,
    highHz: range.highHz,
    confidence: 0.5,
  });
}

function candidate(input: Parameters<typeof createSpectralRepairRegion>[0] & { score: number; reason: string }): RepairCandidate {
  return {
    ...createSpectralRepairRegion(input),
    score: Math.round(clamp(input.score, 0, 100)),
    reason: input.reason,
  };
}

function roleToLayer(role: StemRole): SpectralRepairRegion["targetLayer"] {
  if (role === "vocal" || role === "backingVocal") return "vocal";
  if (role === "drums") return "drums";
  if (role === "bass") return "bass";
  if (role === "reference") return "mix";
  if (role === "fx" || role === "other" || role === "loop") return "other";
  return "instrument";
}

function defaultRangeForProblem(problemType: RepairProblemType) {
  switch (problemType) {
    case "rumble":
    case "low_end_blur":
      return { lowHz: 20, highHz: 120 };
    case "mud":
      return { lowHz: 180, highHz: 520 };
    case "sibilance":
      return { lowHz: 5600, highHz: 9800 };
    case "metallic_high":
    case "hiss":
      return { lowHz: 8500, highHz: 17000 };
    case "click":
      return { lowHz: 1200, highHz: 18000 };
    case "clipping":
      return { lowHz: 20, highHz: 20000 };
    default:
      return { lowHz: 500, highHz: 5000 };
  }
}

function findPeakRun(peaks: PeakSummary, clip: Clip, threshold: number) {
  const startBin = timeToBin(peaks, clip.sourceStartSec);
  const endBin = timeToBin(peaks, clip.sourceStartSec + clip.durationSec);
  for (let bin = startBin; bin <= endBin; bin += 1) {
    const peak = Math.max(Math.abs(peaks.min[bin] ?? 0), Math.abs(peaks.max[bin] ?? 0));
    if (peak < threshold) continue;
    const binSec = binToTimelineSec(peaks, clip, bin);
    return { startSec: Math.max(clip.timelineStartSec, binSec - 0.025), endSec: Math.min(clip.timelineStartSec + clip.durationSec, binSec + 0.08) };
  }
  return null;
}

function findTransientSpike(peaks: PeakSummary, clip: Clip) {
  const startBin = timeToBin(peaks, clip.sourceStartSec);
  const endBin = timeToBin(peaks, clip.sourceStartSec + clip.durationSec);
  let last = 0;
  for (let bin = startBin; bin <= endBin; bin += 1) {
    const current = Math.max(Math.abs(peaks.min[bin] ?? 0), Math.abs(peaks.max[bin] ?? 0));
    if (current - last > 0.42 && current > 0.55) {
      const binSec = binToTimelineSec(peaks, clip, bin);
      return { startSec: Math.max(clip.timelineStartSec, binSec - 0.015), endSec: Math.min(clip.timelineStartSec + clip.durationSec, binSec + 0.045) };
    }
    last = current;
  }
  return null;
}

function timeToBin(peaks: PeakSummary, sourceTimeSec: number) {
  return Math.max(0, Math.min(peaks.bins - 1, Math.floor((sourceTimeSec / Math.max(0.001, peaks.durationSec)) * peaks.bins)));
}

function binToTimelineSec(peaks: PeakSummary, clip: Clip, bin: number) {
  const sourceSec = (bin / Math.max(1, peaks.bins)) * peaks.durationSec;
  return clip.timelineStartSec + Math.max(0, sourceSec - clip.sourceStartSec);
}

function avgDb(values: Array<number | undefined>) {
  const usable = values.filter((value): value is number => typeof value === "number" && Number.isFinite(value));
  if (usable.length === 0) return -96;
  const power = usable.reduce((sum, value) => sum + 10 ** (value / 10), 0) / usable.length;
  return 10 * Math.log10(Math.max(1e-12, power));
}

function dedupeCandidates(candidates: RepairCandidate[]) {
  const seen = new Set<string>();
  return candidates.filter((candidate) => {
    const key = `${candidate.clipId}:${candidate.problemType}:${Math.round(candidate.lowHz / 100)}:${Math.round(candidate.startSec * 2)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}
