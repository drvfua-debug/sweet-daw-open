import type { PeakSummary } from "@/audio/analysis/PeakBuilder";
import type { Project, Track } from "@/daw/model/Project";
import { getPriorityForRole, SWEET_MASKING_BANDS } from "./maskingBands";
import { inferSweetTrackRole } from "./trackRole";
import type {
  AimixUnmaskMode,
  SweetAimixUnmaskState,
  SweetMaskingBandId,
  SweetMaskingConflict,
  SweetReferenceDeltaSummary,
  SweetTrackRole,
  SweetTrackSpectralProfile,
  SweetUnmaskOperation,
} from "./aimixUnmaskTypes";
import { createDefaultAimixUnmaskState } from "./aimixUnmaskTypes";

const DEFAULT_WINDOW_SEC = 0.08;
const DEFAULT_HOP_SEC = 0.04;
const MAX_PROFILES = 12;
const MAX_ANALYSIS_FRAMES_PER_TRACK = 12000;

export type AnalyzeAimixUnmaskOptions = {
  mode?: AimixUnmaskMode;
  maxOperations?: number;
  referenceDelta?: SweetReferenceDeltaSummary;
};

export function analyzeAimixUnmask(
  project: Project,
  waveformPeaks: Record<string, PeakSummary>,
  options: AnalyzeAimixUnmaskOptions = {},
): SweetAimixUnmaskState {
  const mode = options.mode ?? "balanced";
  const warnings: string[] = [];
  const audibleTracks = project.tracks
    .filter((track) => !track.mute && track.role !== "reference" && track.type !== "reference")
    .slice(0, MAX_PROFILES);
  if (audibleTracks.length < 2) warnings.push("AIMIX Unmask needs at least two audible non-reference tracks.");

  const profilesByTrackId = Object.fromEntries(
    audibleTracks.map((track) => [track.id, buildTrackProfile(project, track, waveformPeaks)]),
  );
  const conflicts = buildConflicts(project, audibleTracks, profilesByTrackId, mode, options.referenceDelta)
    .sort((a, b) => b.overlapScore * b.priorityScore - a.overlapScore * a.priorityScore)
    .slice(0, options.maxOperations ?? modeMaxOperations(mode));
  const now = Date.now();
  const operations = conflicts.map((conflict): SweetUnmaskOperation => ({
    id: `unmask_${conflict.id}`,
    kind: "aimix_unmask",
    enabled: true,
    fixed: false,
    source: options.referenceDelta?.available ? "reference_delta" : "proposal",
    winnerTrackId: conflict.winnerTrackId,
    targetTrackId: conflict.targetTrackId,
    bandId: conflict.bandId,
    startSec: conflict.startSec,
    endSec: conflict.endSec,
    reductionDb: conflict.recommendedReductionDb,
    maxReductionDb: Math.abs(conflict.hardLimitDb),
    attackMs: conflict.attackMs,
    releaseMs: conflict.releaseMs,
    threshold: 0.28,
    knee: 0.18,
    protectTransient: conflict.bandId === "bass_punch" || conflict.bandId === "harsh",
    protectVocalConsonant: conflict.winnerRole === "lead_vocal" && (conflict.bandId === "presence" || conflict.bandId === "harsh"),
    protectBassFundamental: conflict.bandId === "bass_weight" || conflict.bandId === "sub",
    description: conflict.reason,
    warnings: conflict.warnings,
    createdAt: now,
    updatedAt: now,
  }));

  return {
    ...createDefaultAimixUnmaskState(),
    enabled: operations.length > 0,
    lastAnalyzedAt: now,
    profilesByTrackId,
    conflicts,
    operations,
    previewMode: "unmask",
    equalLoudness: false,
    referenceDelta: options.referenceDelta,
    warnings,
  };
}

