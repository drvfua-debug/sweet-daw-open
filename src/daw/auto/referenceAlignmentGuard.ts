import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import type { Project, Track } from "@/daw/model/Project";

export type ReferenceAlignmentResult = {
  ok: boolean;
  globalLagMs: number;
  driftMs: number;
  confidence: number;
  mode: "fixed-delay" | "warning" | "blocked";
  message: string;
};

const EMPTY_ALIGNMENT: ReferenceAlignmentResult = {
  ok: false,
  globalLagMs: 0,
  driftMs: 0,
  confidence: 0,
  mode: "warning",
  message: "Reference Alignment: not enough peak data.",
};

export function estimateReferenceAlignment(
  project: Project,
  peaksByFileId: Record<string, PeakSummary>,
  options: { maxAllowedLagMs: number; maxAllowedDriftMs: number },
): ReferenceAlignmentResult {
  const referenceTrack = project.tracks.find((track) => track.role === "reference");
  const workTracks = project.tracks.filter((track) => track.role !== "reference" && !track.mute);
  if (!referenceTrack) {
    return {
      ok: true,
      globalLagMs: 0,
      driftMs: 0,
      confidence: 0,
      mode: "fixed-delay",
      message: "Reference Alignment: skipped because no Reference Mix is loaded.",
    };
  }
  if (workTracks.length === 0) return EMPTY_ALIGNMENT;

  const referenceEnvelope = buildTrackEnvelope(project, referenceTrack, peaksByFileId);
  const mixEnvelope = mixTrackEnvelopes(project, workTracks, peaksByFileId, referenceEnvelope.length);
  if (referenceEnvelope.length < 32 || mixEnvelope.length < 32) return EMPTY_ALIGNMENT;

  const durationSec = Math.max(1, getTrackDurationSec(project, referenceTrack, peaksByFileId));
  const global = estimateLag(referenceEnvelope, mixEnvelope, durationSec, options.maxAllowedLagMs);
  const localLags = estimateLocalLags(referenceEnvelope, mixEnvelope, durationSec, options.maxAllowedLagMs);
  const driftMs = localLags.length > 1 ? maxAbsDeviation(localLags, global.lagMs) : 0;
  const confidence = clamp(global.confidence * (localLags.length > 1 ? 0.85 : 0.75), 0, 1);

  let mode: ReferenceAlignmentResult["mode"] = "fixed-delay";
  let ok = Math.abs(global.lagMs) <= options.maxAllowedLagMs && driftMs <= options.maxAllowedDriftMs;
  if (driftMs > 30 || Math.abs(global.lagMs) > options.maxAllowedLagMs) {
    mode = "warning";
    ok = false;
  }
  if (driftMs > 100) {
    mode = "blocked";
    ok = false;
  }

  return {
    ok,
    globalLagMs: round1(global.lagMs),
    driftMs: round1(driftMs),
    confidence: round2(confidence),
    mode,
    message: ok
      ? `Reference Alignment: global lag ${round1(global.lagMs)}ms, drift stable (${round1(driftMs)}ms).`
      : `Reference Alignment: check needed, lag ${round1(global.lagMs)}ms / drift ${round1(driftMs)}ms.`,
  };
}

function buildTrackEnvelope(project: Project, track: Track, peaksByFileId: Record<string, PeakSummary>) {
  const clips = project.clips.filter((clip) => clip.trackId === track.id);
  const longest = Math.max(0, ...clips.map((clip) => clip.timelineStartSec + clip.durationSec));
  const bins = Math.max(64, Math.min(4096, Math.ceil(longest * 16)));
  const envelope = new Array<number>(bins).fill(0);
  for (const clip of clips) {
    const summary = peaksByFileId[clip.fileId];
    if (!summary || summary.max.length === 0) continue;
    const startBin = Math.max(0, Math.floor((clip.timelineStartSec / Math.max(longest, 1)) * bins));
    const clipBins = Math.max(1, Math.floor((clip.durationSec / Math.max(longest, 1)) * bins));
    for (let index = 0; index < clipBins; index += 1) {
      const sourceIndex = Math.min(summary.max.length - 1, Math.floor((index / clipBins) * summary.max.length));
      const value = Math.max(Math.abs(summary.max[sourceIndex] ?? 0), Math.abs(summary.min[sourceIndex] ?? 0));
      envelope[Math.min(envelope.length - 1, startBin + index)] += value * dbToAmp((track.gainDb ?? 0) + (clip.gainDb ?? 0));
    }
  }
  return normalizeEnvelope(envelope);
}