export function buildTrackProfile(project: Project, track: Track, waveformPeaks: Record<string, PeakSummary>): SweetTrackSpectralProfile {
  const roleInfo = inferSweetTrackRole(track);
  const trackClips = project.clips.filter((clip) => clip.trackId === track.id);
  const durationSec = Math.max(0.001, ...trackClips.map((clip) => clip.timelineStartSec + clip.durationSec));
  const hopSec = scaledHop(durationSec);
  const frameCount = Math.max(1, Math.ceil(durationSec / hopSec));
  const bands = Object.fromEntries(Object.keys(SWEET_MASKING_BANDS).map((bandId) => [bandId, { rms: new Array<number>(frameCount).fill(0), peak: new Array<number>(frameCount).fill(0), activity: new Array<number>(frameCount).fill(0) }])) as SweetTrackSpectralProfile["bands"];

  for (const clip of trackClips) {
    const peaks = waveformPeaks[clip.fileId];
    if (!peaks) continue;
    const clipStartFrame = Math.max(0, Math.floor(clip.timelineStartSec / hopSec));
    const clipEndFrame = Math.min(frameCount, Math.ceil((clip.timelineStartSec + clip.durationSec) / hopSec));
    for (let frame = clipStartFrame; frame < clipEndFrame; frame += 1) {
      const timelineSec = frame * hopSec;
      const sourceSec = clip.sourceStartSec + Math.max(0, timelineSec - clip.timelineStartSec);
      const peakValue = peakAt(peaks, sourceSec);
      for (const bandId of Object.keys(SWEET_MASKING_BANDS) as SweetMaskingBandId[]) {
        const weight = bandWeightFromPeaks(peaks, bandId);
        const value = peakValue * weight;
        bands[bandId].peak[frame] = Math.max(bands[bandId].peak[frame] ?? 0, value);
        bands[bandId].rms[frame] = Math.max(bands[bandId].rms[frame] ?? 0, value * 0.72);
      }
    }
  }

  for (const bandId of Object.keys(SWEET_MASKING_BANDS) as SweetMaskingBandId[]) {
    bands[bandId].activity = normalizeActivity(bands[bandId].rms);
  }
  const allRms = Object.values(bands).flatMap((band) => band.rms);
  const globalRms = average(allRms);
  const globalPeak = Math.max(0, ...Object.values(bands).flatMap((band) => band.peak));

  return {
    trackId: track.id,
    role: roleInfo.role,
    durationSec,
    sampleRate: project.sampleRate,
    windowSec: DEFAULT_WINDOW_SEC,
    hopSec,
    bands,
    global: {
      rms: globalRms,
      peak: globalPeak,
      crest: dbRatio(globalPeak, globalRms),
      activeRatio: activeRatio(Object.values(bands)[0]?.activity ?? []),
      stereoCorrelation: firstPeakSummary(project, track, waveformPeaks)?.lrCorrelation,
      sideLowRisk: sideLowRisk(firstPeakSummary(project, track, waveformPeaks)),
    },
  };
}

function buildConflicts(
  project: Project,
  tracks: Track[],
  profilesByTrackId: Record<string, SweetTrackSpectralProfile>,
  mode: AimixUnmaskMode,
  referenceDelta?: SweetReferenceDeltaSummary,
): SweetMaskingConflict[] {
  const conflicts: SweetMaskingConflict[] = [];
  for (const winner of tracks) {
    const winnerProfile = profilesByTrackId[winner.id];
    if (!winnerProfile) continue;
    const winnerRule = getPriorityForRole(winnerProfile.role);
    for (const target of tracks) {
      if (target.id === winner.id) continue;
      const targetProfile = profilesByTrackId[target.id];
      if (!targetProfile) continue;
      const targetRule = getPriorityForRole(targetProfile.role);
      const priorityGap = targetRule.priority - winnerRule.priority;
      if (priorityGap <= 0) continue;
      const candidateBands = candidateBandsForPair(winnerProfile.role, targetProfile.role, winnerRule.defaultTargetBands);
      for (const bandId of candidateBands) {
        const conflict = scoreConflict(project, winner, target, winnerProfile, targetProfile, bandId, priorityGap, mode, referenceDelta);
        if (conflict) conflicts.push(conflict);
      }
    }
  }
  return dedupeConflicts(conflicts).slice(0, 24);
}

function scoreConflict(
  project: Project,
  winner: Track,
  target: Track,
  winnerProfile: SweetTrackSpectralProfile,
  targetProfile: SweetTrackSpectralProfile,
  bandId: SweetMaskingBandId,
  priorityGap: number,
  mode: AimixUnmaskMode,
  referenceDelta?: SweetReferenceDeltaSummary,
): SweetMaskingConflict | null {
  const winnerActivity = winnerProfile.bands[bandId].activity;
  const targetActivity = targetProfile.bands[bandId].activity;
  const length = Math.min(winnerActivity.length, targetActivity.length);
  if (length === 0) return null;
  let scoreSum = 0;
  let activeFrames = 0;
  let first = -1;
  let last = -1;
  for (let frame = 0; frame < length; frame += 1) {
    const simultaneous = (winnerActivity[frame] ?? 0) * (targetActivity[frame] ?? 0);
    if (simultaneous <= 0.12) continue;
    const priorityScore = clamp(priorityGap / 5, 0, 1);
    const weighted = simultaneous * (0.5 + 0.5 * priorityScore) * pairWeight(winnerProfile.role, targetProfile.role, bandId);
    if (weighted < 0.3) continue;
    scoreSum += weighted;
    activeFrames += 1;
    if (first < 0) first = frame;
    last = frame;
  }
  const activeRatioValue = activeFrames / Math.max(1, length);
  const overlapScore = scoreSum / Math.max(1, activeFrames);
  if (activeFrames === 0 || activeRatioValue < 0.05 || overlapScore < 0.3) return null;
  const startSec = Math.max(0, first * winnerProfile.hopSec);
  const endSec = Math.min(project.clips.reduce((max, clip) => Math.max(max, clip.timelineStartSec + clip.durationSec), 0), (last + 1) * winnerProfile.hopSec);
  if (endSec - startSec < 0.25) return null;
  const band = SWEET_MASKING_BANDS[bandId];
  const modeCap = mode === "safe" ? 1.5 : mode === "strong" ? 3.5 : 2.5;
  let amount = lerp(0.4, Math.abs(band.defaultMaxReductionDb), clamp((overlapScore - 0.3) / 0.5, 0, 1));
  amount = applyReferenceAssist(amount, bandId, winnerProfile.role, referenceDelta);
  amount = Math.min(amount, modeCap, Math.abs(band.hardMaxReductionDb));
  const warnings = buildWarnings(bandId, winnerProfile.role, targetProfile.role, amount, referenceDelta);
  return {
    id: `${winner.id}_${target.id}_${bandId}_${Math.round(startSec * 10)}`,
    winnerTrackId: winner.id,
    winnerRole: winnerProfile.role,
    targetTrackId: target.id,
    targetRole: targetProfile.role,
    bandId,
    startSec: round2(startSec),
    endSec: round2(endSec),
    activeRatio: round2(activeRatioValue),
    overlapScore: round2(clamp(overlapScore, 0, 1)),
    priorityScore: round2(clamp(priorityGap / 5, 0, 1)),
    recommendedReductionDb: -round2(amount),
    hardLimitDb: band.hardMaxReductionDb,
    attackMs: bandId === "bass_weight" || bandId === "bass_punch" ? 12 : 24,
    releaseMs: bandId === "bass_weight" || bandId === "bass_punch" ? 120 : 180,
    reason: `${winner.name} has priority over ${target.name} in ${band.label}. Duck only the target band while the winner is active.`,
    risk: band.risk,
    warnings,
  };
}

function candidateBandsForPair(winnerRole: SweetTrackRole, targetRole: SweetTrackRole, fallback: SweetMaskingBandId[]): SweetMaskingBandId[] {
  if (winnerRole === "lead_vocal" && targetRole !== "bass" && targetRole !== "kick") return ["presence_low", "presence", "low_mud"];
  if (winnerRole === "kick" && targetRole === "bass") return ["bass_weight", "bass_punch"];
  if (winnerRole === "snare") return ["presence", "harsh"];
  if (winnerRole === "bass" && (targetRole === "pad" || targetRole === "synth" || targetRole === "other")) return ["bass_weight", "low_mud"];
  return fallback.slice(0, 3);
}

function pairWeight(winnerRole: SweetTrackRole, targetRole: SweetTrackRole, bandId: SweetMaskingBandId) {
  let weight = 1;
  if (winnerRole === "lead_vocal" && (bandId === "presence" || bandId === "presence_low")) weight *= 1.4;
  if (winnerRole === "kick" && targetRole === "bass" && (bandId === "bass_weight" || bandId === "bass_punch")) weight *= 1.5;
  if (winnerRole === "snare" && (bandId === "presence" || bandId === "harsh")) weight *= 1.2;
  if (targetRole === "unknown" || winnerRole === "unknown") weight *= 0.6;
  return weight;
}

function applyReferenceAssist(amount: number, bandId: SweetMaskingBandId, winnerRole: SweetTrackRole, referenceDelta?: SweetReferenceDeltaSummary) {
  if (!referenceDelta?.available || referenceDelta.confidence < 0.25) return amount;
  let next = amount;
  if (referenceDelta.vocalPresenceDeltaDb !== undefined && referenceDelta.vocalPresenceDeltaDb < -1 && winnerRole === "lead_vocal") next += 0.3;
  if (referenceDelta.harshnessDeltaDb !== undefined && referenceDelta.harshnessDeltaDb > 1 && (bandId === "presence" || bandId === "harsh")) next -= 0.25;
  if (referenceDelta.bassWeightDeltaDb !== undefined && referenceDelta.bassWeightDeltaDb > 1.5 && (bandId === "bass_weight" || bandId === "bass_punch")) next += 0.3;
  if (referenceDelta.airDeltaDb !== undefined && referenceDelta.airDeltaDb < -1.5 && bandId === "air") next -= 0.35;
  return Math.max(0.2, next);
}