function mixTrackEnvelopes(project: Project, tracks: Track[], peaksByFileId: Record<string, PeakSummary>, targetBins: number) {
  const mixed = new Array<number>(targetBins).fill(0);
  for (const track of tracks) {
    const envelope = resampleEnvelope(buildTrackEnvelope(project, track, peaksByFileId), targetBins);
    for (let index = 0; index < mixed.length; index += 1) {
      mixed[index] += envelope[index] ?? 0;
    }
  }
  return normalizeEnvelope(mixed);
}

function estimateLag(reference: number[], mix: number[], durationSec: number, maxLagMs: number) {
  const bins = Math.min(reference.length, mix.length);
  const binsPerMs = bins / Math.max(1, durationSec * 1000);
  const maxLagBins = Math.max(1, Math.min(Math.floor(maxLagMs * binsPerMs), Math.floor(bins * 0.2)));
  let bestLag = 0;
  let bestScore = -Infinity;
  for (let lag = -maxLagBins; lag <= maxLagBins; lag += 1) {
    let score = 0;
    let count = 0;
    for (let index = 0; index < bins; index += 1) {
      const mixIndex = index + lag;
      if (mixIndex < 0 || mixIndex >= bins) continue;
      score += reference[index] * mix[mixIndex];
      count += 1;
    }
    const normalized = count > 0 ? score / count : -Infinity;
    if (normalized > bestScore) {
      bestScore = normalized;
      bestLag = lag;
    }
  }
  return {
    lagMs: bestLag / Math.max(binsPerMs, 1e-6),
    confidence: clamp(bestScore * 4, 0, 1),
  };
}

function estimateLocalLags(reference: number[], mix: number[], durationSec: number, maxLagMs: number) {
  const windows = [10, 30, 60, 120, 180, Math.max(10, durationSec - 15)].filter((sec, index, list) => sec < durationSec && list.indexOf(sec) === index);
  const windowBins = Math.max(32, Math.floor(reference.length * 0.18));
  return windows.map((sec) => {
    const center = Math.floor((sec / durationSec) * reference.length);
    const start = Math.max(0, Math.min(reference.length - windowBins, center - Math.floor(windowBins / 2)));
    return estimateLag(reference.slice(start, start + windowBins), mix.slice(start, start + windowBins), (windowBins / reference.length) * durationSec, maxLagMs).lagMs;
  });
}

function getTrackDurationSec(project: Project, track: Track, peaksByFileId: Record<string, PeakSummary>) {
  const clips = project.clips.filter((clip) => clip.trackId === track.id);
  return Math.max(0, ...clips.map((clip) => {
    const summary = peaksByFileId[clip.fileId];
    return clip.timelineStartSec + Math.min(clip.durationSec, summary?.durationSec ?? clip.durationSec);
  }));
}

function normalizeEnvelope(values: number[]) {
  const mean = values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
  const centered = values.map((value) => value - mean);
  const max = Math.max(1e-9, ...centered.map((value) => Math.abs(value)));
  return centered.map((value) => value / max);
}

function resampleEnvelope(values: number[], bins: number) {
  if (values.length === bins) return values;
  if (values.length === 0) return new Array<number>(bins).fill(0);
  return Array.from({ length: bins }, (_, index) => values[Math.min(values.length - 1, Math.floor((index / Math.max(1, bins - 1)) * values.length))] ?? 0);
}

function maxAbsDeviation(values: number[], center: number) {
  return Math.max(0, ...values.map((value) => Math.abs(value - center)));
}

function dbToAmp(db: number) {
  return 10 ** (db / 20);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}