function buildWarnings(bandId: SweetMaskingBandId, winnerRole: SweetTrackRole, targetRole: SweetTrackRole, amount: number, referenceDelta?: SweetReferenceDeltaSummary) {
  const warnings: string[] = [];
  if ((bandId === "presence" || bandId === "harsh") && amount > 2.2) warnings.push("Vocal consonant risk: listen to Removed-only before FIX.");
  if ((bandId === "bass_weight" || bandId === "sub") && amount > 1.8) warnings.push("Bass fundamental risk: avoid thinning the bass.");
  if (winnerRole === "unknown" || targetRole === "unknown") warnings.push("Unknown role: proposal confidence is lower.");
  if (referenceDelta?.sideLowRiskDelta && referenceDelta.sideLowRiskDelta > 0.2) warnings.push("Reference Delta Assist: side-low risk is elevated.");
  return warnings;
}

function dedupeConflicts(conflicts: SweetMaskingConflict[]) {
  const seen = new Set<string>();
  return conflicts.filter((conflict) => {
    const key = `${conflict.winnerTrackId}:${conflict.targetTrackId}:${conflict.bandId}:${Math.round(conflict.startSec)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function peakAt(peaks: PeakSummary, sourceSec: number) {
  const bin = Math.max(0, Math.min(peaks.bins - 1, Math.floor((sourceSec / Math.max(0.001, peaks.durationSec)) * peaks.bins)));
  return Math.max(Math.abs(peaks.min[bin] ?? 0), Math.abs(peaks.max[bin] ?? 0));
}

function bandWeightFromPeaks(peaks: PeakSummary, bandId: SweetMaskingBandId) {
  const values = peakBandIds(bandId).map((id) => peaks.bandEnergyDb?.[id]).filter((value): value is number => typeof value === "number");
  if (values.length === 0) return 0.7;
  const avgDb = values.reduce((sum, value) => sum + value, 0) / values.length;
  return clamp(10 ** ((avgDb + 36) / 40), 0.15, 1.2);
}

function peakBandIds(bandId: SweetMaskingBandId) {
  if (bandId === "sub") return ["20-35", "35-60"];
  if (bandId === "bass_weight") return ["35-60", "60-120"];
  if (bandId === "bass_punch") return ["60-120", "120-250"];
  if (bandId === "low_mud") return ["120-250", "250-500"];
  if (bandId === "low_mid_body") return ["250-500", "500-900"];
  if (bandId === "mid_body") return ["900-1500", "1500-3000"];
  if (bandId === "presence_low") return ["1500-3000"];
  if (bandId === "presence") return ["3000-5000"];
  if (bandId === "harsh") return ["5000-9000"];
  return ["9000-12000", "12000-16000"];
}

function firstPeakSummary(project: Project, track: Track, waveformPeaks: Record<string, PeakSummary>) {
  const clip = project.clips.find((candidate) => candidate.trackId === track.id);
  return clip ? waveformPeaks[clip.fileId] : undefined;
}

function sideLowRisk(peaks: PeakSummary | undefined) {
  if (!peaks?.bandSideMidDb) return undefined;
  return clamp(((peaks.bandSideMidDb["low_20_120"] ?? -20) + 20) / 18, 0, 1);
}

function normalizeActivity(values: number[]) {
  if (values.length === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  const floor = percentile(sorted, 0.2);
  const high = percentile(sorted, 0.9);
  const max = sorted[sorted.length - 1] ?? 0;
  const range = high - floor;
  if (range < 0.08) {
    if (max <= 0.02) return values.map(() => 0);
    return values.map((value) => clamp(value / Math.max(0.04, max * 0.85), 0, 1));
  }
  return values.map((value) => clamp((value - floor) / range, 0, 1));
}

function activeRatio(values: number[]) {
  return values.filter((value) => value > 0.25).length / Math.max(1, values.length);
}

function scaledHop(durationSec: number) {
  const frames = Math.ceil(durationSec / DEFAULT_HOP_SEC);
  if (frames <= MAX_ANALYSIS_FRAMES_PER_TRACK) return DEFAULT_HOP_SEC;
  return DEFAULT_HOP_SEC * Math.ceil(frames / MAX_ANALYSIS_FRAMES_PER_TRACK);
}

function modeMaxOperations(mode: AimixUnmaskMode) {
  if (mode === "safe") return 8;
  if (mode === "strong") return 24;
  return 16;
}

function percentile(sorted: number[], ratio: number) {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * ratio)))] ?? 0;
}

function average(values: number[]) {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dbRatio(peak: number, rms: number) {
  return 20 * Math.log10(Math.max(1e-9, peak) / Math.max(1e-9, rms));
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * clamp(t, 0, 1);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}